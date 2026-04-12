import { expect, test, type Page } from "@playwright/test";

const FIXTURE_API_URL = "http://127.0.0.1:9877";
const FIXTURE_RESET_URL = `${FIXTURE_API_URL}/__reset`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("direct navigation to /opsui-demo opens the permanent demo room with the standard join flow", async ({
  page,
  request,
}) => {
  const initialState = await getRoomState(request, "opsui-demo");

  await page.goto("/opsui-demo");
  await expect(page).toHaveURL("/opsui-demo");
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();

  await joinAsGuest(page, "Demo Guest");
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();
  await openInfoDrawer(page);
  await expect(page.getByText(/0 active \/ 1 lobby/i)).toBeVisible();

  const nextState = await getRoomState(request, "opsui-demo");
  expect(nextState.room.id).toBe(initialState.room.id);
  expect(nextState.meeting?.id).toBe(initialState.meeting?.id);
});

test("joining with code opsui-demo routes into the same permanent room", async ({ page, request }) => {
  const initialState = await getRoomState(request, "opsui-demo");

  await page.goto("/");
  await page.getByRole("button", { name: "Join Meeting" }).click();
  await page.getByRole("textbox", { name: "Meeting code or link" }).fill("opsui-demo");
  await page.getByRole("dialog").getByRole("button", { name: "Join Meeting" }).click();

  await expect(page).toHaveURL("/opsui-demo");
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();

  const nextState = await getRoomState(request, "opsui-demo");
  expect(nextState.room.id).toBe(initialState.room.id);
  expect(nextState.meeting?.id).toBe(initialState.meeting?.id);
});

test("repeated visits to /opsui-demo keep resolving the same room identity", async ({ page, request }) => {
  const firstState = await getRoomState(request, "opsui-demo");

  await page.goto("/opsui-demo");
  await expect(page).toHaveURL("/opsui-demo");
  await page.goto("/");
  await page.goto("/opsui-demo");
  await expect(page).toHaveURL("/opsui-demo");

  const secondState = await getRoomState(request, "opsui-demo");
  expect(secondState.room.id).toBe(firstState.room.id);
  expect(secondState.room.slug).toBe("opsui-demo");
});

test("normal random room creation still works alongside the permanent demo room", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Meeting" }).click();
  await expect(page).toHaveURL(/\/ops-/);
  expect(new URL(page.url()).pathname).not.toBe("/opsui-demo");
  await expect(page.getByRole("heading", { name: "Join as a guest" })).toBeVisible();
});

async function joinAsGuest(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByRole("button", { name: "Enter Room" }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
}

async function openInfoDrawer(page: Page) {
  await page.getByRole("button", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "Room details" })).toBeVisible();
}

async function getRoomState(request: Parameters<typeof test.beforeEach>[0]["request"], slug: string) {
  const response = await request.get(`${FIXTURE_API_URL}/v1/rooms/resolve/${slug}/state`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    meeting: { id: string } | null;
    room: { id: string; slug: string };
  }>;
}
