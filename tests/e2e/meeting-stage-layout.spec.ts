import { expect, test, type Locator, type Page } from "@playwright/test";

const GEOMETRY_TOLERANCE_PX = 5;
const FULL_WIDTH_TOLERANCE_PX = 12;
const TILE_RATIO = 16 / 9;
const TILE_RATIO_TOLERANCE = 0.04;

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
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "1");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "0");

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
  await expect(canvas).toHaveAttribute("data-stage-row-count", "1");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "0");

  const [firstTileBox, secondTileBox] = await Promise.all([
    getBox(participantTiles.nth(0)),
    getBox(participantTiles.nth(1)),
  ]);

  expect(Math.abs(firstTileBox.y - secondTileBox.y)).toBeLessThan(8);
  await expectGridNearFullWidth(canvas, page.locator(".stage-tiles"));
  await expectTilesNearAspectRatio(participantTiles);
  await expectTilesContained(canvas, participantTiles);
});

test("three participants fill one full-width row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=3");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "1");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "0");

  const rows = page.locator(".stage-tiles__row");
  const participantTiles = page.locator('[data-stage-role="participant"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveAttribute("data-stage-row-size", "3");

  await expectGridNearFullWidth(canvas, page.locator(".stage-tiles"));
  await expectTilesNearAspectRatio(participantTiles);
  await expectTilesContained(canvas, participantTiles);
});

test("six participants render as two full rows of three", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=6");

  const canvas = page.locator(".meeting-stage-canvas");
  const participantTiles = page.locator('[data-stage-role="participant"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "2");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "0");
  await expect(participantTiles).toHaveCount(6);
  await expectRowSizes(page, [3, 3]);

  await expectGridNearFullWidth(canvas, page.locator(".stage-tiles"));
  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
});

test("ten participants left-align the final real tile and fill the row with visual placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=10");

  const canvas = page.locator(".meeting-stage-canvas");
  const participantTiles = page.locator('[data-stage-role="participant"]');
  const placeholderTiles = page.locator('[data-stage-role="placeholder"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');
  const lastRow = page.locator(".stage-tiles__row").nth(3);

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "4");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "2");
  await expect(participantTiles).toHaveCount(10);
  await expect(placeholderTiles).toHaveCount(2);
  await expectRowSizes(page, [3, 3, 3, 3]);
  await expect(lastRow.locator('[data-stage-role="participant"]')).toHaveCount(1);
  await expect(lastRow.locator('[data-stage-role="placeholder"]')).toHaveCount(2);
  await expectFirstRealTileStartsRow(lastRow);

  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
});

test("twelve participants render four full rows without placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=12");

  const canvas = page.locator(".meeting-stage-canvas");
  const participantTiles = page.locator('[data-stage-role="participant"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "4");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "0");
  await expect(participantTiles).toHaveCount(12);
  await expectRowSizes(page, [3, 3, 3, 3]);

  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
});

test("thirteen participants increase columns and keep four rows with final placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=13");

  const canvas = page.locator(".meeting-stage-canvas");
  const participantTiles = page.locator('[data-stage-role="participant"]');
  const placeholderTiles = page.locator('[data-stage-role="placeholder"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');
  const lastRow = page.locator(".stage-tiles__row").nth(3);

  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "4");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "4");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "3");
  await expect(participantTiles).toHaveCount(13);
  await expect(placeholderTiles).toHaveCount(3);
  await expectRowSizes(page, [4, 4, 4, 4]);
  await expect(lastRow.locator('[data-stage-role="participant"]')).toHaveCount(1);
  await expect(lastRow.locator('[data-stage-role="placeholder"]')).toHaveCount(3);
  await expectFirstRealTileStartsRow(lastRow);

  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
});

