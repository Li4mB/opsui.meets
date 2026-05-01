import { expect, test, type Page } from "@playwright/test";

const FIXTURE_API_URL = "http://127.0.0.1:9877";
const FIXTURE_RESET_URL = `${FIXTURE_API_URL}/__reset`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("test room asks signed-in users for dummy count before joining and clears them on leave", async ({
  page,
  request,
}) => {
  await signInThroughUi(page, "liam@example.com");

  let joinRequests = 0;
  await page.route("**/v1/meetings/*/join", async (route) => {
    joinRequests += 1;
    await route.continue();
  });

  await page.goto("/test");
  await expect(page).toHaveURL("/test");
  await expect(page.getByRole("heading", { name: "Set up test room" })).toBeVisible();
  await expect.poll(() => joinRequests).toBe(0);

  await page.getByRole("spinbutton", { name: "Dummy users" }).fill("10");
  await page.getByRole("button", { name: "Enter Test Room" }).click();

  await expect.poll(() => joinRequests).toBe(1);
  await expectDirectJoin(page);
  await openInfoDrawer(page);
  await expect(page.getByText(/11 active \/ 0 lobby/i)).toBeVisible();
  await expect(page.getByText("Test User 10").first()).toBeVisible();

  const canvas = page.locator(".meeting-stage-canvas");
  await page.getByRole("button", { name: "Change View" }).click();
  await expect(canvas).toHaveAttribute("data-stage-layout", "speaker");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(1);
  await expect(page.locator('[data-stage-role="self-pip"]')).toBeVisible();
  await expect(page.getByText(/11 active \/ 0 lobby/i)).toBeVisible();

  await page.getByRole("button", { name: "Change View" }).click();
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(11);
  await expect(page.locator('[data-stage-role="self-pip"]')).toHaveCount(0);
  await expect(page.getByText(/11 active \/ 0 lobby/i)).toBeVisible();

  await page.getByRole("button", { name: "Participants" }).click();
  await expect(page.getByRole("heading", { name: "Participants" })).toBeVisible();
  await expect(page.locator(".meeting-participants-panel__row")).toHaveCount(11);
  await expect(page.locator(".meeting-participants-panel__list")).toContainText("Test User 1");
  await expect(page.locator(".meeting-participants-panel__list")).toContainText("Test User 10");

  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL("/");

  await expect.poll(async () => {
    const roomState = await getRoomState(request, "test");
    const presentParticipants = roomState.participants.filter((participant) => participant.presence !== "left").length;
    const backendDummyParticipants = roomState.participants.filter((participant) =>
      participant.displayName.startsWith("Test User"),
    ).length;
    return `${presentParticipants}:${backendDummyParticipants}`;
  }).toBe("0:0");
});

test("test room dummy prompt appears before the guest display-name prompt", async ({ page }) => {
  await page.goto("/test");

  await expect(page.getByRole("heading", { name: "Set up test room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toHaveCount(0);

  await page.getByRole("spinbutton", { name: "Dummy users" }).fill("2");
  await page.getByRole("button", { name: "Enter Test Room" }).click();

  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();
  await page.getByRole("textbox", { name: "Display name" }).fill("Guest Runner");
  await page.getByRole("button", { name: "Enter Room" }).click();

  await expectDirectJoin(page);
  await openInfoDrawer(page);
  await expect(page.getByText(/3 active \/ 0 lobby/i)).toBeVisible();
  await expect(page.getByText("Test User 2").first()).toBeVisible();
});

test("test room stage geometry stays stable for 6, 10, and 13 dummy users", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInThroughUi(page, "liam@example.com");

  const scenarios = [
    { columns: "3", dummyCount: 6, placeholders: "2", rowSizes: [3, 3, 3], rows: "3", totalParticipants: 7 },
    { columns: "3", dummyCount: 10, placeholders: "1", rowSizes: [3, 3, 3, 3], rows: "4", totalParticipants: 11 },
    { columns: "4", dummyCount: 13, placeholders: "2", rowSizes: [4, 4, 4, 4], rows: "4", totalParticipants: 14 },
  ];

  for (const scenario of scenarios) {
    await page.goto("/test");
    await page.getByRole("spinbutton", { name: "Dummy users" }).fill(String(scenario.dummyCount));
    await page.getByRole("button", { name: "Enter Test Room" }).click();

    await expectDirectJoin(page);

    const canvas = page.locator(".meeting-stage-canvas");
    await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
    await expect(canvas).toHaveAttribute("data-stage-columns", scenario.columns);
    await expect(canvas).toHaveAttribute("data-stage-row-count", scenario.rows);
    await expect(canvas).toHaveAttribute("data-stage-visible-count", String(scenario.totalParticipants));
    await expect(canvas).toHaveAttribute("data-stage-placeholder-count", scenario.placeholders);
    await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(scenario.totalParticipants);
    await expect(page.locator('[data-stage-role="placeholder"]')).toHaveCount(Number(scenario.placeholders));
    await expectStageRowSizes(page, scenario.rowSizes);

    await page.getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL("/");

    await expect.poll(async () => {
      const roomState = await getRoomState(request, "test");
      const presentParticipants = roomState.participants.filter((participant) => participant.presence !== "left").length;
      const backendDummyParticipants = roomState.participants.filter((participant) =>
        participant.displayName.startsWith("Test User"),
      ).length;
      return `${presentParticipants}:${backendDummyParticipants}`;
    }).toBe("0:0");
  }
});

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Mock auth email" }).fill(email);
  await page.getByRole("button", { name: "Use Dev Sign-In" }).click();
  await expect(page.getByText("You are signed in for local testing.")).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
}

async function openInfoDrawer(page: Page) {
  await page.getByRole("button", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "Room details" })).toBeVisible();
}

async function expectDirectJoin(page: Page) {
  await page.locator(".meeting-entry-loader").waitFor({ state: "detached", timeout: 25_000 }).catch(() => {});
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 25_000 });
  await expect(page.locator(".meeting-stage-runtime")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(".meeting-control-dock")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 25_000 });
}

async function expectStageRowSizes(page: Page, expectedSizes: number[]) {
  const rows = page.locator(".stage-tiles__row");
  await expect(rows).toHaveCount(expectedSizes.length);

  for (let index = 0; index < expectedSizes.length; index += 1) {
    await expect(rows.nth(index)).toHaveAttribute("data-stage-row-size", String(expectedSizes[index]));
  }
}

async function getRoomState(request: Parameters<typeof test.beforeEach>[0]["request"], meetingCode: string) {
  const response = await request.get(`${FIXTURE_API_URL}/v1/rooms/resolve/${meetingCode}/state`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    participants: Array<{ displayName: string; presence: string }>;
  }>;
}
