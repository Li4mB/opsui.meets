import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type MeetingStageShareSurface = "application" | "screen" | "browser" | "unknown";

export interface MeetingStageShareSourceMeta {
  audioIncluded: boolean;
  displaySurface: MeetingStageShareSurface;
  label: string;
  sourceId: string;
}

export interface MeetingStageShareTile {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  extraShareCount: number;
  isSelf?: boolean;
  source: MeetingStageShareSourceMeta;
  videoTrack?: MediaStreamTrack | null;
}

export interface MeetingStageParticipantTile {
  audioEnabled: boolean;
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  shareBadgeLabel?: string | null;
  subtitle: string;
  videoEnabled: boolean;
  videoTrack?: MediaStreamTrack | null;
}

interface MeetingStageSceneProps {
  immersiveSoloMode?: boolean;
  participantTiles: MeetingStageParticipantTile[];
  primaryScreenShare: MeetingStageShareTile | null;
}

type StageLayoutMode = "grid" | "share-bottom" | "share-side" | "solo";

interface StageLayout {
  columns: number;
  gridMaxWidth: number;
  mode: StageLayoutMode;
  overflowCount: number;
  railSize: number | null;
  visibleParticipantCount: number;
}

const DEFAULT_STAGE_WIDTH = 1200;
const DEFAULT_STAGE_HEIGHT = 720;
const STAGE_GAP = 16;
const GRID_TILE_ASPECT_RATIO = 16 / 10;
const SIDE_RAIL_TILE_ASPECT_RATIO = 4 / 3;
const BOTTOM_RAIL_TILE_ASPECT_RATIO = 16 / 10;

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
  const canvasStyle = buildCanvasStyle(layout);
  const tilesStyle = buildTilesStyle(layout, supportingStage);

  return (
    <div
      className={`meeting-stage-canvas meeting-stage-canvas--${layout.mode}`}
      data-stage-columns={String(layout.columns)}
      data-stage-layout={layout.mode}
      data-stage-overflow-count={String(layout.overflowCount)}
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
          extraShareCount={props.primaryScreenShare.extraShareCount}
          isSelf={props.primaryScreenShare.isSelf}
          source={props.primaryScreenShare.source}
          videoTrack={props.primaryScreenShare.videoTrack}
        />
      ) : null}

      <div
        className={`stage-tiles${supportingStage ? " stage-tiles--supporting" : ""}${showImmersiveSoloStage ? " stage-tiles--solo" : ""}`}
        style={tilesStyle}
      >
        {stageTiles.map((tile, index) =>
          isOverflowTile(tile) ? (
            <OverflowTile
              count={tile.overflowCount}
              key={`overflow-${tile.overflowCount}-${index}`}
              supporting={supportingStage}
            />
          ) : (
            <MediaTile
              audioEnabled={tile.audioEnabled}
              audioTrack={tile.audioTrack}
              displayName={tile.displayName}
              immersive={showImmersiveSoloStage}
              isSelf={tile.isSelf}
              key={`${tile.displayName}-${index}`}
              shareBadgeLabel={tile.shareBadgeLabel ?? null}
              subtitle={tile.subtitle}
              supporting={supportingStage}
              videoEnabled={tile.videoEnabled}
              videoTrack={tile.videoTrack}
            />
          ),
        )}
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
  shareBadgeLabel?: string | null;
  subtitle: string;
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
            <span>{props.subtitle}</span>
          </div>
          <div
            className={`participant-tile__badges${props.immersive ? " participant-tile__badges--immersive" : ""}`}
          >
            {props.shareBadgeLabel ? (
              <span className="status-pill status-pill--accent">{props.shareBadgeLabel}</span>
            ) : null}
            {!props.immersive && props.isSelf ? <span className="status-pill">You</span> : null}
            {!props.immersive ? (
              <span className="status-pill">{props.audioEnabled ? "Mic On" : "Mic Off"}</span>
            ) : null}
            {!props.immersive ? (
              <span className="status-pill">{props.videoEnabled ? "Camera On" : "Camera Off"}</span>
            ) : null}
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
  extraShareCount: number;
  isSelf?: boolean;
  source: MeetingStageShareSourceMeta;
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
              <strong>Shared content</strong>
              <span>{props.source.label}</span>
            </div>
          </div>
        ) : null}
        <div className="screen-share-stage__overlay">
          <div className="screen-share-stage__badges">
            <span className="status-pill status-pill--accent">{getShareBadgeLabel(props.source)}</span>
            {props.source.audioIncluded ? <span className="status-pill">Audio Included</span> : null}
            {props.extraShareCount ? (
              <span className="status-pill">
                +{props.extraShareCount} more share{props.extraShareCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
          <div className="screen-share-stage__nameplate participant-tile__nameplate">
            <strong>{props.isSelf ? "You are sharing" : `${props.displayName} is sharing`}</strong>
            <span>{props.source.label}</span>
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
  const participantCount = Math.max(1, input.participantCount);
  const width = Math.max(320, input.width);
  const height = Math.max(220, input.height);

  if (input.showImmersiveSoloStage) {
    return {
      columns: 1,
      gridMaxWidth: width,
      mode: "solo",
      overflowCount: 0,
      railSize: null,
      visibleParticipantCount: participantCount,
    };
  }

  if (!input.hasShare) {
    return getGridLayout({
      height,
      participantCount,
      width,
    });
  }

  return getShareLayout({
    height,
    participantCount,
    width,
  });
}

function getGridLayout(input: {
  height: number;
  participantCount: number;
  width: number;
}): StageLayout {
  if (input.participantCount === 2 && input.width >= 760) {
    const preferredTileWidth = Math.min((input.width - STAGE_GAP) / 2, 460);
    return {
      columns: 2,
      gridMaxWidth: preferredTileWidth * 2 + STAGE_GAP,
      mode: "grid",
      overflowCount: 0,
      railSize: null,
      visibleParticipantCount: input.participantCount,
    };
  }

  const maxColumns = Math.min(
    input.participantCount,
    input.width >= 1360 ? 4 : input.width >= 980 ? 3 : input.width >= 700 ? 2 : 1,
  );
  let bestLayout: { columns: number; gridWidth: number; score: number } | null = null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(input.participantCount / columns);
    const availableWidth = (input.width - STAGE_GAP * (columns - 1)) / columns;
    const availableHeight = (input.height - STAGE_GAP * (rows - 1)) / rows;
    const tileWidth = Math.min(availableWidth, availableHeight * GRID_TILE_ASPECT_RATIO);
    const tileHeight = tileWidth / GRID_TILE_ASPECT_RATIO;
    const gridWidth = tileWidth * columns + STAGE_GAP * (columns - 1);
    const emptyCells = rows * columns - input.participantCount;
    const rowBalancePenalty = Math.abs(columns - rows) * 240;
    const sparsePenalty = emptyCells * 420;
    const score = tileWidth * tileHeight - rowBalancePenalty - sparsePenalty;

    if (!bestLayout || score > bestLayout.score) {
      bestLayout = {
        columns,
        gridWidth,
        score,
      };
    }
  }

  const columns = bestLayout?.columns ?? 1;
  const preferredTileWidth =
    input.participantCount <= 3 ? 360 : input.participantCount <= 6 ? 300 : 244;
  const preferredGridWidth = preferredTileWidth * columns + STAGE_GAP * (columns - 1);

  return {
    columns,
    gridMaxWidth: Math.min(input.width, bestLayout?.gridWidth ?? input.width, preferredGridWidth),
    mode: "grid",
    overflowCount: 0,
    railSize: null,
    visibleParticipantCount: input.participantCount,
  };
}

function getShareLayout(input: {
  height: number;
  participantCount: number;
  width: number;
}): StageLayout {
  const sideCandidate = getShareSideLayout(input);
  const bottomCandidate = getShareBottomLayout(input);

  if (!sideCandidate) {
    return bottomCandidate.layout;
  }

  if (!bottomCandidate) {
    return sideCandidate.layout;
  }

  return sideCandidate.score >= bottomCandidate.score ? sideCandidate.layout : bottomCandidate.layout;
}

function getShareSideLayout(input: {
  height: number;
  participantCount: number;
  width: number;
}): { layout: StageLayout; score: number } | null {
  if (input.width < 960 || input.height < 420) {
    return null;
  }

  const maxDisplayTiles = Math.max(
    1,
    Math.min(4, Math.floor((input.height + STAGE_GAP) / (112 + STAGE_GAP))),
  );
  const displayTileCount = Math.min(input.participantCount, maxDisplayTiles);
  const overflowCount =
    input.participantCount > maxDisplayTiles ? input.participantCount - (maxDisplayTiles - 1) : 0;
  const visibleParticipantCount = overflowCount > 0 ? maxDisplayTiles - 1 : displayTileCount;
  const railRows = visibleParticipantCount + (overflowCount > 0 ? 1 : 0);
  const availableTileHeight = (input.height - STAGE_GAP * (railRows - 1)) / railRows;
  const tileHeight = clampValue(availableTileHeight, 108, input.participantCount <= 2 ? 188 : 164);
  const railWidth = clampValue(tileHeight * SIDE_RAIL_TILE_ASPECT_RATIO, 170, 244);
  const shareWidth = input.width - railWidth - STAGE_GAP;
  if (shareWidth < 520) {
    return null;
  }

  const shareArea = shareWidth * input.height;
  const supportingArea = tileHeight * railWidth * railRows;
  const shareRatioPenalty = Math.max(0, 1.1 - shareWidth / input.height) * 48_000;

  return {
    layout: {
      columns: 1,
      gridMaxWidth: railWidth,
      mode: "share-side",
      overflowCount,
      railSize: railWidth,
      visibleParticipantCount,
    },
    score: shareArea + supportingArea * 0.34 - overflowCount * 2_200 - shareRatioPenalty,
  };
}

function getShareBottomLayout(input: {
  height: number;
  participantCount: number;
  width: number;
}): { layout: StageLayout; score: number } {
  const maxColumns = Math.min(
    input.participantCount,
    5,
    Math.max(1, Math.floor((input.width + STAGE_GAP) / (164 + STAGE_GAP))),
  );
  const maxRailHeight = clampValue(input.height * 0.32, 136, 248);
  let bestLayout: { columns: number; overflowCount: number; score: number; visibleCount: number } | null =
    null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    for (let rows = 1; rows <= 2; rows += 1) {
      const capacity = columns * rows;
      if (capacity <= 1 && input.participantCount > 1) {
        continue;
      }

      const hasOverflow = input.participantCount > capacity;
      const visibleParticipantCount = hasOverflow ? Math.max(1, capacity - 1) : input.participantCount;
      const overflowCount = hasOverflow ? input.participantCount - visibleParticipantCount : 0;
      const occupiedCells = hasOverflow ? capacity : input.participantCount;
      const availableTileWidth = (input.width - STAGE_GAP * (columns - 1)) / columns;
      const tileHeight = availableTileWidth / BOTTOM_RAIL_TILE_ASPECT_RATIO;
      const railHeight = tileHeight * rows + STAGE_GAP * (rows - 1);
      const shareHeight = input.height - railHeight - STAGE_GAP;

      if (railHeight > maxRailHeight || shareHeight < 260) {
        continue;
      }

      const shareArea = input.width * shareHeight;
      const sparsePenalty = (capacity - occupiedCells) * 420;
      const score = shareArea + availableTileWidth * tileHeight * 0.42 - sparsePenalty - overflowCount * 980;

      if (!bestLayout || score > bestLayout.score) {
        bestLayout = {
          columns,
          overflowCount,
          score,
          visibleCount: visibleParticipantCount,
        };
      }
    }
  }

  if (!bestLayout) {
    const overflowCount = Math.max(0, input.participantCount - 1);
    return {
      layout: {
        columns: 1,
        gridMaxWidth: Math.min(input.width, 320),
        mode: "share-bottom",
        overflowCount,
        railSize: null,
        visibleParticipantCount: overflowCount > 0 ? 1 : input.participantCount,
      },
      score: 0,
    };
  }

  const preferredTileWidth = Math.min(280, input.width / bestLayout.columns);
  return {
    layout: {
      columns: bestLayout.columns,
      gridMaxWidth:
        preferredTileWidth * bestLayout.columns + STAGE_GAP * (bestLayout.columns - 1),
      mode: "share-bottom",
      overflowCount: bestLayout.overflowCount,
      railSize: null,
      visibleParticipantCount: bestLayout.visibleCount,
    },
    score: bestLayout.score,
  };
}

