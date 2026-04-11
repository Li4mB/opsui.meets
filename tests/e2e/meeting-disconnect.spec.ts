import { expect, test, type Browser, type Page } from "@playwright/test";

const FIXTURE_API_URL = "http://127.0.0.1:9877";
const FIXTURE_RESET_URL = `${FIXTURE_API_URL}/__reset`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("focus resume does not eject the current participant after a stale lease sweep", async ({ page, request }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/ops-signin");
  await expectDirectJoin(page);
  await openInfoDrawer(page);

  let releaseHeartbeat: (() => void) | null = null;
  const heartbeatGate = new Promise<void>((resolve) => {
    releaseHeartbeat = resolve;
  });
  await page.route("**/v1/meetings/*/participants/*/heartbeat", async (route) => {
    await heartbeatGate;
    await route.continue();
  });

  const roomState = await getRoomState(request, "ops-signin");
  const selfParticipant = roomState.participants.find((participant: { displayName: string }) => participant.displayName === "Liam");
  expect(selfParticipant).toBeTruthy();

  const ageResponse = await request.post(`${FIXTURE_API_URL}/__participants/stale`, {
    data: {
      meetingInstanceId: roomState.meeting.id,
      participantId: selfParticipant.participantId,
    },
  });
  expect(ageResponse.ok()).toBeTruthy();

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(300);

  await expect(page.getByText("You are no longer in this meeting.")).toHaveCount(0);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();

  releaseHeartbeat?.();

  await expect.poll(async () => {
    await page.getByRole("button", { name: "Refresh" }).click();
    return (await page.locator(".meeting-info-panel__section-title").nth(1).textContent()) ?? "";
  }).toContain("1 active / 0 lobby");

  await page.unroute("**/v1/meetings/*/participants/*/heartbeat");
});

test("one participant refreshing the room does not permanently disconnect another recovering participant", async ({
  browser,
  request,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await signInThroughUi(hostPage, "liam@example.com");
    await hostPage.goto("/ops-signin");
    await expectDirectJoin(hostPage);

    const meetingPath = new URL(hostPage.url()).pathname;
    await signInThroughUi(guestPage, "sam@example.com");
    await guestPage.goto(meetingPath);
    await expectDirectJoin(guestPage);

    await openInfoDrawer(hostPage);
    await expect.poll(async () => {
      await hostPage.getByRole("button", { name: "Refresh" }).click();
      return (await hostPage.locator(".meeting-info-panel__section-title").nth(1).textContent()) ?? "";
    }).toContain("2 active / 0 lobby");

    let releaseGuestHeartbeat: (() => void) | null = null;
    const guestHeartbeatGate = new Promise<void>((resolve) => {
      releaseGuestHeartbeat = resolve;
    });
    await guestPage.route("**/v1/meetings/*/participants/*/heartbeat", async (route) => {
      await guestHeartbeatGate;
      await route.continue();
    });

    const roomState = await getRoomState(request, meetingPath.slice(1));
    const guestParticipant = roomState.participants.find((participant: { displayName: string }) => participant.displayName === "Sam");
    expect(guestParticipant).toBeTruthy();

    const ageResponse = await request.post(`${FIXTURE_API_URL}/__participants/stale`, {
      data: {
        meetingInstanceId: roomState.meeting.id,
        participantId: guestParticipant.participantId,
      },
    });
    expect(ageResponse.ok()).toBeTruthy();

    await hostPage.getByRole("button", { name: "Refresh" }).click();

    await openInfoDrawer(guestPage);
    await guestPage.getByRole("button", { name: "Refresh" }).click();
    await expect(guestPage.getByText("You are no longer in this meeting.")).toHaveCount(0);

    releaseGuestHeartbeat?.();

    await expect.poll(async () => {
      await guestPage.getByRole("button", { name: "Refresh" }).click();
      return (await guestPage.locator(".meeting-info-panel__section-title").nth(1).textContent()) ?? "";
    }).toContain("2 active / 0 lobby");

    await expect(guestPage.getByText("You are no longer in this meeting.")).toHaveCount(0);
    await expect(hostPage.getByText(/2 active \/ 0 lobby/i)).toBeVisible();
    await guestPage.unroute("**/v1/meetings/*/participants/*/heartbeat");
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()]);
  }
});

test("a brief offline interruption recovers without removing the participant from the meeting", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/ops-signin");
  await expectDirectJoin(page);
  await openInfoDrawer(page);

  await page.context().setOffline(true);
  await page.waitForTimeout(750);
  await page.context().setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });

  await expect.poll(async () => {
    await page.getByRole("button", { name: "Refresh" }).click();
    return (await page.locator(".meeting-info-panel__section-title").nth(1).textContent()) ?? "";
  }).toContain("1 active / 0 lobby");

  await expect(page.getByText("You are no longer in this meeting.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();
});

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Mock auth email" }).fill(email);
  await page.getByRole("button", { name: "Use Dev Sign-In" }).click();
  await expect(page.getByText("You are signed in for local testing.")).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
}

async function openInfoDrawer(page: Page) {
  const infoButton = page.getByRole("button", { name: "Info" });
  if (await page.getByRole("heading", { name: "Room details" }).isVisible().catch(() => false)) {
    return;
  }

  await infoButton.click();
  await expect(page.getByRole("heading", { name: "Room details" })).toBeVisible();
}

async function expectDirectJoin(page: Page) {
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".meeting-control-dock")).toBeVisible();
}

async function getRoomState(request: Parameters<typeof test.beforeEach>[0]["request"], meetingCode: string) {
  const response = await request.get(`${FIXTURE_API_URL}/v1/rooms/resolve/${meetingCode}/state`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    meeting: { id: string };
    participants: Array<{ displayName: string; participantId: string }>;
  }>;
}
