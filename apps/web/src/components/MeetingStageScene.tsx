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
  participantId?: string | null;
  videoEnabled: boolean;
  videoTrack?: MediaStreamTrack | null;
}

interface MeetingStageSceneProps {
  activeSpeakerTile?: MeetingStageParticipantTile | null;
  immersiveSoloMode?: boolean;
  participantTiles: MeetingStageParticipantTile[];
  primaryScreenShare: MeetingStageShareTile | null;
  speakerViewEnabled?: boolean;
  suppressParticipantAudio?: boolean;
}

type StageLayoutMode = "grid" | "share-bottom" | "share-focus" | "share-side" | "speaker";

interface StageLayout {
  columns: number;
  gap: number;
  gridHeight: number;
  gridWidth: number;
  mode: StageLayoutMode;
  overflowCount: number;
  placeholderCount: number;
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

type StageOverflowTile = ReturnType<typeof createOverflowTile>;
type StagePlaceholderTile = ReturnType<typeof createPlaceholderTile>;
type StageTile = MeetingStageParticipantTile | StageOverflowTile | StagePlaceholderTile;

export function MeetingStageScene(props: MeetingStageSceneProps) {
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  const size = useObservedElementSize(canvasNode);
  const selfTile = props.participantTiles.find((tile) => tile.isSelf) ?? null;
  const fallbackSpeakerTile = props.participantTiles.find((tile) => !isSelfStageTile(tile, selfTile)) ?? null;
  const activeSpeakerTile =
    props.activeSpeakerTile && !isSelfStageTile(props.activeSpeakerTile, selfTile)
      ? props.activeSpeakerTile
      : fallbackSpeakerTile;
  const shareFocusMode = Boolean(props.primaryScreenShare);
  const speakerViewActive = Boolean(props.speakerViewEnabled && !shareFocusMode);
  const stageParticipantTiles = speakerViewActive
    ? activeSpeakerTile
      ? [activeSpeakerTile]
      : []
    : props.participantTiles;
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode &&
      !props.primaryScreenShare &&
      stageParticipantTiles.length === 1,
  );
  const layout = useMemo(
    () =>
      computeStageLayout({
        hasShare: Boolean(props.primaryScreenShare),
        height: size.height || DEFAULT_STAGE_HEIGHT,
        participantCount: stageParticipantTiles.length,
        speakerView: speakerViewActive,
        showImmersiveSoloStage,
        width: size.width || DEFAULT_STAGE_WIDTH,
      }),
    [
      props.primaryScreenShare,
      showImmersiveSoloStage,
      size.height,
      size.width,
      speakerViewActive,
      stageParticipantTiles.length,
    ],
  );
  const supportingStage = Boolean(props.primaryScreenShare);
  const visibleParticipants = stageParticipantTiles.slice(0, layout.visibleParticipantCount);
  const placeholderTiles = Array.from({ length: layout.placeholderCount }, (_, index) =>
    createPlaceholderTile(index),
  );
  const stageTiles: StageTile[] = layout.overflowCount
    ? [...visibleParticipants, createOverflowTile(layout.overflowCount), ...placeholderTiles]
    : [...visibleParticipants, ...placeholderTiles];
  const stageRows = useMemo(
    () => partitionStageTiles(stageTiles, layout.rowCounts),
    [layout.rowCounts, stageTiles],
  );
  const canvasStyle = buildCanvasStyle(layout);
  const tilesStyle = buildTilesStyle(layout);
  const showSelfPip = Boolean(selfTile && (speakerViewActive || shareFocusMode));

  return (
    <div
      className={`meeting-stage-canvas meeting-stage-canvas--${layout.mode}`}
      data-stage-columns={String(layout.columns)}
      data-stage-layout={layout.mode}
      data-stage-overflow-count={String(layout.overflowCount)}
      data-stage-placeholder-count={String(layout.placeholderCount)}
      data-stage-row-count={String(layout.rowCounts.length)}
      data-stage-speaker-view={String(speakerViewActive)}
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

      {!shareFocusMode && stageRows.length ? (
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
                ) : isPlaceholderTile(tile) ? (
                  <PlaceholderTile key={`${tile.placeholderId}-${rowIndex}-${index}`} />
                ) : (
                  <MediaTile
                    audioEnabled={tile.audioEnabled}
                    audioTrack={tile.audioTrack}
                    displayName={tile.displayName}
                    immersive={showImmersiveSoloStage}
                    isSelf={tile.isSelf}
                    key={`${tile.participantId ?? tile.displayName}-${rowIndex}-${index}`}
                    participantId={tile.participantId}
                    supporting={supportingStage}
                    suppressAudioPlayback={Boolean(props.suppressParticipantAudio)}
                    videoEnabled={tile.videoEnabled}
                    videoTrack={tile.videoTrack}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      ) : null}

      {speakerViewActive && !activeSpeakerTile ? <EmptySpeakerStage /> : null}

      {shareFocusMode ? (
        <StagePipStack
          activeSpeakerTile={activeSpeakerTile}
          placement="bottom-left"
          selfTile={selfTile}
          showSelf={Boolean(selfTile)}
        />
      ) : showSelfPip ? (
        <StagePipStack
          activeSpeakerTile={null}
          placement="bottom-right"
          selfTile={selfTile}
          showSelf
        />
      ) : null}
    </div>
  );
}

