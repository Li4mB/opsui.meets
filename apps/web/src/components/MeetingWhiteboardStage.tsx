import type { PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WhiteboardPoint, WhiteboardStroke, WhiteboardStrokeMode } from "@opsui/shared-types";
import { CloseIcon, PenToolIcon } from "./MeetingRoomIcons";

interface MeetingWhiteboardStageProps {
  disabledReason: string | null;
  onClose(): void;
  onStrokeUpsert(stroke: WhiteboardStroke): boolean;
  participantId: string | null;
  strokes: WhiteboardStroke[];
}

const WHITEBOARD_COLORS = ["#f8fafc", "#38bdf8", "#34d399", "#facc15", "#fb7185", "#c084fc"];
const DEFAULT_PEN_COLOR = "#f8fafc";
const DEFAULT_THICKNESS = 7;
const DEFAULT_STROKE_MODE: WhiteboardStrokeMode = "direct";
const STROKE_SEND_INTERVAL_MS = 80;

export function MeetingWhiteboardStage(props: MeetingWhiteboardStageProps) {
  const [penColor, setPenColor] = useState(DEFAULT_PEN_COLOR);
  const [penThickness, setPenThickness] = useState(DEFAULT_THICKNESS);
  const [strokeMode, setStrokeMode] = useState<WhiteboardStrokeMode>(DEFAULT_STROKE_MODE);
  const [thicknessOpen, setThicknessOpen] = useState(false);
  const [optimisticStrokes, setOptimisticStrokes] = useState<Record<string, WhiteboardStroke>>({});
  const currentStrokeRef = useRef<WhiteboardStroke | null>(null);
  const lastStrokeSendAtRef = useRef(0);
  const canDraw = Boolean(props.participantId && !props.disabledReason);

  useEffect(() => {
    const remoteStrokesById = new Map(props.strokes.map((stroke) => [stroke.strokeId, stroke]));
    setOptimisticStrokes((current) => {
      let changed = false;
      const next: Record<string, WhiteboardStroke> = {};

      for (const [strokeId, stroke] of Object.entries(current)) {
        const remoteStroke = remoteStrokesById.get(strokeId);
        const strokeStillDrawing = currentStrokeRef.current?.strokeId === strokeId;
        if (remoteStroke && !strokeStillDrawing && isRemoteStrokeCaughtUp(remoteStroke, stroke)) {
          changed = true;
          continue;
        }

        next[strokeId] = stroke;
      }

      return changed ? next : current;
    });
  }, [props.strokes]);

  const renderedStrokes = useMemo(() => {
    const strokesById = new Map<string, WhiteboardStroke>();
    for (const stroke of props.strokes) {
      strokesById.set(stroke.strokeId, stroke);
    }
    for (const stroke of Object.values(optimisticStrokes)) {
      strokesById.set(stroke.strokeId, stroke);
    }
    return [...strokesById.values()];
  }, [optimisticStrokes, props.strokes]);

  function beginStroke(event: PointerEvent<SVGSVGElement>) {
    if (!canDraw || !props.participantId) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = getWhiteboardPoint(event);
    const stroke = {
      strokeId: createStrokeId(props.participantId),
      participantId: props.participantId,
      color: penColor,
      thickness: penThickness,
      mode: strokeMode,
      points: [point],
      updatedAt: new Date().toISOString(),
      completedAt: null,
    } satisfies WhiteboardStroke;

    currentStrokeRef.current = stroke;
    lastStrokeSendAtRef.current = window.performance.now();
    upsertOptimisticStroke(stroke);
    props.onStrokeUpsert(stroke);
  }

  function continueStroke(event: PointerEvent<SVGSVGElement>) {
    const current = currentStrokeRef.current;
    if (!canDraw || !current) {
      return;
    }

    event.preventDefault();
    const point = getWhiteboardPoint(event);
    const previousPoint = current.points[current.points.length - 1];
    if (previousPoint && getPointDistance(previousPoint, point) < 0.002) {
      return;
    }

    const stroke = {
      ...current,
      points: [...current.points, point],
      updatedAt: new Date().toISOString(),
    } satisfies WhiteboardStroke;

    currentStrokeRef.current = stroke;
    upsertOptimisticStroke(stroke);

    const now = window.performance.now();
    if (now - lastStrokeSendAtRef.current >= STROKE_SEND_INTERVAL_MS) {
      lastStrokeSendAtRef.current = now;
      props.onStrokeUpsert(stroke);
    }
  }

  function finishStroke(event: PointerEvent<SVGSVGElement>) {
    const current = currentStrokeRef.current;
    if (!current) {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}

    const stroke = {
      ...current,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    } satisfies WhiteboardStroke;

    currentStrokeRef.current = null;
    upsertOptimisticStroke(stroke);
    props.onStrokeUpsert(stroke);
  }

  function upsertOptimisticStroke(stroke: WhiteboardStroke) {
    setOptimisticStrokes((current) => ({
      ...current,
      [stroke.strokeId]: stroke,
    }));
  }

  return (
    <section className="meeting-whiteboard" aria-label="Whiteboard">
      <div className="meeting-whiteboard__topbar">
        <div className="meeting-whiteboard__toolset">
          <span className="meeting-whiteboard__tool-pill meeting-whiteboard__tool-pill--active">
            <PenToolIcon />
            <span>Pen</span>
          </span>
          <div className="meeting-whiteboard__swatches" aria-label="Pen colour">
            {WHITEBOARD_COLORS.map((color) => (
              <button
                aria-label={`Pen colour ${color}`}
                className={`meeting-whiteboard__swatch${penColor === color ? " is-active" : ""}`}
                key={color}
                onClick={() => {
                  setPenColor(color);
                }}
                style={{ ["--whiteboard-swatch-color" as string]: color }}
                type="button"
              />
            ))}
          </div>
          <div className="meeting-whiteboard__thickness">
            <button
              aria-expanded={thicknessOpen}
              className="meeting-whiteboard__thickness-button"
              onClick={() => {
                setThicknessOpen((current) => !current);
              }}
              type="button"
            >
              <span
                className="meeting-whiteboard__thickness-dot"
                style={{ ["--whiteboard-thickness" as string]: `${penThickness}px` }}
              />
              <span>{penThickness}px</span>
            </button>
            <div
              aria-hidden={!thicknessOpen}
              className={`meeting-whiteboard__thickness-popover${thicknessOpen ? " is-open" : ""}`}
            >
              <svg className="meeting-whiteboard__thickness-preview" viewBox="0 0 160 32">
                <path
                  d="M14 18C46 8 84 28 146 14"
                  fill="none"
                  stroke={penColor}
                  strokeLinecap="round"
                  strokeWidth={penThickness}
                />
              </svg>
              <input
                aria-label="Pen thickness"
                max="24"
                min="2"
                onChange={(event) => {
                  setPenThickness(Number(event.target.value));
                }}
                type="range"
                value={penThickness}
              />
            </div>
          </div>
          <label className="meeting-whiteboard__mode">
            <span>Mode</span>
            <select
              aria-label="Pen mode"
              onChange={(event) => {
                setStrokeMode(event.target.value === "smooth" ? "smooth" : "direct");
              }}
              value={strokeMode}
            >
              <option value="direct">Default</option>
              <option value="smooth">Smooth</option>
            </select>
          </label>
        </div>
        <button
          aria-label="Close whiteboard"
          className="meeting-whiteboard__close"
          onClick={props.onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="meeting-whiteboard__canvas-shell">
        <svg
          className="meeting-whiteboard__canvas"
          onPointerCancel={finishStroke}
          onPointerDown={beginStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 1 1"
        >
          <defs>
            <pattern height="0.025" id="whiteboard-grid" patternUnits="userSpaceOnUse" width="0.025">
              <path d="M0.025 0H0V0.025" fill="none" stroke="rgba(148, 163, 184, 0.13)" strokeWidth="0.001" />
            </pattern>
          </defs>
          <rect fill="url(#whiteboard-grid)" height="1" width="1" />
          {renderedStrokes.map((stroke) => (
            <WhiteboardStrokeLine key={stroke.strokeId} stroke={stroke} />
          ))}
        </svg>
        {props.disabledReason ? (
          <div className="meeting-whiteboard__disabled">
            <span>{props.disabledReason}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WhiteboardStrokeLine(props: { stroke: WhiteboardStroke }) {
  const points = props.stroke.points;
  if (points.length === 1) {
    const point = points[0];
    return (
      <path
        d={`M ${point.x} ${point.y} l 0.0001 0`}
        fill="none"
        stroke={props.stroke.color}
        strokeLinecap="round"
        strokeWidth={props.stroke.thickness}
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  if (props.stroke.mode === "smooth") {
    return (
      <path
        d={createSmoothStrokePath(points)}
        fill="none"
        stroke={props.stroke.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={props.stroke.thickness}
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  return (
    <polyline
      fill="none"
      points={points.map((point) => `${point.x},${point.y}`).join(" ")}
      stroke={props.stroke.color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={props.stroke.thickness}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function getWhiteboardPoint(event: PointerEvent<SVGSVGElement>): WhiteboardPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function createSmoothStrokePath(points: WhiteboardPoint[]): string {
  if (points.length < 3) {
    return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  }

  const [firstPoint] = points;
  let path = `M ${firstPoint.x} ${firstPoint.y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    const midpoint = {
      x: (currentPoint.x + nextPoint.x) / 2,
      y: (currentPoint.y + nextPoint.y) / 2,
    };
    path += ` Q ${currentPoint.x} ${currentPoint.y} ${midpoint.x} ${midpoint.y}`;
  }

  const lastPoint = points[points.length - 1];
  return `${path} L ${lastPoint.x} ${lastPoint.y}`;
}

function isRemoteStrokeCaughtUp(remoteStroke: WhiteboardStroke, optimisticStroke: WhiteboardStroke): boolean {
  if (remoteStroke.completedAt && optimisticStroke.completedAt) {
    return true;
  }

  return remoteStroke.points.length >= optimisticStroke.points.length;
}

function createStrokeId(participantId: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${participantId}:${randomId}`;
}

function getPointDistance(first: WhiteboardPoint, second: WhiteboardPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
