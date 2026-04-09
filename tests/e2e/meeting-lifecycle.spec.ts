import { expect, test, type Page, type Route } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("leaving and quickly rejoining the same meeting keeps the new session active", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/ops-signin");
  await expectDirectJoin(page, "Auto Join Room");

  const pendingLeaveRoutes: Route[] = [];
  let releaseLeaves: (() => void) | null = null;
  const leaveGate = new Promise<void>((resolve) => {
    releaseLeaves = resolve;
  });

  await page.route("**/v1/meetings/*/participants/*/leave", async (route) => {
    pendingLeaveRoutes.push(route);
    await leaveGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/ops-signin");
  await expectDirectJoin(page, "Auto Join Room");
  await openInfoDrawer(page);

  releaseLeaves?.();
  await expect.poll(() => pendingLeaveRoutes.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/1 active \/ 0 lobby/i)).toBeVisible();
});

test("explicit leave only dispatches one leave request", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/ops-signin");
  await expectDirectJoin(page, "Auto Join Room");

  const leaveRequests: string[] = [];
  await page.route("**/v1/meetings/*/participants/*/leave", async (route) => {
    leaveRequests.push(route.request().url());
    await route.fulfill({
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL("/");
  await expect.poll(() => leaveRequests.length).toBe(1);
});

test("repeated leave-and-join cycles across different meetings stay usable", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");

  const roomSequence = [
    { pathname: "/ops-signin", title: "Auto Join Room" },
    { pathname: "/ops-login", title: "Auth Redirect Room" },
    { pathname: "/ops-signin", title: "Auto Join Room" },
    { pathname: "/ops-login", title: "Auth Redirect Room" },
  ];

  for (const [index, room] of roomSequence.entries()) {
    await page.goto(room.pathname);
    await expectDirectJoin(page, room.title);
    await openInfoDrawer(page);
    await expect(page.getByText(/1 active \/ 0 lobby/i)).toBeVisible();
    await openChatDrawer(page);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();

    if (index < roomSequence.length - 1) {
      await page.getByRole("button", { name: "Leave" }).click();
      await expect(page).toHaveURL("/");
    }
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

async function openInfoDrawer(page: Page) {
  await page.getByRole("button", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "Room details" })).toBeVisible();
}

async function expectDirectJoin(page: Page, title: string) {
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("You are in the meeting.").first()).toBeVisible();
}
