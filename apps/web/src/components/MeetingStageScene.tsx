import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface MeetingStageShareTile {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  videoTrack?: MediaStreamTrack | null;
}

export interface MeetingStageParticipantTile {
  audioEnabled: boolean;
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  videoEnabled: boolean;
  videoTrack?: MediaStreamTrack | null;
}

interface MeetingStageSceneProps {
  immersiveSoloMode?: boolean;
  participantTiles: MeetingStageParticipantTile[];
  primaryScreenShare: MeetingStageShareTile | null;
}

type StageLayoutMode = "grid" | "share-bottom" | "share-side";

interface StageLayout {
  columns: number;
  gap: number;
  gridHeight: number;
  gridWidth: number;
  mode: StageLayoutMode;
  overflowCount: number;
  railSize: number | null;
  rowCounts: number[];
  tileAspectRatio: number;
  tileWidth: number;
  visibleParticipantCount: number;
}

const DEFAULT_STAGE_WIDTH = 1200;
const DEFAULT_STAGE_HEIGHT = 720;
const PARTICIPANT_TILE_ASPECT_RATIO = 16 / 9;
const SOLO_STAGE_EDGE_BUFFER = 5;

export function MeetingStageScene(props: MeetingStageSceneProps) {
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  const size = useObservedElementSize(canvasNode);
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode &&
      !props.primaryScreenShare &&
      props.participantTiles.length === 1,
  );
  const layout = useMemo(
    () =>
      computeStageLayout({
        hasShare: Boolean(props.primaryScreenShare),
        height: size.height || DEFAULT_STAGE_HEIGHT,
        participantCount: props.participantTiles.length,
        showImmersiveSoloStage,
        width: size.width || DEFAULT_STAGE_WIDTH,
      }),
    [props.participantTiles.length, props.primaryScreenShare, showImmersiveSoloStage, size.height, size.width],
  );
  const supportingStage = Boolean(props.primaryScreenShare);
  const visibleParticipants = props.participantTiles.slice(0, layout.visibleParticipantCount);
  const stageTiles = layout.overflowCount
    ? [...visibleParticipants, createOverflowTile(layout.overflowCount)]
    : visibleParticipants;
  const stageRows = useMemo(
    () => partitionStageTiles(stageTiles, layout.rowCounts),
    [layout.rowCounts, stageTiles],
  );
  const canvasStyle = buildCanvasStyle(layout);
  const tilesStyle = buildTilesStyle(layout);

  return (
    <div
      className={`meeting-stage-canvas meeting-stage-canvas--${layout.mode}`}
      data-stage-columns={String(layout.columns)}
      data-stage-layout={layout.mode}
      data-stage-overflow-count={String(layout.overflowCount)}
      data-stage-row-count={String(layout.rowCounts.length)}
      data-stage-tile-width={String(Math.round(layout.tileWidth))}
      data-stage-visible-count={String(layout.visibleParticipantCount)}
      data-stage-viewport-height={String(Math.round(size.height || DEFAULT_STAGE_HEIGHT))}
      data-stage-viewport-width={String(Math.round(size.width || DEFAULT_STAGE_WIDTH))}
      ref={setCanvasNode}
      style={canvasStyle}
    >
      {props.primaryScreenShare ? (
        <ScreenShareTile
          audioTrack={props.primaryScreenShare.audioTrack}
          displayName={props.primaryScreenShare.displayName}
          isSelf={props.primaryScreenShare.isSelf}
          videoTrack={props.primaryScreenShare.videoTrack}
        />
      ) : null}

      <div
        className={`stage-tiles${supportingStage ? " stage-tiles--supporting" : ""}`}
        style={tilesStyle}
      >
        {stageRows.map((row, rowIndex) => (
          <div
            className="stage-tiles__row"
            data-stage-row={String(rowIndex + 1)}
            data-stage-row-size={String(row.length)}
            key={`row-${rowIndex}-${row.length}`}
          >
            {row.map((tile, index) =>
              isOverflowTile(tile) ? (
                <OverflowTile
                  count={tile.overflowCount}
                  key={`overflow-${rowIndex}-${tile.overflowCount}-${index}`}
                  supporting={supportingStage}
                />
              ) : (
                <MediaTile
                  audioEnabled={tile.audioEnabled}
                  audioTrack={tile.audioTrack}
                  displayName={tile.displayName}
                  immersive={showImmersiveSoloStage}
                  isSelf={tile.isSelf}
                  key={`${tile.displayName}-${rowIndex}-${index}`}
                  supporting={supportingStage}
                  videoEnabled={tile.videoEnabled}
                  videoTrack={tile.videoTrack}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaTile(props: {
  audioEnabled: boolean;
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  immersive?: boolean;
  isSelf?: boolean;
  supporting?: boolean;
  videoEnabled: boolean;
  videoTrack?: MediaStreamTrack | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (props.videoEnabled && props.videoTrack) {
      videoRef.current.srcObject = new MediaStream([props.videoTrack]);
      return;
    }

    videoRef.current.srcObject = null;
  }, [props.videoEnabled, props.videoTrack]);

  useEffect(() => {
    if (!audioRef.current || props.isSelf) {
      return;
    }

    if (props.audioEnabled && props.audioTrack) {
      audioRef.current.srcObject = new MediaStream([props.audioTrack]);
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioEnabled, props.audioTrack, props.isSelf]);

  return (
    <article
      className={`participant-tile participant-tile--media${props.videoEnabled && props.videoTrack ? "" : " participant-tile--muted"}${props.immersive ? " participant-tile--immersive" : ""}${props.supporting ? " participant-tile--supporting" : ""}`}
      data-stage-role="participant"
    >
      <div className="participant-tile__media-shell">
        <video
          autoPlay
          className="participant-tile__video"
          muted={Boolean(props.isSelf)}
          playsInline
          ref={videoRef}
        />
        {!props.isSelf ? <audio autoPlay className="sr-only" ref={audioRef} /> : null}
        {!props.videoEnabled || !props.videoTrack ? (
          <div className="participant-tile__placeholder">
            <div className="participant-tile__avatar">{getInitials(props.displayName)}</div>
          </div>
        ) : null}
        <div
          className={`participant-tile__overlay${props.immersive ? " participant-tile__overlay--immersive" : ""}${props.supporting ? " participant-tile__overlay--supporting" : ""}`}
        >
          <div className="participant-tile__nameplate">
            <strong>{props.displayName}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}

function OverflowTile(props: { count: number; supporting?: boolean }) {
  return (
    <article
      className={`participant-tile participant-tile--summary${props.supporting ? " participant-tile--supporting" : ""}`}
      data-stage-role="overflow"
    >
      <div className="participant-tile__summary-copy">
        <strong>+{props.count}</strong>
        <span>{props.count === 1 ? "more participant" : "more participants"}</span>
      </div>
    </article>
  );
}

function ScreenShareTile(props: {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  videoTrack?: MediaStreamTrack | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (props.videoTrack) {
      videoRef.current.srcObject = new MediaStream([props.videoTrack]);
      return;
    }

    videoRef.current.srcObject = null;
  }, [props.videoTrack]);

  useEffect(() => {
    if (!audioRef.current || props.isSelf) {
      return;
    }

    if (props.audioTrack) {
      audioRef.current.srcObject = new MediaStream([props.audioTrack]);
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioTrack, props.isSelf]);

  return (
    <article className="screen-share-stage" data-stage-role="share">
      <div className="screen-share-stage__media-shell">
        <video
          autoPlay
          className="screen-share-stage__video"
          muted={Boolean(props.isSelf)}
          playsInline
          ref={videoRef}
        />
        {!props.isSelf ? <audio autoPlay className="sr-only" ref={audioRef} /> : null}
        {!props.videoTrack ? (
          <div className="screen-share-stage__placeholder">
            <div className="screen-share-stage__placeholder-copy">
              <strong>{props.displayName}</strong>
            </div>
          </div>
        ) : null}
        <div className="screen-share-stage__overlay">
          <div className="screen-share-stage__nameplate participant-tile__nameplate">
            <strong>{props.displayName}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}

function computeStageLayout(input: {
  hasShare: boolean;
  height: number;
  participantCount: number;
  showImmersiveSoloStage: boolean;
  width: number;
}): StageLayout {
  const participantCount = Math.max(0, input.participantCount);
  const width = Math.max(320, input.width);
  const height = Math.max(220, input.height);
  const gap = getStageGap(width);

  if (!participantCount) {
    return {
      columns: 1,
      gap,
      gridHeight: 0,
      gridWidth: 0,
      mode: input.hasShare ? "share-bottom" : "grid",
      overflowCount: 0,
      railSize: null,
      rowCounts: [],
      tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
      tileWidth: 0,
      visibleParticipantCount: 0,
    };
  }

  if (!input.hasShare) {
    return getGridLayout({
      gap,
      height,
      participantCount,
      width,
    });
  }

  return getShareLayout({
    gap,
    height,
    participantCount,
    width,
  });
}

function getGridLayout(input: {
  gap: number;
  height: number;
  participantCount: number;
  width: number;
}): StageLayout {
  const maxColumns = getGridColumnLimit(input.participantCount, input.width);
  let bestLayout: {
    columns: number;
    gridHeight: number;
    gridWidth: number;
    rowCounts: number[];
    score: number;
    tileWidth: number;
  } | null = null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rowCounts = buildBalancedRowCounts(input.participantCount, columns);
    const candidate = evaluateGridCandidate({
      gap: input.gap,
      height: input.height,
      maxTileWidth: getGridTileWidthCap(input.participantCount, input.width, input.height),
      rowCounts,
      width: input.width,
    });

    if (!candidate) {
      continue;
    }

    const maxRowItems = Math.max(...rowCounts);
    const minRowItems = Math.min(...rowCounts);
    const rows = rowCounts.length;
    const verticalBiasPenalty = Math.max(0, rows - maxRowItems) * 12_000;
    const horizontalBiasPenalty = Math.max(0, maxRowItems - rows - 1) * 8_000;
    const rowPenalty = (rows - 1) * 3_600;
    const imbalancePenalty = (maxRowItems - minRowItems) * 4_000;
    const score =
      candidate.tileWidth * candidate.tileHeight -
      verticalBiasPenalty -
      horizontalBiasPenalty -
      rowPenalty -
      imbalancePenalty;

    if (!bestLayout || score > bestLayout.score) {
      bestLayout = {
        columns,
        gridHeight: candidate.gridHeight,
        gridWidth: candidate.gridWidth,
        rowCounts,
        score,
        tileWidth: candidate.tileWidth,
      };
    }
  }

  return {
    columns: bestLayout?.columns ?? 1,
    gap: input.gap,
    gridHeight: bestLayout?.gridHeight ?? 0,
    gridWidth: bestLayout?.gridWidth ?? 0,
    mode: "grid",
    overflowCount: 0,
    railSize: null,
    rowCounts: bestLayout?.rowCounts ?? [],
    tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
    tileWidth: bestLayout?.tileWidth ?? 0,
    visibleParticipantCount: input.participantCount,
  };
}

function getShareLayout(input: {
  gap: number;
  height: number;
  participantCount: number;
  width: number;
}): StageLayout {
  return getShareBottomLayout(input).layout;
}

function getShareBottomLayout(input: {
  gap: number;
  height: number;
  participantCount: number;
  width: number;
}): { layout: StageLayout; score: number } {
  const maxColumns = getShareColumnLimit(input.participantCount, input.width);
  const minimumShareHeight = getMinimumShareHeight(input.width, input.height);
  const maxRailHeight = Math.max(
    116,
    input.height - minimumShareHeight - input.gap,
  );
  let bestLayout:
    | {
        columns: number;
        gridHeight: number;
        gridWidth: number;
        rowCounts: number[];
        score: number;
        tileWidth: number;
        shareHeight: number;
      }
    | null = null;
  let fallbackLayout:
    | {
        columns: number;
        gridHeight: number;
        gridWidth: number;
        rowCounts: number[];
        score: number;
        tileWidth: number;
        shareHeight: number;
      }
    | null = null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rowCounts = buildBalancedRowCounts(input.participantCount, columns);
    const candidate = evaluateGridCandidate({
      gap: input.gap,
      height: maxRailHeight,
      maxTileWidth: Math.min(
        getSupportingTileWidthCap(input.participantCount, input.width),
        (input.width - input.gap * (columns - 1)) / columns,
      ),
      rowCounts,
      width: input.width,
    });

    if (!candidate) {
      continue;
    }

    const railHeight = candidate.gridHeight;
    const shareHeight = input.height - railHeight - input.gap;

    if (shareHeight < 160) {
      continue;
    }

    const rows = rowCounts.length;
    const maxRowItems = Math.max(...rowCounts);
    const emptySlots = maxRowItems * rows - input.participantCount;
    const rowPenalty = Math.max(0, rows - 1) * 1_850;
    const emptySlotPenalty = emptySlots * 760;
    const tinyTilePenalty = Math.max(0, 84 - candidate.tileHeight) * 2_400;
    const score =
      input.width * shareHeight +
      candidate.tileWidth * candidate.tileHeight * input.participantCount * 0.38 -
      rowPenalty -
      emptySlotPenalty -
      tinyTilePenalty;
    const nextLayout = {
      columns,
      gridHeight: candidate.gridHeight,
      gridWidth: candidate.gridWidth,
      rowCounts,
      score,
      tileWidth: candidate.tileWidth,
      shareHeight,
    };

    if (!fallbackLayout || score > fallbackLayout.score) {
      fallbackLayout = nextLayout;
    }

    if (shareHeight < minimumShareHeight) {
      continue;
    }

    if (!bestLayout || score > bestLayout.score) {
      bestLayout = nextLayout;
    }
  }

  const chosenLayout = bestLayout ?? fallbackLayout;
  if (!chosenLayout) {
    return {
      layout: {
        columns: 1,
        gap: input.gap,
        gridHeight: Math.min(maxRailHeight, 180),
        gridWidth: Math.min(input.width, 320),
        mode: "share-bottom",
        overflowCount: 0,
        railSize: null,
        rowCounts: [1],
        tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
        tileWidth: Math.min(input.width, 320),
        visibleParticipantCount: input.participantCount,
      },
      score: 0,
    };
  }

  return {
    layout: {
      columns: chosenLayout.columns,
      gap: input.gap,
      gridHeight: chosenLayout.gridHeight,
      gridWidth: chosenLayout.gridWidth,
      mode: "share-bottom",
      overflowCount: 0,
      railSize: null,
      rowCounts: chosenLayout.rowCounts,
      tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
      tileWidth: chosenLayout.tileWidth,
      visibleParticipantCount: input.participantCount,
    },
    score: chosenLayout.score,
  };
}

function buildCanvasStyle(layout: StageLayout): CSSProperties {
  const style: Record<string, string> = {
    "--stage-gap": `${layout.gap}px`,
    "--stage-grid-max-height": `${Math.round(layout.gridHeight)}px`,
    "--stage-grid-max-width": `${Math.round(layout.gridWidth)}px`,
    "--stage-tile-aspect-ratio": String(layout.tileAspectRatio),
    "--stage-tile-width": `${Math.round(layout.tileWidth)}px`,
  };

  if (layout.railSize) {
    style["--stage-rail-size"] = `${layout.railSize}px`;
  }

  return style as CSSProperties;
}

function buildTilesStyle(layout: StageLayout): CSSProperties {
  const style: Record<string, string> = {
    "--stage-columns": String(layout.columns),
  };

  return style as CSSProperties;
}

function evaluateGridCandidate(input: {
  gap: number;
  height: number;
  maxTileWidth: number;
  rowCounts: number[];
  width: number;
}) {
  if (!input.rowCounts.length) {
    return null;
  }

  const maxRowItems = Math.max(...input.rowCounts);
  const rows = input.rowCounts.length;
  const availableTileWidth = (input.width - input.gap * Math.max(0, maxRowItems - 1)) / maxRowItems;
  const availableTileHeight = (input.height - input.gap * Math.max(0, rows - 1)) / rows;
  const tileWidth = Math.min(
    availableTileWidth,
    availableTileHeight * PARTICIPANT_TILE_ASPECT_RATIO,
    input.maxTileWidth,
  );

  if (!Number.isFinite(tileWidth) || tileWidth <= 0) {
    return null;
  }

  const tileHeight = tileWidth / PARTICIPANT_TILE_ASPECT_RATIO;
  return {
    gridHeight: tileHeight * rows + input.gap * Math.max(0, rows - 1),
    gridWidth: tileWidth * maxRowItems + input.gap * Math.max(0, maxRowItems - 1),
    tileHeight,
    tileWidth,
  };
}

function getStageGap(width: number) {
  if (width <= 640) {
    return 8;
  }

  if (width <= 960) {
    return 12;
  }

  return 16;
}

function getGridColumnLimit(participantCount: number, width: number) {
  const widthLimit = width >= 1320 ? 4 : width >= 920 ? 3 : width >= 620 ? 2 : 1;
  const countLimit =
    participantCount <= 2 ? 2 : participantCount <= 4 ? 2 : participantCount <= 9 ? 3 : 4;
  return Math.min(participantCount, widthLimit, countLimit);
}

function getGridTileWidthCap(participantCount: number, width: number, height: number) {
  if (participantCount <= 1) {
    return Math.min(
      Math.max(0, width - SOLO_STAGE_EDGE_BUFFER * 2),
      Math.max(0, height * PARTICIPANT_TILE_ASPECT_RATIO),
    );
  }

  if (participantCount <= 2) {
    return Math.min(520, width * 0.44);
  }

  if (participantCount <= 4) {
    return Math.min(420, width * 0.34);
  }

  if (participantCount <= 6) {
    return Math.min(320, width * 0.28);
  }

  return Math.min(280, width * 0.24);
}

function getSupportingTileWidthCap(displayedCells: number, width: number) {
  if (displayedCells <= 2) {
    return Math.min(264, width * 0.3);
  }

  if (displayedCells <= 4) {
    return Math.min(220, width * 0.22);
  }

  if (displayedCells <= 8) {
    return Math.min(188, width * 0.19);
  }

  return Math.min(172, width * 0.16);
}

function getShareColumnLimit(participantCount: number, width: number) {
  const widthLimit = width >= 1440 ? 5 : width >= 1120 ? 4 : width >= 760 ? 3 : 2;
  return Math.min(participantCount, widthLimit);
}

function getMinimumShareHeight(width: number, height: number) {
  if (width <= 480) {
    return clampValue(height * 0.42, 180, 320);
  }

  if (width <= 820) {
    return clampValue(height * 0.46, 220, 360);
  }

  return clampValue(height * 0.52, 280, 480);
}

function buildBalancedRowCounts(itemCount: number, columns: number) {
  if (itemCount <= 0) {
    return [];
  }

  const rows = Math.ceil(itemCount / columns);
  const rowCounts: number[] = [];
  let remaining = itemCount;

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const rowsLeft = rows - rowIndex;
    const rowItemCount = Math.ceil(remaining / rowsLeft);
    rowCounts.push(rowItemCount);
    remaining -= rowItemCount;
  }

  return rowCounts;
}

function partitionStageTiles<T>(
  items: T[],
  rowCounts: number[],
) {
  if (!rowCounts.length) {
    return items.length ? [items] : [];
  }

  const rows: T[][] = [];
  let cursor = 0;

  for (const rowCount of rowCounts) {
    if (rowCount <= 0) {
      continue;
    }

    rows.push(items.slice(cursor, cursor + rowCount));
    cursor += rowCount;
  }

  return rows;
}

function useObservedElementSize(node: HTMLElement | null) {
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    if (!node) {
      return;
    }

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        height: rect.height,
        width: rect.width,
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [node]);

  return size;
}

function createOverflowTile(overflowCount: number) {
  return {
    kind: "overflow" as const,
    overflowCount,
  };
}

function isOverflowTile(
  tile: MeetingStageParticipantTile | ReturnType<typeof createOverflowTile>,
): tile is ReturnType<typeof createOverflowTile> {
  return "kind" in tile && tile.kind === "overflow";
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "OM";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