function buildCanvasStyle(layout: StageLayout): CSSProperties {
  const style: Record<string, string> = {
    "--stage-gap": `${STAGE_GAP}px`,
  };

  if (layout.railSize) {
    style["--stage-rail-size"] = `${layout.railSize}px`;
  }

  return style as CSSProperties;
}

function buildTilesStyle(layout: StageLayout, supportingStage: boolean): CSSProperties {
  const style: Record<string, string> = {
    "--stage-columns": String(layout.columns),
    "--stage-grid-max-width": `${Math.round(layout.gridMaxWidth)}px`,
    "--stage-tile-aspect-ratio": String(
      supportingStage && layout.mode === "share-side"
        ? SIDE_RAIL_TILE_ASPECT_RATIO
        : supportingStage
          ? BOTTOM_RAIL_TILE_ASPECT_RATIO
          : GRID_TILE_ASPECT_RATIO,
    ),
  };

  return style as CSSProperties;
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

function getShareBadgeLabel(source: MeetingStageShareSourceMeta): string {
  if (source.displaySurface === "application") {
    return "Sharing Application";
  }

  if (source.displaySurface === "screen") {
    return "Sharing Screen";
  }

  if (source.displaySurface === "browser") {
    return "Sharing Tab";
  }

  return "Sharing";
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
