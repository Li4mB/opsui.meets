import { devices, expect, test, type Page } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("start meeting creates a room and keeps guests on the same room URL", async ({ page }) => {
  await page.goto("/");
  await expectNoPageScroll(page);

  await page.getByRole("button", { name: "Start Meeting" }).click();
  await expect(page).toHaveURL(/\/ops-/);
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();

  const roomPath = new URL(page.url()).pathname;
  await page.getByRole("textbox", { name: "Display name" }).fill("Guest Runner");
  await page.getByRole("button", { name: "Enter Room" }).click();

  await expect(page).toHaveURL(new RegExp(`${escapeRegex(roomPath)}$`));
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expectRoomNotice(page, "You are waiting in the lobby for a host to admit you.");
});

test("join meeting accepts legacy invite links from the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Join Meeting" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("textbox", { name: "Meeting code or link" }).fill("http://127.0.0.1:4173/join?room=ops-legacy");
  await page.getByRole("dialog").getByRole("button", { name: "Join Meeting" }).click();

  await expect(page).toHaveURL(/\/ops-legacy$/);
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();
});

test("guest room sign-in escalation redirects through auth and auto-joins", async ({ page }) => {
  await page.goto("/ops-login");
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();

  await page.getByRole("button", { name: "Sign In Instead" }).click();

  await expect(page).toHaveURL(/\/ops-login$/);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expectSoloImmersiveStage(page);
});

test("sign-in page mock auth enables direct room entry and host controls", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await expect(page.getByRole("button", { name: "Signed In" })).toBeDisabled();

  await page.goto("/ops-signin");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expectSoloImmersiveStage(page);
  await openInfoDrawer(page);
  await expect(page.getByRole("button", { name: "Lock" })).toBeVisible();

  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(page.locator(".inline-feedback").filter({ hasText: "Meeting locked." })).toBeVisible();
});

test("signed-in users can start a meeting from home and enter directly", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await page.goto("/");
  await expectNoPageScroll(page);

  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expect(page).toHaveURL(/\/ops-/);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expectSoloImmersiveStage(page);
  await openInfoDrawer(page);
  await expect(page.getByRole("button", { name: "Mute All" })).toBeVisible();
  await expect(page.getByText(/1 active \/ 0 lobby/i)).toBeVisible();
  await expect(page.getByText("Waiting for more people")).toHaveCount(0);
  await expect(page.locator(".participant-tile--empty")).toHaveCount(0);
  await expect(page.getByText("You are waiting in the lobby for a host to admit you.")).toHaveCount(0);
});

test("meeting viewport removes the old top-left status chrome even after multiple participants join", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();
    await expect(hostPage).toHaveURL(/\/ops-/);

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "sam@example.com");
    await guestPage.goto(meetingPath);

    await openInfoDrawer(hostPage);
    await hostPage.getByRole("button", { name: "Refresh" }).click();

    const stageSurface = hostPage.locator(".meeting-room-stage-surface");
    await expect(stageSurface.locator(".meeting-room-stage-surface__chrome")).toHaveCount(0);
    await expect(stageSurface.locator(".meeting-room-stage-surface__notices")).toHaveCount(0);
    await expect(stageSurface.getByRole("heading", { name: /Meeting OPS-/i })).toHaveCount(0);
    await expect(stageSurface.getByText(/^LIVE$/)).toHaveCount(0);
    await expect(stageSurface.getByText(/^DIRECT$/)).toHaveCount(0);
    await expect(stageSurface.getByText("You are in the meeting.")).toHaveCount(0);
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("screen share control sits beside the camera control in the bottom dock", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await page.goto("/");
  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expectSoloImmersiveStage(page);

  const primaryControls = page.locator(".meeting-control-dock__cluster").first();
  const dockLabels = await primaryControls.locator(".meeting-control-button__label").allTextContents();
  expect(dockLabels.slice(0, 3)).toEqual(["Mic Off", "Camera Off", "Share Screen"]);
  await expect(primaryControls.getByRole("button", { name: "Share Screen" })).toBeVisible();
  await expect(page.locator(".meeting-share-picker")).toHaveCount(0);
});

