import { expect, test, type Locator, type Page } from "@playwright/test";

const GEOMETRY_TOLERANCE_PX = 5;

test("solo participant stays centered, contained, and ratio-stable instead of stretching to fill the room", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=1");

  const canvas = page.locator(".meeting-stage-canvas");
  const tile = page.locator('[data-stage-role="participant"]').first();

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "1");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(1);

  const [canvasBox, tileBox] = await Promise.all([getBox(canvas), getBox(tile)]);
  const tileRatio = tileBox.width / tileBox.height;

  expect(tileRatio).toBeGreaterThan(1.72);
  expect(tileRatio).toBeLessThan(1.84);
  expect(tileBox.width).toBeLessThanOrEqual(canvasBox.width - 8);
  expect(tileBox.height).toBeGreaterThan(canvasBox.height * 0.97);
  expect(tileBox.height).toBeLessThanOrEqual(canvasBox.height + 1);
  await expectTilesContained(canvas, tile);
});

test("participant tiles keep the same aspect ratio while rescaling as people join", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=1");

  const canvas = page.locator(".meeting-stage-canvas");
  const firstTile = page.locator('[data-stage-role="participant"]').first();
  const soloTileBox = await getBox(firstTile);
  const soloRatio = soloTileBox.width / soloTileBox.height;

  await page.getByRole("button", { name: "Add participant" }).click();
  await page.getByRole("button", { name: "Add participant" }).click();

  await expect(page.getByRole("status")).toContainText("3 participants");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "2");

  const multiTileBox = await getBox(firstTile);
  const multiRatio = multiTileBox.width / multiTileBox.height;

  expect(Math.abs(soloRatio - multiRatio)).toBeLessThan(0.05);
  expect(multiTileBox.width).toBeLessThan(soloTileBox.width);
  expect(multiTileBox.height).toBeLessThan(soloTileBox.height);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"]'));

  await page.getByRole("button", { name: "Remove participant" }).click();
  await page.getByRole("button", { name: "Remove participant" }).click();

  await expect(page.getByRole("status")).toContainText("1 participants");
  const restoredSoloTileBox = await getBox(firstTile);
  const restoredSoloRatio = restoredSoloTileBox.width / restoredSoloTileBox.height;

  expect(Math.abs(restoredSoloRatio - soloRatio)).toBeLessThan(0.05);
  expect(restoredSoloTileBox.width).toBeGreaterThan(multiTileBox.width);
  expect(restoredSoloTileBox.height).toBeGreaterThan(multiTileBox.height);
  await expectTilesContained(canvas, firstTile);
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
  await expectTilesContained(canvas, participantTiles);
});

test("three participants center the last row instead of stretching a wide third tile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=3");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "2");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "2");

  const rows = page.locator(".stage-tiles__row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveAttribute("data-stage-row-size", "1");

  const lastTile = page.locator('[data-stage-role="participant"]').nth(2);
  const [canvasBox, lastTileBox] = await Promise.all([getBox(canvas), getBox(lastTile)]);
  const canvasMidpoint = canvasBox.x + canvasBox.width / 2;
  const tileMidpoint = lastTileBox.x + lastTileBox.width / 2;

  expect(Math.abs(canvasMidpoint - tileMidpoint)).toBeLessThan(18);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"]'));
});

test("active share keeps the shared content primary while all participant cameras stay below it on wide desktop layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=4&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-bottom");
  await expect(page.locator('[data-stage-role="share"]')).toBeVisible();
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(4);

  const [shareBox, tilesBox, firstTileBox] = await Promise.all([
    getBox(page.locator('[data-stage-role="share"]')),
    getBox(page.locator(".stage-tiles")),
    getBox(page.locator('[data-stage-role="participant"]').first()),
  ]);

  expect(shareBox.y).toBeLessThan(tilesBox.y);
  expect(shareBox.width).toBeGreaterThan(tilesBox.width * 0.95);
  expect(shareBox.height).toBeGreaterThan(tilesBox.height * 1.8);
  expect(firstTileBox.y).toBeGreaterThan(shareBox.y + shareBox.height - GEOMETRY_TOLERANCE_PX);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="share"]'));
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
  expect(shareBox.height).toBeGreaterThan(tilesBox.height * 1.6);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="share"]'));
});

