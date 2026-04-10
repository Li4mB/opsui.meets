import { expect, test, type Locator, type Page } from "@playwright/test";

test("solo participant stays immersive without an oversized grid", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=1");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "solo");
  await expect(page.locator(".stage-tiles--solo")).toBeVisible();
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(1);
});

test("two participants without sharing stay in a balanced side-by-side grid", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=2");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "2");

  const participantTiles = page.locator('[data-stage-role="participant"]');
  await expect(participantTiles).toHaveCount(2);

  const [canvasBox, firstTileBox, secondTileBox] = await Promise.all([
    getBox(canvas),
    getBox(participantTiles.nth(0)),
    getBox(participantTiles.nth(1)),
  ]);

  expect(Math.abs(firstTileBox.y - secondTileBox.y)).toBeLessThan(8);
  expect(firstTileBox.width).toBeLessThan(canvasBox.width * 0.56);
  expect(secondTileBox.width).toBeLessThan(canvasBox.width * 0.56);
});

test("active share takes priority with a side rail on wide desktop layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=4&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-side");
  await expect(page.locator('[data-stage-role="share"]')).toBeVisible();

  const [shareBox, tileBox] = await Promise.all([
    getBox(page.locator('[data-stage-role="share"]')),
    getBox(page.locator('[data-stage-role="participant"]').first()),
  ]);

  expect(shareBox.x).toBeLessThan(tileBox.x);
  expect(shareBox.width * shareBox.height).toBeGreaterThan(tileBox.width * tileBox.height * 3);
});

test("active share falls back to a bottom rail on narrower widths", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 780 });
  await page.goto("/__stage-lab?participants=4&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-bottom");

  const [shareBox, tilesBox] = await Promise.all([
    getBox(page.locator('[data-stage-role="share"]')),
    getBox(page.locator(".stage-tiles")),
  ]);

  expect(shareBox.y).toBeLessThan(tilesBox.y);
  expect(shareBox.width).toBeGreaterThan(tilesBox.width * 0.9);
  expect(shareBox.height).toBeGreaterThan(220);
  expect(shareBox.height).toBeGreaterThan(tilesBox.height * 2.3);
});

test("share layout stays stable while participant count changes and tiles scale down", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=2&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-side");

  const firstTile = page.locator('[data-stage-role="participant"]').first();
  const beforeBox = await getBox(firstTile);

  await page.getByRole("button", { name: "Add participant" }).click();
  await page.getByRole("button", { name: "Add participant" }).click();

  await expect(page.getByRole("status")).toContainText("4 participants");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-side");

  const afterBox = await getBox(firstTile);
  expect(afterBox.width).toBeLessThan(beforeBox.width);
  expect(afterBox.width * afterBox.height).toBeLessThan(beforeBox.width * beforeBox.height);

  await page.getByRole("button", { name: "Stop share" }).click();
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
});

test("multi-participant grid on tablet-sized widths avoids giant stretched tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/__stage-lab?participants=5");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");

  const participantTiles = page.locator('[data-stage-role="participant"]');
  await expect(participantTiles).toHaveCount(5);

  const [canvasBox, tileBox] = await Promise.all([
    getBox(canvas),
    getBox(participantTiles.first()),
  ]);

  expect(tileBox.width).toBeLessThan(canvasBox.width * 0.52);
  expect(tileBox.height).toBeGreaterThan(140);
});

async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected element to have a bounding box");
  }

  return box;
}