test("stage surfaces keep names but drop overlay status copy", async ({ page }) => {
  await page.goto("/__stage-lab?participants=2&share=1&shareOwner=self");

  const surface = page.locator(".stage-lab__surface");
  await expect(surface.getByText("Liam").first()).toBeVisible();
  await expect(surface.getByText("Participant 2")).toBeVisible();
  await expect(surface.getByText("Live preview")).toHaveCount(0);
  await expect(surface.getByText("Mic On")).toHaveCount(0);
  await expect(surface.getByText("Camera On")).toHaveCount(0);
  await expect(surface.getByText("You are sharing")).toHaveCount(0);
  await expect(surface.getByText("Quarterly planning deck")).toHaveCount(0);
  await expect(surface.getByText("Sharing Tab")).toHaveCount(0);
  await expect(surface.getByText("Audio Included")).toHaveCount(0);
});

test("participants drawer switches from chat and separates lobby users", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();
    await expect(hostPage).toHaveURL(/\/ops-/);

    const meetingPath = new URL(hostPage.url()).pathname;

    await openChatDrawer(hostPage);
    await openParticipantsDrawer(hostPage);
    await expect(hostPage.getByRole("heading", { name: "Chat & Activity" })).toHaveCount(0);
    await expect(hostPage.locator(".meeting-participants-panel__row").first()).toContainText("Liam");

    await guestPage.goto(meetingPath);
    await guestPage.getByRole("textbox", { name: "Display name" }).fill("Guest Runner");
    await guestPage.getByRole("button", { name: "Enter Room" }).click();
    await expectRoomNotice(guestPage, "You are waiting in the lobby for a host to admit you.");

    await openInfoDrawer(hostPage);
    await hostPage.getByRole("button", { name: "Refresh" }).click();
    await openParticipantsDrawer(hostPage);
    await expect(hostPage.locator(".meeting-participants-panel__divider")).toContainText("Lobby");
    await expect(hostPage.locator(".meeting-participants-panel__list")).toContainText("Guest Runner");
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("participants drawer keeps the current user first and host second for direct participants", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();
    await expect(hostPage).toHaveURL(/\/ops-/);

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "sam@example.com");
    await guestPage.goto(meetingPath);

    await openInfoDrawer(guestPage);
    await guestPage.getByRole("button", { name: "Refresh" }).click();
    await openParticipantsDrawer(guestPage);

    const rows = guestPage.locator(".meeting-participants-panel__row");
    await expect(rows.nth(0)).toContainText("Sam");
    await expect(rows.nth(1)).toContainText("Liam");
    await expect(rows.nth(0).locator(".meeting-participants-panel__status-icon")).toHaveCount(3);
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("chat messages show sender and time, and other users appear on the left", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();
    await expect(hostPage).toHaveURL(/\/ops-/);

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "sam@example.com");
    await guestPage.goto(meetingPath);
    await openChatDrawer(hostPage);
    await openChatDrawer(guestPage);

    await hostPage.getByRole("textbox", { name: "Message" }).fill("Hello from Liam");
    await hostPage.getByRole("button", { name: "Send message" }).click();
    await expect(hostPage.locator(".chat-message--self")).toContainText("Hello from Liam");

    await guestPage.getByRole("textbox", { name: "Message" }).fill("Reply from Sam");
    await guestPage.getByRole("button", { name: "Send message" }).click();
    await openInfoDrawer(hostPage);
    await hostPage.getByRole("button", { name: "Refresh" }).click();
    await openChatDrawer(hostPage);

    await expect(
      hostPage.locator(".chat-message:not(.chat-message--self)").filter({ hasText: "Reply from Sam" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const metaTexts = await hostPage.locator(".chat-message__meta").allTextContents();
        return metaTexts.some((value) => /Liam|Sam/.test(value) && /\d{2}:\d{2}/.test(value));
      })
      .toBe(true);
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("chat and activity share the same conversation log", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/");
  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expectSoloImmersiveStage(page);
  await openChatDrawer(page);
  await expect(page.locator(".conversation-divider")).toHaveCount(1);
  await expect(page.locator(".conversation-divider")).toContainText(/joined|recording|locked|meeting/i);
  await page.getByRole("textbox", { name: "Message" }).fill("One log only");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".conversation-log")).toContainText("One log only");
  await expect
    .poll(async () => {
      return page.locator(".conversation-log").evaluate((element) => getComputedStyle(element).overflowY);
    })
    .toBe("auto");
});