test("speaker view shows the selected non-self speaker as the main tile with self camera pip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=4&view=speaker&speaker=2");

  const canvas = page.locator(".meeting-stage-canvas");
  const mainTile = page.locator('[data-stage-role="participant"]');
  const selfPip = page.locator('[data-stage-role="self-pip"]');

  await expect(canvas).toHaveAttribute("data-stage-layout", "speaker");
  await expect(canvas).toHaveAttribute("data-stage-speaker-view", "true");
  await expect(mainTile).toHaveCount(1);
  await expect(mainTile).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-3");
  await expect(selfPip).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-1");
  await expect(page.locator('[data-stage-role="active-speaker-pip"]')).toHaveCount(0);

  await expectTilesNearAspectRatio(mainTile);
  await expectTilesContained(canvas, page.locator('[data-stage-role="participant"], [data-stage-role="self-pip"]'));
});

test("speaker view never promotes self to the main active speaker tile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=3&view=speaker&speaker=0");

  const canvas = page.locator(".meeting-stage-canvas");
  const mainTile = page.locator('[data-stage-role="participant"]');

  await expect(canvas).toHaveAttribute("data-stage-layout", "speaker");
  await expect(mainTile).toHaveCount(1);
  await expect(mainTile).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-2");
  await expect(page.locator('[data-stage-role="self-pip"]')).toHaveAttribute(
    "data-stage-participant-id",
    "stage-lab-participant-1",
  );
});

test("speaker view with no remote participant shows waiting stage and self pip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=1&view=speaker&speaker=0");

  const canvas = page.locator(".meeting-stage-canvas");

  await expect(canvas).toHaveAttribute("data-stage-layout", "speaker");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(0);
  await expect(page.locator('[data-stage-role="speaker-empty"]')).toBeVisible();
  await expect(page.locator('[data-stage-role="self-pip"]')).toHaveAttribute(
    "data-stage-participant-id",
    "stage-lab-participant-1",
  );
  await expectTilesContained(canvas, page.locator('[data-stage-role="self-pip"], [data-stage-role="speaker-empty"]'));
});

test("screen share fills the stage and stacks active speaker plus self pips bottom left", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=4&share=1&shareOwner=remote&speaker=2");

  const canvas = page.locator(".meeting-stage-canvas");
  const share = page.locator('[data-stage-role="share"]');
  const activePip = page.locator('[data-stage-role="active-speaker-pip"]');
  const selfPip = page.locator('[data-stage-role="self-pip"]');

  await expect(canvas).toHaveAttribute("data-stage-layout", "share-focus");
  await expect(share).toBeVisible();
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(0);
  await expect(activePip).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-3");
  await expect(selfPip).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-1");

  const [canvasBox, shareBox] = await Promise.all([getBox(canvas), getBox(share)]);
  expect(Math.abs(shareBox.x - canvasBox.x)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(shareBox.y - canvasBox.y)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(shareBox.width - canvasBox.width)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(shareBox.height - canvasBox.height)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);

  await expectPipStackPlacement(canvas, activePip, selfPip, "left");
  await expectTilesContained(canvas, page.locator('[data-stage-role="share"], [data-stage-role="active-speaker-pip"], [data-stage-role="self-pip"]'));
});

test("whiteboard keeps active speaker bottom right and self as a half-size pip above", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__stage-lab?participants=4&tool=whiteboard&speaker=2");

  const toolStage = page.locator(".meeting-tool-stage");
  const activePip = page.locator('[data-stage-role="active-speaker-pip"]');
  const selfPip = page.locator('[data-stage-role="self-pip"]');

  await expect(toolStage).toBeVisible();
  await expect(activePip).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-3");
  await expect(selfPip).toHaveAttribute("data-stage-participant-id", "stage-lab-participant-1");
  await expectPipStackPlacement(toolStage, activePip, selfPip, "right");
  await expectTilesContained(toolStage, page.locator('[data-stage-role="active-speaker-pip"], [data-stage-role="self-pip"]'));
});

test("mobile screen share keeps full-stage share with contained pip stack", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__stage-lab?participants=6&share=1&shareOwner=remote&speaker=2");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "share-focus");
  await expect(page.locator('[data-stage-role="participant"]')).toHaveCount(0);

  await expectPipStackPlacement(
    canvas,
    page.locator('[data-stage-role="active-speaker-pip"]'),
    page.locator('[data-stage-role="self-pip"]'),
    "left",
  );
  await expectTilesContained(canvas, page.locator('[data-stage-role="share"], [data-stage-role="active-speaker-pip"], [data-stage-role="self-pip"]'));
});

