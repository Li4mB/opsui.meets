import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByText("You are waiting in the lobby for a host to admit you.")).toBeVisible();
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
  await expect(page.getByText("You are in the meeting.")).toBeVisible();
  await expect(page.locator(".detail-card").filter({ hasText: "Identity" })).toContainText("Member");
});

test("sign-in page mock auth enables direct room entry and host controls", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await expect(page.getByRole("button", { name: "Signed In" })).toBeDisabled();

  await page.goto("/ops-signin");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.getByText("You are in the meeting.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Host tools" })).toBeVisible();

  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(page.getByText("Meeting locked.")).toBeVisible();
});

test("signed-in users can start a meeting from home and enter directly", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await page.goto("/");
  await expectNoPageScroll(page);

  await page.getByRole("button", { name: "Start Meeting" }).click();

  await expect(page).toHaveURL(/\/ops-/);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.getByText("You are in the meeting.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Host tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /1 active · 0 lobby/i })).toBeVisible();
  await expect(page.getByText("You are waiting in the lobby for a host to admit you.")).toHaveCount(0);
});

test("sign out clears the signed-in session state", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  await page.getByRole("button", { name: "Sign Out" }).click();

  await expect(page.getByText("You are signed out.")).toBeVisible();
  await expect(page.getByText("Guest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OIDC Unavailable" })).toBeDisabled();
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
    await expect(hostPage.getByText("You are in the meeting.")).toBeVisible();

    const meetingPath = new URL(hostPage.url()).pathname;

    await signInThroughUi(guestPage, "liam@example.com");
    await guestPage.goto(meetingPath);

    await expect(guestPage.locator('[role="dialog"]')).toHaveCount(0);
    await expect(guestPage.getByText("You are in the meeting.")).toBeVisible();
    await hostPage.getByRole("button", { name: "Refresh" }).click();
    await guestPage.getByRole("button", { name: "Refresh" }).click();
    await expect(hostPage.getByRole("heading", { name: /2 active/i })).toBeVisible();
    await expect(guestPage.getByRole("heading", { name: /2 active/i })).toBeVisible();
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

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Mock auth email" }).fill(email);
  await page.getByRole("button", { name: "Use Dev Sign-In" }).click();
  await expect(page.getByText("You are signed in for local testing.")).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
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