test("a single transient room refresh failure keeps the meeting usable without surfacing a warning banner", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/");
  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expectSoloImmersiveStage(page);
  await openInfoDrawer(page);

  let failed = false;
  await page.route("**/v1/rooms/resolve/*/state", async (route) => {
    if (!failed) {
      failed = true;
      await route.abort("failed");
      return;
    }

    await route.continue();
  });

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.locator(".meeting-stage-runtime")).toBeVisible();
  await expect(page.locator(".meeting-control-dock")).toBeVisible();
  await expect(page.getByText("Meeting services are temporarily unavailable.")).toHaveCount(0);
  await expect(page.getByText("Connection to meeting services was interrupted.")).toHaveCount(0);
});

test("repeated room refresh failures surface a recoverable warning that clears after the next successful refresh", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/");
  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expectSoloImmersiveStage(page);
  await openInfoDrawer(page);

  let remainingFailures = 2;
  await page.route("**/v1/rooms/resolve/*/state", async (route) => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      await route.abort("failed");
      return;
    }

    await route.continue();
  });

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectRoomNotice(page, "Connection to meeting services was interrupted.");

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Connection to meeting services was interrupted.")).toHaveCount(0);
  await expect(page.locator(".meeting-stage-runtime")).toBeVisible();
});

test("sign out clears the signed-in session state", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await page.getByRole("button", { name: "Sign Out" }).click();

  await expect(page.getByText("You are signed out.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeEnabled();
});

test("the same signed-in identity can join from two browser sessions without collapsing into one participant", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();

    await expect(hostPage).toHaveURL(/\/ops-/);
    await expect(hostPage.locator('[role="dialog"]')).toHaveCount(0);
    await expectSoloImmersiveStage(hostPage);

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "liam@example.com");
    await guestPage.goto(meetingPath);

    await expect(guestPage.locator('[role="dialog"]')).toHaveCount(0);
    await openInfoDrawer(hostPage);
    await hostPage.getByRole("button", { name: "Refresh" }).click();
    await openInfoDrawer(guestPage);
    await guestPage.getByRole("button", { name: "Refresh" }).click();
    await expect(hostPage.getByText(/2 active \/ 0 lobby/i)).toBeVisible();
    await expect(guestPage.getByText(/2 active \/ 0 lobby/i)).toBeVisible();
    await expect(hostPage.locator(".stage-tiles--solo")).toHaveCount(0);
    await expect(guestPage.locator(".stage-tiles--solo")).toHaveCount(0);
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("leaving one browser session updates the remaining participant count", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/");
    await hostPage.getByRole("button", { name: "Start Meeting" }).click();

    await expect(hostPage).toHaveURL(/\/ops-/);
    await expectSoloImmersiveStage(hostPage);

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "liam@example.com");
    await guestPage.goto(meetingPath);

    await openInfoDrawer(hostPage);
    await hostPage.getByRole("button", { name: "Refresh" }).click();
    await expect(hostPage.getByText(/2 active \/ 0 lobby/i)).toBeVisible();

    await guestPage.goto("/");
    await expect
      .poll(async () => {
        await hostPage.getByRole("button", { name: "Refresh" }).click();
        return (await hostPage.locator(".meeting-info-panel__section-title").nth(1).textContent()) ?? "";
      })
      .toContain("1 active / 0 lobby");
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("mobile sidebar opens and closes without scrolling the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectNoPageScroll(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Expected viewport to be available");
  }

  await page.mouse.click(viewport.width - 10, 180);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expectNoPageScroll(page);
});