test("multi-participant grid on tablet-sized widths avoids giant stretched tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/__stage-lab?participants=5");

  const canvas = page.locator(".meeting-stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage-layout", "grid");
  await expect(canvas).toHaveAttribute("data-stage-columns", "3");
  await expect(canvas).toHaveAttribute("data-stage-row-count", "2");
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "1");

  const participantTiles = page.locator('[data-stage-role="participant"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');
  await expect(participantTiles).toHaveCount(5);
  await expectRowSizes(page, [3, 3]);

  const [canvasBox, tileBox] = await Promise.all([
    getBox(canvas),
    getBox(participantTiles.first()),
  ]);

  expect(tileBox.width).toBeLessThan(canvasBox.width * 0.52);
  expect(tileBox.height).toBeGreaterThan(140);
  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
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
  await expect(canvas).toHaveAttribute("data-stage-placeholder-count", "2");

  const participantTiles = page.locator('[data-stage-role="participant"]');
  const renderedTiles = page.locator('[data-stage-role="participant"], [data-stage-role="placeholder"]');
  await expect(participantTiles).toHaveCount(7);
  await expectRowSizes(page, [3, 3, 3]);
  await expectTilesNearAspectRatio(renderedTiles);
  await expectTilesContained(canvas, renderedTiles);
});

async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected element to have a bounding box");
  }

  return box;
}

async function expectRowSizes(page: Page, expectedSizes: number[]) {
  const rows = page.locator(".stage-tiles__row");
  await expect(rows).toHaveCount(expectedSizes.length);

  for (let index = 0; index < expectedSizes.length; index += 1) {
    await expect(rows.nth(index)).toHaveAttribute("data-stage-row-size", String(expectedSizes[index]));
  }
}

async function expectGridNearFullWidth(canvas: Locator, grid: Locator) {
  await expect
    .poll(async () => {
      const [canvasBox, gridBox] = await Promise.all([getBox(canvas), getBox(grid)]);
      return Math.abs(canvasBox.width - gridBox.width);
    })
    .toBeLessThanOrEqual(FULL_WIDTH_TOLERANCE_PX);
}

async function expectFirstRealTileStartsRow(row: Locator) {
  await expect
    .poll(async () => {
      const [rowBox, tileBox] = await Promise.all([
        getBox(row),
        getBox(row.locator('[data-stage-role="participant"]').first()),
      ]);
      return Math.abs(rowBox.x - tileBox.x);
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}

async function expectTilesNearAspectRatio(tiles: Locator) {
  await expect
    .poll(async () => {
      const tileCount = await tiles.count();
      let maxRatioDelta = 0;

      for (let index = 0; index < tileCount; index += 1) {
        const tileBox = await getBox(tiles.nth(index));
        maxRatioDelta = Math.max(maxRatioDelta, Math.abs(tileBox.width / tileBox.height - TILE_RATIO));
      }

      return maxRatioDelta;
    })
    .toBeLessThanOrEqual(TILE_RATIO_TOLERANCE);
}

async function expectPipStackPlacement(
  container: Locator,
  activePip: Locator,
  selfPip: Locator,
  side: "left" | "right",
) {
  await expect(activePip).toBeVisible();
  await expect(selfPip).toBeVisible();

  const [containerBox, activeBox, selfBox] = await Promise.all([
    getBox(container),
    getBox(activePip),
    getBox(selfPip),
  ]);
  const sideGap =
    side === "left"
      ? activeBox.x - containerBox.x
      : containerBox.x + containerBox.width - (activeBox.x + activeBox.width);

  expect(sideGap).toBeGreaterThanOrEqual(-GEOMETRY_TOLERANCE_PX);
  expect(sideGap).toBeLessThanOrEqual(26);
  expect(selfBox.y + selfBox.height).toBeLessThanOrEqual(activeBox.y + 2);
  expect(Math.abs(selfBox.width * 2 - activeBox.width)).toBeLessThanOrEqual(activeBox.width * 0.24);
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