test("share layout stays stable while participant count changes and all participant cameras remain rendered below the share", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=2&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-bottom");

  const firstTile = page.locator('[data-stage-role="participant"]').first();
  const beforeBox = await getBox(firstTile);

  await page.getByRole("button", { name: "Add participant" }).click();
  await page.getByRole("button", { name: "Add participant" }).click();

  await expect(page.getByRole("status")).toContainText("4 participants");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-bottom");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(4);

  const afterBox = await getBox(firstTile);
  expect(afterBox.width).toBeLessThan(beforeBox.width);
  expect(afterBox.width * afterBox.height).toBeLessThan(beforeBox.width * beforeBox.height);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="share"]'));

  await page.getByRole("button", { name: "Stop share" }).click();
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
});

test("mobile share layout keeps the shared content on top with all participant cameras contained below", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__stage-lab?participants=6&share=1&shareOwner=remote");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-bottom");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(6);

  const [shareBox, tilesBox, firstTileBox, lastTileBox] = await Promise.all([
    getBox(page.locator('[data-stage-role="share"]')),
    getBox(page.locator(".stage-tiles")),
    getBox(page.locator('[data-stage-role="participant"]').first()),
    getBox(page.locator('[data-stage-role="participant"]').last()),
  ]);

  expect(shareBox.y).toBeLessThan(tilesBox.y);
  expect(shareBox.height).toBeGreaterThan(tilesBox.height * 0.8);
  expect(firstTileBox.y).toBeGreaterThan(shareBox.y + shareBox.height - GEOMETRY_TOLERANCE_PX);
  expect(lastTileBox.y).toBeGreaterThan(shareBox.y + shareBox.height - GEOMETRY_TOLERANCE_PX);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="share"]'));
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
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="overflow"]'));
});

test("solo participant stays ratio-stable and contained on narrower desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.goto("/__stage-lab?participants=1");

  const canvas = page.locator(".meeting-stage-canvas");
  const tile = page.locator('[data-stage-role="participant"]').first();
  const [canvasBox, tileBox] = await Promise.all([getBox(canvas), getBox(tile)]);

  expect(tileBox.width / tileBox.height).toBeGreaterThan(1.72);
  expect(tileBox.width / tileBox.height).toBeLessThan(1.84);
  expect(tileBox.width).toBeLessThanOrEqual(canvasBox.width - 8);
  expect(tileBox.height).toBeGreaterThan(canvasBox.height * 0.97);
  expect(tileBox.height).toBeLessThanOrEqual(canvasBox.height + 1);
  await expectTilesContained(canvas, tile);
});

test("larger participant counts stay fully contained inside the meeting room border", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/__stage-lab?participants=7");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "3");

  const participantTiles = page.locator('[data-stage-role="participant"]');
  await expect(participantTiles).toHaveCount(7);
  await expectTilesContained(canvas, participantTiles);
});

async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected element to have a bounding box");
  }

  return box;
}

async function expectTilesContained(canvas: Locator, tiles: Locator) {
  await expect
    .poll(async () => {
      const canvasBox = await getBox(canvas);
      const tileCount = await tiles.count();
      let maxOutsidePx = 0;

      for (let index = 0; index < tileCount; index += 1) {
        const tileBox = await getBox(tiles.nth(index));

        maxOutsidePx = Math.max(
          maxOutsidePx,
          canvasBox.x - tileBox.x,
          canvasBox.y - tileBox.y,
          tileBox.x + tileBox.width - (canvasBox.x + canvasBox.width),
          tileBox.y + tileBox.height - (canvasBox.y + canvasBox.height),
        );
      }

      return maxOutsidePx;
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}
