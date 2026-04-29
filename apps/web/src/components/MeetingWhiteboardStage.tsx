import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WhiteboardPoint,
  WhiteboardStroke,
  WhiteboardStrokeMode,
  WhiteboardTextBox,
  WhiteboardTextBoxHistoryAction,
} from "@opsui/shared-types";
import {
  ClearWhiteboardIcon,
  CloseIcon,
  PenToolIcon,
  RedoIcon,
  TextToolIcon,
  UndoIcon,
} from "./MeetingRoomIcons";

interface MeetingWhiteboardStageProps {
  canClear: boolean;
  canRedo: boolean;
  canUndo: boolean;
  disabledReason: string | null;
  onClear(): boolean;
  onClose(): void;
  onRedo(): boolean;
  onStrokeUpsert(stroke: WhiteboardStroke): boolean;
  onTextBoxCommit(action: WhiteboardTextBoxHistoryAction): boolean;
  onTextBoxUpsert(textBox: WhiteboardTextBox): boolean;
  onUndo(): boolean;
  participantId: string | null;
  strokes: WhiteboardStroke[];
  textBoxes: WhiteboardTextBox[];
}

type WhiteboardTool = "pen" | "text";
type TextInteraction =
  | {
      type: "creating";
      pointerId: number;
      startPoint: WhiteboardPoint;
      textBoxId: string;
    }
  | {
      type: "moving";
      origin: WhiteboardTextBox;
      pointerId: number;
      startPoint: WhiteboardPoint;
      textBoxId: string;
    }
  | {
      type: "resizing";
      origin: WhiteboardTextBox;
      pointerId: number;
      startPoint: WhiteboardPoint;
      textBoxId: string;
    };

const WHITEBOARD_COLORS = ["#0f172a", "#38bdf8", "#34d399", "#facc15", "#fb7185", "#c084fc"];
const DEFAULT_PEN_COLOR = "#0f172a";
const DEFAULT_THICKNESS = 7;
const DEFAULT_STROKE_MODE: WhiteboardStrokeMode = "direct";
const DEFAULT_TEXTBOX_FONT_SIZE = 24;
const MIN_TEXTBOX_WIDTH_PX = 120;
const MIN_TEXTBOX_HEIGHT_PX = 48;
const STROKE_SEND_INTERVAL_MS = 80;