test("mobile meeting room stays contained and keeps the control dock on a single row after the real join wait", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();

  try {
    await signInThroughUi(page, "liam@example.com");
    await page.goto("/");
    await page.getByRole("button", { name: "Start Meeting" }).click();

    await waitForMeetingReady(page);

    const stageSurface = page.locator(".meeting-room-stage-surface");
    const stageRuntime = page.locator(".meeting-stage-runtime");
    const buttons = page.locator(".meeting-control-dock .meeting-control-button");

    const [surfaceBox, runtimeBox, buttonTopOffsets] = await Promise.all([
      stageSurface.boundingBox(),
      stageRuntime.boundingBox(),
      buttons.evaluateAll((elements) =>
        elements.map((element) => Math.round((element as HTMLElement).getBoundingClientRect().top)),
      ),
    ]);

    if (!surfaceBox || !runtimeBox || buttonTopOffsets.length === 0) {
      throw new Error("Expected mobile meeting room geometry to be measurable");
    }

    expect(runtimeBox.x).toBeGreaterThanOrEqual(surfaceBox.x - 2);
    expect(runtimeBox.y).toBeGreaterThanOrEqual(surfaceBox.y - 2);
    expect(runtimeBox.x + runtimeBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width + 2);
    expect(runtimeBox.y + runtimeBox.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height + 2);
    expect(Math.max(...buttonTopOffsets) - Math.min(...buttonTopOffsets)).toBeLessThanOrEqual(8);
    await expect(page.locator(".meeting-control-dock")).toBeVisible();
  } finally {
    await context.close();
  }
});

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Mock auth email" }).fill(email);
  await page.getByRole("button", { name: "Use Dev Sign-In" }).click();
  await expect(page.getByText("You are signed in for local testing.")).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
}

async function openChatDrawer(page: Page) {
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByRole("heading", { name: "Chat & Activity" })).toBeVisible();
}

async function openParticipantsDrawer(page: Page) {
  await page.getByRole("button", { name: "Participants" }).click();
  await expect(page.getByRole("heading", { name: "Participants" })).toBeVisible();
}

async function openInfoDrawer(page: Page) {
  await page.getByRole("button", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "Room details" })).toBeVisible();
}

async function expectRoomNotice(page: Page, text: string) {
  await expect(page.locator(".meeting-control-surface__message").filter({ hasText: text }).first()).toBeVisible();
}

async function expectSoloImmersiveStage(page: Page) {
  await waitForMeetingReady(page);

  const canvas = page.locator(".meeting-stage-canvas");
  const stageSurface = page.locator(".meeting-room-stage-surface");
  const firstControlSurfaceChild = page.locator(".meeting-control-surface > *").first();
  const tile = page.locator(".participant-tile--immersive, .participant-tile--fallback-summary-solo").first();

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "1");
  await expect(tile).toBeVisible();

  const [canvasBox, stageSurfaceBox, firstControlSurfaceChildBox, tileBox] = await Promise.all([
    canvas.boundingBox(),
    stageSurface.boundingBox(),
    firstControlSurfaceChild.boundingBox(),
    tile.boundingBox(),
  ]);
  if (!canvasBox || !stageSurfaceBox || !firstControlSurfaceChildBox || !tileBox) {
    throw new Error("Expected solo meeting stage to expose measurable geometry");
  }

  const tileRatio = tileBox.width / tileBox.height;
  const topGap = tileBox.y - stageSurfaceBox.y;
  const bottomGap = firstControlSurfaceChildBox.y - (tileBox.y + tileBox.height);
  expect(tileRatio).toBeGreaterThan(1.72);
  expect(tileRatio).toBeLessThan(1.84);
  expect(tileBox.width).toBeLessThanOrEqual(canvasBox.width - 8);
  expect(tileBox.height).toBeGreaterThan(canvasBox.height * 0.97);
  expect(tileBox.height).toBeLessThanOrEqual(canvasBox.height + 1);
  expect(topGap).toBeGreaterThanOrEqual(4);
  expect(topGap).toBeLessThanOrEqual(8);
  expect(bottomGap).toBeGreaterThanOrEqual(4);
  expect(bottomGap).toBeLessThanOrEqual(8);
  await expect(page.getByRole("heading", { name: /Meeting OPS-/i })).toHaveCount(0);
  await expect(page.getByText("Waiting for more people")).toHaveCount(0);
}

async function waitForMeetingReady(page: Page) {
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 25_000 });
  await expect(page.locator(".meeting-stage-runtime")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(".meeting-control-dock")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 25_000 });
}

async function expectNoPageScroll(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return document.documentElement.scrollHeight > window.innerHeight ||
          document.body.scrollHeight > window.innerHeight;
      });
    })
    .toBe(false);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