function MediaTile(props: {
  audioEnabled: boolean;
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  immersive?: boolean;
  isSelf?: boolean;
  participantId?: string | null;
  supporting?: boolean;
  suppressAudioPlayback?: boolean;
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

    if (!props.suppressAudioPlayback && props.audioEnabled && props.audioTrack) {
      audioRef.current.srcObject = new MediaStream([props.audioTrack]);
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioEnabled, props.audioTrack, props.isSelf, props.suppressAudioPlayback]);

  return (
    <article
      className={`participant-tile participant-tile--media${props.videoEnabled && props.videoTrack ? "" : " participant-tile--muted"}${props.immersive ? " participant-tile--immersive" : ""}${props.supporting ? " participant-tile--supporting" : ""}`}
      data-stage-participant-id={props.participantId ?? ""}
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

function EmptySpeakerStage() {
  return (
    <div className="speaker-stage-empty" data-stage-role="speaker-empty">
      <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
      <div className="participant-tile__meta">
        <strong>Waiting for a speaker</strong>
        <span>Other participants will appear here when available.</span>
      </div>
    </div>
  );
}

export function StagePipStack(props: {
  activeSpeakerTile: MeetingStageParticipantTile | null;
  placement: "bottom-left" | "bottom-right";
  selfTile: MeetingStageParticipantTile | null;
  showSelf: boolean;
}) {
  const showSelfMini = Boolean(props.showSelf && props.selfTile && props.activeSpeakerTile);
  const showSelfNormal = Boolean(props.showSelf && props.selfTile && !props.activeSpeakerTile);

  return (
    <div className={`stage-pip-stack stage-pip-stack--${props.placement}`}>
      {showSelfMini && props.selfTile ? (
        <MeetingStagePip kind="self" size="mini" tile={props.selfTile} />
      ) : null}
      {props.activeSpeakerTile ? (
        <MeetingStagePip kind="active" size="normal" tile={props.activeSpeakerTile} />
      ) : null}
      {showSelfNormal && props.selfTile ? (
        <MeetingStagePip kind="self" size="normal" tile={props.selfTile} />
      ) : null}
    </div>
  );
}

export function MeetingStagePip(props: {
  kind: "active" | "self";
  size: "mini" | "normal";
  tile: MeetingStageParticipantTile;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const role = props.kind === "self" ? "self-pip" : "active-speaker-pip";
  const label = props.kind === "self" ? "Your camera" : "Active speaker";

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (props.tile.videoEnabled && props.tile.videoTrack) {
      videoRef.current.srcObject = new MediaStream([props.tile.videoTrack]);
      return;
    }

    videoRef.current.srcObject = null;
  }, [props.tile.videoEnabled, props.tile.videoTrack]);

  return (
    <article
      aria-label={label}
      className={`meeting-stage-pip meeting-stage-pip--${props.kind} meeting-stage-pip--${props.size}`}
      data-stage-participant-id={props.tile.participantId ?? ""}
      data-stage-role={role}
    >
      <div className="meeting-stage-pip__media">
        <video
          autoPlay
          className="meeting-stage-pip__video"
          muted
          playsInline
          ref={videoRef}
        />
        {!props.tile.videoEnabled || !props.tile.videoTrack ? (
          <div className="meeting-stage-pip__placeholder">
            <div className="participant-tile__avatar">{getInitials(props.tile.displayName)}</div>
          </div>
        ) : null}
        <div className="meeting-stage-pip__nameplate">
          <strong>{props.tile.displayName}</strong>
        </div>
      </div>
    </article>
  );
}

function PlaceholderTile() {
  return (
    <article
      aria-hidden="true"
      className="participant-tile participant-tile--placeholder"
      data-stage-role="placeholder"
    >
      <div className="participant-tile__placeholder participant-tile__placeholder--brand">
        <div className="participant-tile__avatar participant-tile__avatar--brand">
          <img alt="" draggable={false} src="/OpsUIMeets-Logo.png" />
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
  speakerView: boolean;
  showImmersiveSoloStage: boolean;
  width: number;
}): StageLayout {
  const participantCount = Math.max(0, input.participantCount);
  const width = Math.max(320, input.width);
  const height = Math.max(220, input.height);
  const gap = getStageGap(width);

  if (input.hasShare) {
    return {
      columns: 0,
      gap,
      gridHeight: 0,
      gridWidth: 0,
      mode: "share-focus",
      overflowCount: 0,
      placeholderCount: 0,
      railSize: null,
      rowCounts: [],
      tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
      tileWidth: 0,
      visibleParticipantCount: 0,
    };
  }

  if (!participantCount) {
    return {
      columns: 1,
      gap,
      gridHeight: 0,
      gridWidth: 0,
      mode: input.speakerView ? "speaker" : "grid",
      overflowCount: 0,
      placeholderCount: 0,
      railSize: null,
      rowCounts: [],
      tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
      tileWidth: 0,
      visibleParticipantCount: 0,
    };
  }

  return getGridLayout({
    gap,
    height,
    mode: input.speakerView ? "speaker" : "grid",
    participantCount,
    width,
  });
}

function getGridLayout(input: {
  gap: number;
  height: number;
  mode?: "grid" | "speaker";
  participantCount: number;
  width: number;
}): StageLayout {
  const matrix = getGridMatrix(input.participantCount);
  const rowCounts = Array.from({ length: matrix.rows }, () => matrix.columns);
  const candidate = evaluateGridCandidate({
    gap: input.gap,
    height: input.height,
    maxTileWidth:
      input.participantCount <= 1
        ? getSoloGridTileWidthCap(input.width, input.height)
        : Number.POSITIVE_INFINITY,
    rowCounts,
    width: input.width,
  });
  const renderedSlots = matrix.columns * matrix.rows;

  return {
    columns: matrix.columns,
    gap: input.gap,
    gridHeight: candidate?.gridHeight ?? 0,
    gridWidth: candidate?.gridWidth ?? 0,
    mode: input.mode ?? "grid",
    overflowCount: 0,
    placeholderCount: Math.max(0, renderedSlots - input.participantCount),
    railSize: null,
    rowCounts,
    tileAspectRatio: PARTICIPANT_TILE_ASPECT_RATIO,
    tileWidth: candidate?.tileWidth ?? 0,
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
        placeholderCount: 0,
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
      placeholderCount: 0,
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

function getGridMatrix(participantCount: number) {
  if (participantCount <= 1) {
    return {
      columns: 1,
      rows: 1,
    };
  }

  if (participantCount <= 2) {
    return {
      columns: 2,
      rows: 1,
    };
  }

  if (participantCount <= 3) {
    return {
      columns: 3,
      rows: 1,
    };
  }

  if (participantCount <= 12) {
    return {
      columns: 3,
      rows: Math.ceil(participantCount / 3),
    };
  }

  const columns = Math.ceil(participantCount / 4);
  return {
    columns,
    rows: Math.ceil(participantCount / columns),
  };
}

function getSoloGridTileWidthCap(width: number, height: number) {
  return Math.min(
    Math.max(0, width - SOLO_STAGE_EDGE_BUFFER * 2),
    Math.max(0, height * PARTICIPANT_TILE_ASPECT_RATIO),
  );
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

function partitionStageTiles<T>(items: T[], rowCounts: number[]) {
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

function createPlaceholderTile(index: number) {
  return {
    kind: "placeholder" as const,
    placeholderId: `stage-placeholder-${index + 1}`,
  };
}

function isOverflowTile(tile: StageTile): tile is StageOverflowTile {
  return "kind" in tile && tile.kind === "overflow";
}

function isPlaceholderTile(tile: StageTile): tile is StagePlaceholderTile {
  return "kind" in tile && tile.kind === "placeholder";
}

function isSelfStageTile(tile: MeetingStageParticipantTile, selfTile: MeetingStageParticipantTile | null) {
  if (tile.isSelf) {
    return true;
  }

  if (!selfTile) {
    return false;
  }

  if (tile.participantId && selfTile.participantId) {
    return tile.participantId === selfTile.participantId;
  }

  return false;
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