export function MeetingWhiteboardStage(props: MeetingWhiteboardStageProps) {
  const [activeTool, setActiveTool] = useState<WhiteboardTool>("pen");
  const [penColor, setPenColor] = useState(DEFAULT_PEN_COLOR);
  const [penThickness, setPenThickness] = useState(DEFAULT_THICKNESS);
  const [strokeMode, setStrokeMode] = useState<WhiteboardStrokeMode>(DEFAULT_STROKE_MODE);
  const [thicknessOpen, setThicknessOpen] = useState(false);
  const [textColor, setTextColor] = useState(DEFAULT_PEN_COLOR);
  const [textFontSize, setTextFontSize] = useState(DEFAULT_TEXTBOX_FONT_SIZE);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [optimisticStrokes, setOptimisticStrokes] = useState<Record<string, WhiteboardStroke>>({});
  const [optimisticTextBoxes, setOptimisticTextBoxes] = useState<Record<string, WhiteboardTextBox>>({});
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentStrokeRef = useRef<WhiteboardStroke | null>(null);
  const lastStrokeSendAtRef = useRef(0);
  const textInteractionRef = useRef<TextInteraction | null>(null);
  const textEditSessionRef = useRef<{ baseline: WhiteboardTextBox } | null>(null);
  const renderedTextBoxesRef = useRef<Map<string, WhiteboardTextBox>>(new Map());
  const canDraw = Boolean(props.participantId && !props.disabledReason && activeTool === "pen");
  const canEditText = Boolean(props.participantId && !props.disabledReason && activeTool === "text");

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

  useEffect(() => {
    const remoteTextBoxesById = new Map(props.textBoxes.map((textBox) => [textBox.textBoxId, textBox]));
    setOptimisticTextBoxes((current) => {
      let changed = false;
      const next: Record<string, WhiteboardTextBox> = {};

      for (const [textBoxId, textBox] of Object.entries(current)) {
        const remoteTextBox = remoteTextBoxesById.get(textBoxId);
        const interactionOwnsTextBox = textInteractionRef.current?.textBoxId === textBoxId;
        const editOwnsTextBox = textEditSessionRef.current?.baseline.textBoxId === textBoxId;
        if (remoteTextBox && !interactionOwnsTextBox && !editOwnsTextBox && isRemoteTextBoxCaughtUp(remoteTextBox, textBox)) {
          changed = true;
          continue;
        }

        next[textBoxId] = textBox;
      }

      return changed ? next : current;
    });
  }, [editingTextBoxId, props.textBoxes]);

  const renderedStrokes = useMemo(() => {
    const strokesById = new Map<string, WhiteboardStroke>();
    for (const stroke of props.strokes) {
      strokesById.set(stroke.strokeId, stroke);
    }
    for (const stroke of Object.values(optimisticStrokes)) {
      const existingStroke = strokesById.get(stroke.strokeId);
      if (!existingStroke || existingStroke.updatedAt < stroke.updatedAt) {
        strokesById.set(stroke.strokeId, stroke);
      }
    }
    return [...strokesById.values()].filter((stroke) => !stroke.removedAt);
  }, [optimisticStrokes, props.strokes]);

  const renderedTextBoxes = useMemo(() => {
    const textBoxesById = new Map<string, WhiteboardTextBox>();
    for (const textBox of props.textBoxes) {
      textBoxesById.set(textBox.textBoxId, textBox);
    }
    for (const textBox of Object.values(optimisticTextBoxes)) {
      const existingTextBox = textBoxesById.get(textBox.textBoxId);
      if (!existingTextBox || existingTextBox.updatedAt < textBox.updatedAt) {
        textBoxesById.set(textBox.textBoxId, textBox);
      }
    }
    return [...textBoxesById.values()].filter((textBox) => !textBox.removedAt);
  }, [optimisticTextBoxes, props.textBoxes]);

  const renderedTextBoxesById = useMemo(
    () => new Map(renderedTextBoxes.map((textBox) => [textBox.textBoxId, textBox])),
    [renderedTextBoxes],
  );
  renderedTextBoxesRef.current = renderedTextBoxesById;

  const selectedTextBox = selectedTextBoxId ? renderedTextBoxesById.get(selectedTextBoxId) ?? null : null;
  const textOptionsVisible = activeTool === "text" && Boolean(selectedTextBox);
  const historyActionsDisabled = Boolean(props.disabledReason);

  useEffect(() => {
    if (!selectedTextBoxId) {
      return;
    }

    const current = renderedTextBoxesById.get(selectedTextBoxId);
    if (current) {
      setTextColor((previous) => (previous === current.color ? previous : current.color));
      setTextFontSize((previous) => (previous === current.fontSize ? previous : current.fontSize));
      return;
    }

    setSelectedTextBoxId(null);
    setEditingTextBoxId(null);
    textEditSessionRef.current = null;
  }, [renderedTextBoxesById, selectedTextBoxId]);

  useEffect(() => {
    if (!editingTextBoxId || activeTool !== "text") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      textAreaRef.current?.focus();
      const textLength = textAreaRef.current?.value.length ?? 0;
      textAreaRef.current?.setSelectionRange(textLength, textLength);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTool, editingTextBoxId]);

  useEffect(() => {
    if (!editingTextBoxId || !textAreaRef.current || !canvasShellRef.current) {
      return;
    }

    const textBox = renderedTextBoxesById.get(editingTextBoxId);
    if (!textBox) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const shellRect = canvasShellRef.current?.getBoundingClientRect();
      const textarea = textAreaRef.current;
      if (!shellRect?.height || !textarea) {
        return;
      }

      const requiredHeight = Math.max(textarea.scrollHeight, MIN_TEXTBOX_HEIGHT_PX);
      const normalizedHeight = clamp(requiredHeight / shellRect.height, textBox.height, 1 - textBox.y);
      if (normalizedHeight <= textBox.height + 0.0005) {
        return;
      }

      const nextTextBox = {
        ...textBox,
        height: normalizedHeight,
        updatedAt: new Date().toISOString(),
      } satisfies WhiteboardTextBox;
      upsertOptimisticTextBox(nextTextBox);
      props.onTextBoxUpsert(nextTextBox);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [editingTextBoxId, renderedTextBoxesById]);

  useEffect(() => {
    if (activeTool !== "text" || !selectedTextBoxId || editingTextBoxId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || isEditableEventTarget(event.target)) {
        return;
      }

      const textBox = renderedTextBoxesRef.current.get(selectedTextBoxId);
      if (!textBox || !canEditText) {
        return;
      }

      event.preventDefault();
      deleteTextBox(textBox);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTool, canEditText, editingTextBoxId, selectedTextBoxId]);

  function beginStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (!canDraw || !props.participantId) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current);
    if (!point) {
      return;
    }

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

  function continueStroke(event: ReactPointerEvent<SVGSVGElement>) {
    const current = currentStrokeRef.current;
    if (!canDraw || !current) {
      return;
    }

    event.preventDefault();
    const point = getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current);
    if (!point) {
      return;
    }

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

  function finishStroke(event: ReactPointerEvent<SVGSVGElement>) {
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

  function upsertOptimisticTextBox(textBox: WhiteboardTextBox) {
    setOptimisticTextBoxes((current) => ({
      ...current,
      [textBox.textBoxId]: textBox,
    }));
  }

  function flushTextEditSession(): boolean {
    const session = textEditSessionRef.current;
    if (!session) {
      return true;
    }

    const current = renderedTextBoxesRef.current.get(session.baseline.textBoxId);
    if (!current || current.removedAt) {
      textEditSessionRef.current = null;
      return true;
    }

    if (isSameWhiteboardTextBoxSnapshot(session.baseline, current)) {
      textEditSessionRef.current = null;
      return true;
    }

    const committed = props.onTextBoxCommit({
      type: "textbox.update",
      occurredAt: new Date().toISOString(),
      participantId: props.participantId ?? current.participantId,
      before: snapshotWhiteboardTextBox(session.baseline),
      after: snapshotWhiteboardTextBox(current),
    });

    if (committed) {
      textEditSessionRef.current = null;
    }

    return committed;
  }

  function beginTextEditSession(textBox: WhiteboardTextBox) {
    if (textEditSessionRef.current?.baseline.textBoxId === textBox.textBoxId) {
      return;
    }

    textEditSessionRef.current = {
      baseline: snapshotWhiteboardTextBox(textBox),
    };
  }

  function switchTool(nextTool: WhiteboardTool) {
    if (nextTool === activeTool) {
      return;
    }

    flushTextEditSession();
    setThicknessOpen(false);
    setEditingTextBoxId(null);
    if (nextTool === "pen") {
      setSelectedTextBoxId(null);
    }
    setActiveTool(nextTool);
  }

  function handleCommand(action: () => boolean) {
    flushTextEditSession();
    setEditingTextBoxId(null);
    action();
  }

  function handleClose() {
    flushTextEditSession();
    setEditingTextBoxId(null);
    setSelectedTextBoxId(null);
    props.onClose();
  }

  function beginTextSurfaceInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditText || !props.participantId || event.target !== event.currentTarget) {
      return;
    }

    flushTextEditSession();
    setEditingTextBoxId(null);
    setThicknessOpen(false);

    const point = getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current);
    const shellRect = canvasShellRef.current?.getBoundingClientRect();
    if (!point || !shellRect) {
      return;
    }

    const minimumSize = getMinimumTextBoxSize(shellRect);
    const anchor = {
      x: clamp(point.x, 0, 1 - minimumSize.width),
      y: clamp(point.y, 0, 1 - minimumSize.height),
    } satisfies WhiteboardPoint;

    const textBox = {
      textBoxId: createTextBoxId(props.participantId),
      participantId: props.participantId,
      x: anchor.x,
      y: anchor.y,
      width: minimumSize.width,
      height: minimumSize.height,
      text: "",
      fontSize: textFontSize,
      color: textColor,
      updatedAt: new Date().toISOString(),
      removedAt: null,
    } satisfies WhiteboardTextBox;

    textInteractionRef.current = {
      type: "creating",
      pointerId: event.pointerId,
      startPoint: anchor,
      textBoxId: textBox.textBoxId,
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedTextBoxId(textBox.textBoxId);
    upsertOptimisticTextBox(textBox);
    props.onTextBoxUpsert(textBox);
  }

  function continueTextSurfaceInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = textInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || interaction.type !== "creating") {
      return;
    }

    const point = getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current);
    const shellRect = canvasShellRef.current?.getBoundingClientRect();
    const current = renderedTextBoxesRef.current.get(interaction.textBoxId);
    if (!point || !shellRect || !current) {
      return;
    }

    event.preventDefault();
    const minimumSize = getMinimumTextBoxSize(shellRect);
    const nextTextBox = {
      ...current,
      width: clamp(
        Math.max(point.x - interaction.startPoint.x, minimumSize.width),
        minimumSize.width,
        1 - interaction.startPoint.x,
      ),
      height: clamp(
        Math.max(point.y - interaction.startPoint.y, minimumSize.height),
        minimumSize.height,
        1 - interaction.startPoint.y,
      ),
      updatedAt: new Date().toISOString(),
    } satisfies WhiteboardTextBox;

    upsertOptimisticTextBox(nextTextBox);
    props.onTextBoxUpsert(nextTextBox);
  }

  function finishTextSurfaceInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = textInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || interaction.type !== "creating") {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}

    const textBox = renderedTextBoxesRef.current.get(interaction.textBoxId);
    textInteractionRef.current = null;
    if (!textBox) {
      return;
    }

    const finalTextBox = {
      ...textBox,
      updatedAt: new Date().toISOString(),
      removedAt: null,
    } satisfies WhiteboardTextBox;

    upsertOptimisticTextBox(finalTextBox);
    props.onTextBoxUpsert(finalTextBox);
    props.onTextBoxCommit({
      type: "textbox.create",
      occurredAt: new Date().toISOString(),
      participantId: props.participantId ?? finalTextBox.participantId,
      textBox: snapshotWhiteboardTextBox(finalTextBox),
    });
    textEditSessionRef.current = {
      baseline: snapshotWhiteboardTextBox(finalTextBox),
    };
    setSelectedTextBoxId(finalTextBox.textBoxId);
    setEditingTextBoxId(finalTextBox.textBoxId);
  }

  function handleTextBoxFramePointerDown(event: ReactPointerEvent<HTMLDivElement>, textBox: WhiteboardTextBox) {
    if (!canEditText || event.target !== event.currentTarget) {
      return;
    }

    flushTextEditSession();
    setEditingTextBoxId(null);
    setSelectedTextBoxId(textBox.textBoxId);
    textInteractionRef.current = {
      type: "moving",
      origin: snapshotWhiteboardTextBox(textBox),
      pointerId: event.pointerId,
      startPoint: getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current) ?? {
        x: textBox.x,
        y: textBox.y,
      },
      textBoxId: textBox.textBoxId,
    };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTextBoxResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>, textBox: WhiteboardTextBox) {
    if (!canEditText) {
      return;
    }

    flushTextEditSession();
    setEditingTextBoxId(null);
    setSelectedTextBoxId(textBox.textBoxId);
    textInteractionRef.current = {
      type: "resizing",
      origin: snapshotWhiteboardTextBox(textBox),
      pointerId: event.pointerId,
      startPoint: getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current) ?? {
        x: textBox.x + textBox.width,
        y: textBox.y + textBox.height,
      },
      textBoxId: textBox.textBoxId,
    };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueTextBoxInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = textInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || interaction.type === "creating") {
      return;
    }

    const currentPoint = getWhiteboardPoint(event.clientX, event.clientY, canvasShellRef.current);
    const shellRect = canvasShellRef.current?.getBoundingClientRect();
    if (!currentPoint || !shellRect) {
      return;
    }

    event.preventDefault();
    const minimumSize = getMinimumTextBoxSize(shellRect);
    if (interaction.type === "moving") {
      const deltaX = currentPoint.x - interaction.startPoint.x;
      const deltaY = currentPoint.y - interaction.startPoint.y;
      const nextTextBox = {
        ...interaction.origin,
        x: clamp(interaction.origin.x + deltaX, 0, 1 - interaction.origin.width),
        y: clamp(interaction.origin.y + deltaY, 0, 1 - interaction.origin.height),
        updatedAt: new Date().toISOString(),
      } satisfies WhiteboardTextBox;

      upsertOptimisticTextBox(nextTextBox);
      props.onTextBoxUpsert(nextTextBox);
      return;
    }

    const nextTextBox = {
      ...interaction.origin,
      width: clamp(
        interaction.origin.width + (currentPoint.x - interaction.startPoint.x),
        minimumSize.width,
        1 - interaction.origin.x,
      ),
      height: clamp(
        interaction.origin.height + (currentPoint.y - interaction.startPoint.y),
        minimumSize.height,
        1 - interaction.origin.y,
      ),
      updatedAt: new Date().toISOString(),
    } satisfies WhiteboardTextBox;

    upsertOptimisticTextBox(nextTextBox);
    props.onTextBoxUpsert(nextTextBox);
  }

  function finishTextBoxInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = textInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || interaction.type === "creating") {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}

    const finalTextBox = renderedTextBoxesRef.current.get(interaction.textBoxId);
    textInteractionRef.current = null;
    if (!finalTextBox || isSameWhiteboardTextBoxSnapshot(interaction.origin, finalTextBox)) {
      return;
    }

    props.onTextBoxCommit({
      type: "textbox.update",
      occurredAt: new Date().toISOString(),
      participantId: props.participantId ?? finalTextBox.participantId,
      before: snapshotWhiteboardTextBox(interaction.origin),
      after: snapshotWhiteboardTextBox(finalTextBox),
    });
  }

  function handleTextBoxContentClick(textBox: WhiteboardTextBox) {
    if (activeTool !== "text") {
      return;
    }

    if (selectedTextBoxId !== textBox.textBoxId) {
      flushTextEditSession();
      setEditingTextBoxId(null);
      setSelectedTextBoxId(textBox.textBoxId);
      return;
    }

    if (!canEditText) {
      return;
    }

    beginTextEditSession(textBox);
    setEditingTextBoxId(textBox.textBoxId);
  }

  function updateSelectedTextBoxText(text: string) {
    const textBox = selectedTextBoxId ? renderedTextBoxesRef.current.get(selectedTextBoxId) : null;
    if (!textBox || !canEditText) {
      return;
    }

    beginTextEditSession(textBox);
    const nextTextBox = {
      ...textBox,
      text,
      updatedAt: new Date().toISOString(),
    } satisfies WhiteboardTextBox;
    upsertOptimisticTextBox(nextTextBox);
    props.onTextBoxUpsert(nextTextBox);
  }

  function updateSelectedTextBoxStyle(next: Partial<Pick<WhiteboardTextBox, "color" | "fontSize">>) {
    const textBox = selectedTextBoxId ? renderedTextBoxesRef.current.get(selectedTextBoxId) : null;
    if (!textBox || !canEditText) {
      return;
    }

    beginTextEditSession(textBox);
    const nextTextBox = {
      ...textBox,
      ...next,
      updatedAt: new Date().toISOString(),
    } satisfies WhiteboardTextBox;
    upsertOptimisticTextBox(nextTextBox);
    props.onTextBoxUpsert(nextTextBox);
  }

  function deleteTextBox(textBox: WhiteboardTextBox) {
    flushTextEditSession();
    const removedAt = new Date().toISOString();
    const hiddenTextBox = {
      ...textBox,
      removedAt,
      updatedAt: removedAt,
    } satisfies WhiteboardTextBox;

    upsertOptimisticTextBox(hiddenTextBox);
    props.onTextBoxUpsert(hiddenTextBox);
    props.onTextBoxCommit({
      type: "textbox.delete",
      occurredAt: removedAt,
      participantId: props.participantId ?? textBox.participantId,
      textBox: snapshotWhiteboardTextBox(textBox),
    });
    textEditSessionRef.current = null;
    setEditingTextBoxId(null);
    setSelectedTextBoxId(null);
  }

  return (
    <section className="meeting-whiteboard" aria-label="Whiteboard">
      <div className="meeting-whiteboard__topbar">
        <div className="meeting-whiteboard__toolset">
          <button
            className={`meeting-whiteboard__tool-pill${activeTool === "pen" ? " meeting-whiteboard__tool-pill--active" : ""}`}
            onClick={() => {
              switchTool("pen");
            }}
            type="button"
          >
            <PenToolIcon />
            <span>Pen</span>
          </button>
          <button
            className={`meeting-whiteboard__tool-pill${activeTool === "text" ? " meeting-whiteboard__tool-pill--active" : ""}`}
            onClick={() => {
              switchTool("text");
            }}
            type="button"
          >
            <TextToolIcon />
            <span>Text</span>
          </button>
          {activeTool === "pen" ? (
            <>
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
            </>
          ) : (
            <span className="meeting-whiteboard__hint">Drag to create textbox</span>
          )}
        </div>

        {textOptionsVisible && selectedTextBox ? (
          <div className="meeting-whiteboard__text-options">
            <label className="meeting-whiteboard__text-size">
              <span>Size</span>
              <input
                aria-label="Text size"
                max="96"
                min="12"
                onChange={(event) => {
                  const nextFontSize = clamp(Number(event.target.value) || DEFAULT_TEXTBOX_FONT_SIZE, 12, 96);
                  setTextFontSize(nextFontSize);
                  updateSelectedTextBoxStyle({ fontSize: nextFontSize });
                }}
                type="number"
                value={textFontSize}
              />
            </label>
            <div className="meeting-whiteboard__swatches" aria-label="Text colour">
              {WHITEBOARD_COLORS.map((color) => (
                <button
                  aria-label={`Text colour ${color}`}
                  className={`meeting-whiteboard__swatch${selectedTextBox.color === color ? " is-active" : ""}`}
                  key={`text-${color}`}
                  onClick={() => {
                    setTextColor(color);
                    updateSelectedTextBoxStyle({ color });
                  }}
                  style={{ ["--whiteboard-swatch-color" as string]: color }}
                  type="button"
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="meeting-whiteboard__actions">
          <button
            aria-label="Close whiteboard"
            className="meeting-whiteboard__action-button meeting-whiteboard__action-button--close"
            onClick={handleClose}
            title="Close whiteboard"
            type="button"
          >
            <CloseIcon />
          </button>
          <button
            aria-label="Clear whiteboard"
            className="meeting-whiteboard__action-button"
            disabled={historyActionsDisabled || !props.canClear}
            onClick={() => {
              handleCommand(props.onClear);
            }}
            title="Clear whiteboard"
            type="button"
          >
            <ClearWhiteboardIcon />
          </button>
          <button
            aria-label="Undo whiteboard change"
            className="meeting-whiteboard__action-button"
            disabled={historyActionsDisabled || !props.canUndo}
            onClick={() => {
              handleCommand(props.onUndo);
            }}
            title="Undo"
            type="button"
          >
            <UndoIcon />
          </button>
          <button
            aria-label="Redo whiteboard change"
            className="meeting-whiteboard__action-button"
            disabled={historyActionsDisabled || !props.canRedo}
            onClick={() => {
              handleCommand(props.onRedo);
            }}
            title="Redo"
            type="button"
          >
            <RedoIcon />
          </button>
        </div>
      </div>

      <div className="meeting-whiteboard__canvas-shell" ref={canvasShellRef}>
        <svg
          className={`meeting-whiteboard__canvas meeting-whiteboard__canvas--${activeTool}`}
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

        <div
          className={`meeting-whiteboard__text-layer${activeTool === "text" ? " is-active" : ""}`}
          onPointerCancel={finishTextSurfaceInteraction}
          onPointerDown={beginTextSurfaceInteraction}
          onPointerMove={continueTextSurfaceInteraction}
          onPointerUp={finishTextSurfaceInteraction}
        >
          {renderedTextBoxes.map((textBox) => {
            const isSelected = selectedTextBoxId === textBox.textBoxId;
            const isEditing = editingTextBoxId === textBox.textBoxId;
            return (
              <div
                className={`meeting-whiteboard__textbox${isSelected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
                key={textBox.textBoxId}
                onPointerCancel={finishTextBoxInteraction}
                onPointerDown={(event) => {
                  handleTextBoxFramePointerDown(event, textBox);
                }}
                onPointerMove={continueTextBoxInteraction}
                onPointerUp={finishTextBoxInteraction}
                style={{
                  left: `${textBox.x * 100}%`,
                  top: `${textBox.y * 100}%`,
                  width: `${textBox.width * 100}%`,
                  height: `${textBox.height * 100}%`,
                }}
              >
                <div className="meeting-whiteboard__textbox-content">
                  {isEditing ? (
                    <textarea
                      className="meeting-whiteboard__textbox-editor"
                      onBlur={() => {
                        setEditingTextBoxId((current) => (current === textBox.textBoxId ? null : current));
                        flushTextEditSession();
                      }}
                      onChange={(event) => {
                        updateSelectedTextBoxText(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingTextBoxId(null);
                          flushTextEditSession();
                        }
                      }}
                      ref={textAreaRef}
                      style={{
                        color: textBox.color,
                        fontSize: `${textBox.fontSize}px`,
                      }}
                      value={textBox.text}
                    />
                  ) : (
                    <button
                      className="meeting-whiteboard__textbox-button"
                      onClick={() => {
                        handleTextBoxContentClick(textBox);
                      }}
                      style={{
                        color: textBox.color,
                        fontSize: `${textBox.fontSize}px`,
                      }}
                      type="button"
                    >
                      {textBox.text}
                    </button>
                  )}
                </div>

                {isSelected && activeTool === "text" ? (
                  <button
                    aria-label="Resize textbox"
                    className="meeting-whiteboard__textbox-resize"
                    onPointerCancel={finishTextBoxInteraction}
                    onPointerDown={(event) => {
                      handleTextBoxResizePointerDown(event, textBox);
                    }}
                    onPointerMove={continueTextBoxInteraction}
                    onPointerUp={finishTextBoxInteraction}
                    type="button"
                  />
                ) : null}
              </div>
            );
          })}
        </div>

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

function getWhiteboardPoint(
  clientX: number,
  clientY: number,
  canvasShell: HTMLDivElement | null,
): WhiteboardPoint | null {
  const rect = canvasShell?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return null;
  }

  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
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
  if (remoteStroke.removedAt) {
    return true;
  }

  if (remoteStroke.completedAt && optimisticStroke.completedAt) {
    return true;
  }

  return (
    remoteStroke.points.length >= optimisticStroke.points.length &&
    remoteStroke.updatedAt >= optimisticStroke.updatedAt
  );
}

function isRemoteTextBoxCaughtUp(remoteTextBox: WhiteboardTextBox, optimisticTextBox: WhiteboardTextBox): boolean {
  if (remoteTextBox.removedAt) {
    return true;
  }

  return remoteTextBox.updatedAt >= optimisticTextBox.updatedAt;
}

function getMinimumTextBoxSize(rect: DOMRect): { height: number; width: number } {
  if (!rect.width || !rect.height) {
    return {
      width: 0.12,
      height: 0.08,
    };
  }

  return {
    width: Math.min(1, MIN_TEXTBOX_WIDTH_PX / rect.width),
    height: Math.min(1, MIN_TEXTBOX_HEIGHT_PX / rect.height),
  };
}

function snapshotWhiteboardTextBox(textBox: WhiteboardTextBox): WhiteboardTextBox {
  return {
    ...textBox,
    removedAt: null,
  };
}

function isSameWhiteboardTextBoxSnapshot(first: WhiteboardTextBox, second: WhiteboardTextBox): boolean {
  return (
    first.textBoxId === second.textBoxId &&
    first.participantId === second.participantId &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height &&
    first.text === second.text &&
    first.fontSize === second.fontSize &&
    first.color === second.color
  );
}

function createStrokeId(participantId: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${participantId}:${randomId}`;
}

function createTextBoxId(participantId: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${participantId}:textbox:${randomId}`;
}

function getPointDistance(first: WhiteboardPoint, second: WhiteboardPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "select" || tagName === "textarea";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
