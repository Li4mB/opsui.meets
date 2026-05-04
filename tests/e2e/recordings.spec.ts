import { expect, test } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("recordings page loads server recordings and supports save/delete", async ({ page }) => {
  await page.goto("/recordings");

  await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Screen Recording" })).toBeVisible();
  await expect(page.locator(".recording-card__media video")).toHaveCount(1);

  const saveButton = page.getByRole("button", { name: "Save recording" });
  await expect(saveButton).toBeVisible();
  await expect(saveButton).toHaveAttribute("aria-pressed", "false");
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Unsave recording" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".inline-feedback").filter({ hasText: "Recording saved." })).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".inline-feedback").filter({ hasText: "Recording deleted." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start recording inside a meeting." })).toBeVisible();
});

test("recording upload endpoint stores videos in the server library", async ({ request, page }) => {
  const response = await request.post("http://127.0.0.1:9877/v1/meetings/meeting_3/recordings/upload", {
    headers: {
      "x-session-type": "guest",
      "x-user-id": "guest_anonymous",
      "x-workspace-id": "workspace_local",
    },
    multipart: {
      durationMs: "1200",
      filename: "uploaded-screen-recording.webm",
      file: {
        buffer: Buffer.from("uploaded recording"),
        mimeType: "video/webm",
        name: "uploaded-screen-recording.webm",
      },
      startedAt: new Date(Date.now() - 1_200).toISOString(),
      stoppedAt: new Date().toISOString(),
      title: "Uploaded Screen Recording",
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/recordings");
  await expect(page.getByRole("heading", { name: "Uploaded Screen Recording" })).toBeVisible();
});
