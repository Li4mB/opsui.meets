import type {
  LiveRole,
  RealtimeConnectionState,
  RealtimeRoomSnapshot,
  RealtimeRoomStatePatch,
  RoomEvent,
  WhiteboardHistoryAction,
  WhiteboardStroke,
  WhiteboardTextBox,
  WhiteboardTextBoxHistoryAction,
} from "@opsui/shared-types";

interface Env {}

interface SocketHelloPayload {
  participantId: string;
  meetingInstanceId: string;
  displayName: string;
  role: LiveRole;
}

interface SignalPayloadBase {
  toParticipantId: string;
}

type ClientMessage =
  | { type: "ping" }
  | { type: "snapshot.request" }
  | { type: "hello"; payload: SocketHelloPayload }
  | { type: "hand.raise"; payload: { participantId: string } }
  | { type: "hand.lower"; payload: { participantId: string } }
  | { type: "signal.offer"; payload: SignalPayloadBase & { sdp: string } }
  | { type: "signal.answer"; payload: SignalPayloadBase & { sdp: string } }
  | { type: "signal.ice"; payload: SignalPayloadBase & { candidate: string; mid?: string; mLineIndex?: number } }
  | { type: "room.lock"; payload: { participantId: string } }
  | { type: "room.unlock"; payload: { participantId: string } }
  | { type: "recording.state"; payload: { participantId: string; state: RealtimeRoomSnapshot["recordingState"] } }
  | { type: "whiteboard.stroke.upsert"; payload: { stroke: WhiteboardStroke } }
  | { type: "whiteboard.textbox.upsert"; payload: { textBox: WhiteboardTextBox } }
  | { type: "whiteboard.textbox.commit"; payload: { action: WhiteboardTextBoxHistoryAction } }
  | { type: "whiteboard.clear" }
  | { type: "whiteboard.undo" }
  | { type: "whiteboard.redo" };

interface ConnectionAttachment {
  participantId?: string;
  meetingInstanceId?: string;
}

export class RoomCoordinator {
  private readonly ctx: DurableObjectState;
  private snapshot: RealtimeRoomSnapshot = createSnapshot();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RealtimeRoomSnapshot>("snapshot");
      if (stored) {
        this.snapshot = normalizeSnapshot(stored);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/snapshot")) {
      return Response.json(this.snapshot);
    }

    if (request.method === "POST" && url.pathname.endsWith("/state")) {
      const patch = (await request.json().catch(() => null)) as RealtimeRoomStatePatch | null;
      if (!patch?.meetingInstanceId) {
        return Response.json(
          {
            ok: false,
            error: "invalid_realtime_patch",
          },
          { status: 400 },
        );
      }

      await this.applyPatch(patch);
      return Response.json({
        ok: true,
        snapshot: this.snapshot,
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(this.snapshot);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = JSON.parse(raw) as ClientMessage;

    if (parsed.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", occurredAt: new Date().toISOString() }));
      return;
    }

    if (parsed.type === "snapshot.request") {
      ws.send(JSON.stringify({ type: "room.snapshot", payload: this.snapshot }));
      return;
    }

    if (parsed.type === "hello") {
      const payload = parsed.payload;
      ws.serializeAttachment({
        participantId: payload.participantId,
        meetingInstanceId: payload.meetingInstanceId,
      } satisfies ConnectionAttachment);

      this.snapshot.meetingInstanceId = payload.meetingInstanceId;
      this.snapshot.participants[payload.participantId] = {
        participantId: payload.participantId,
        meetingInstanceId: payload.meetingInstanceId,
        displayName: payload.displayName,
        role: payload.role,
        presence: "active",
        lastSeenAt: new Date().toISOString(),
      };

      ws.send(JSON.stringify({ type: "room.snapshot", payload: this.snapshot }));

      await this.persistAndBroadcast({
        type: "participant.join",
        actorParticipantId: payload.participantId,
        payload: {
          participantId: payload.participantId,
          displayName: payload.displayName,
          role: payload.role,
        },
      });
      return;
    }

    if (parsed.type === "signal.offer" || parsed.type === "signal.answer" || parsed.type === "signal.ice") {
      const sender = this.getAttachment(ws);
      if (!sender?.participantId) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "missing_sender_identity" } }));
        return;
      }

      const delivered = this.sendToParticipant(parsed.payload.toParticipantId, {
        type: parsed.type,
        payload: {
          ...parsed.payload,
          fromParticipantId: sender.participantId,
        },
      });

      if (!delivered) {
        ws.send(
          JSON.stringify({
            type: "error",
            payload: {
              reason: "target_not_connected",
              toParticipantId: parsed.payload.toParticipantId,
            },
          }),
        );
      }
      return;
    }

    if (parsed.type === "hand.raise") {
      const participantId = parsed.payload.participantId;
      this.snapshot.handsRaised = unique([...this.snapshot.handsRaised, participantId]);
      await this.persistAndBroadcast({
        type: "participant.hand_raised",
        actorParticipantId: participantId,
        payload: { participantId },
      });
      return;
    }

    if (parsed.type === "hand.lower") {
      const participantId = parsed.payload.participantId;
      this.snapshot.handsRaised = this.snapshot.handsRaised.filter((id) => id !== participantId);
      await this.persistAndBroadcast({
        type: "participant.hand_lowered",
        actorParticipantId: participantId,
        payload: { participantId },
      });
      return;
    }

    if (parsed.type === "room.lock" || parsed.type === "room.unlock") {
      this.snapshot.lockState = parsed.type === "room.lock" ? "locked" : "unlocked";
      await this.persistAndBroadcast({
        type: parsed.type === "room.lock" ? "room.locked" : "room.unlocked",
        actorParticipantId: parsed.payload.participantId,
        payload: {
          participantId: parsed.payload.participantId,
          lockState: this.snapshot.lockState,
        },
      });
      return;
    }

    if (parsed.type === "recording.state") {
      this.snapshot.recordingState = parsed.payload.state;
      await this.persistAndBroadcast({
        type: parsed.payload.state === "recording" ? "recording.started" : "recording.stopped",
        actorParticipantId: parsed.payload.participantId,
        payload: {
          participantId: parsed.payload.participantId,
          recordingState: this.snapshot.recordingState,
        },
      });
      return;
    }

    if (parsed.type === "whiteboard.stroke.upsert") {
      const senderParticipantId = this.requireSenderParticipantId(ws);
      if (!senderParticipantId) {
        return;
      }

      const stroke = sanitizeWhiteboardStroke(parsed.payload.stroke, senderParticipantId);
      if (!stroke) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "invalid_whiteboard_stroke" } }));
        return;
      }

      const existingStroke = this.snapshot.whiteboard.strokes.find(
        (entry) => entry.strokeId === stroke.strokeId,
      );
      const completedForFirstTime = Boolean(stroke.completedAt && !existingStroke?.completedAt);
      const nextStroke = {
        ...stroke,
        removedAt: existingStroke?.removedAt ?? null,
      } satisfies WhiteboardStroke;

      this.snapshot.whiteboard = upsertWhiteboardStroke(this.snapshot.whiteboard, nextStroke);

      if (completedForFirstTime) {
        this.snapshot.whiteboard = commitWhiteboardAction(
          this.snapshot.whiteboard,
          {
            occurredAt: stroke.completedAt ?? stroke.updatedAt,
            participantId: senderParticipantId,
            strokeId: stroke.strokeId,
            type: "stroke",
          },
          stroke.updatedAt,
        );
      }

      this.snapshot.whiteboard = pruneWhiteboardState(this.snapshot.whiteboard);
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "whiteboard.stroke.upsert",
        payload: { stroke: nextStroke },
      });
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }

    if (parsed.type === "whiteboard.textbox.upsert") {
      const senderParticipantId = this.requireSenderParticipantId(ws);
      if (!senderParticipantId) {
        return;
      }

      const existingTextBox = this.snapshot.whiteboard.textBoxes.find(
        (entry) => entry.textBoxId === parsed.payload.textBox.textBoxId,
      );
      const textBox = sanitizeWhiteboardTextBox(
        parsed.payload.textBox,
        existingTextBox?.participantId ?? senderParticipantId,
      );
      if (!textBox) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "invalid_whiteboard_textbox" } }));
        return;
      }

      const nextTextBox = {
        ...textBox,
        removedAt: textBox.removedAt ?? existingTextBox?.removedAt ?? null,
      } satisfies WhiteboardTextBox;

      this.snapshot.whiteboard = upsertWhiteboardTextBox(this.snapshot.whiteboard, nextTextBox);
      this.snapshot.whiteboard = pruneWhiteboardState(this.snapshot.whiteboard);
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "whiteboard.textbox.upsert",
        payload: { textBox: nextTextBox },
      });
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }

    if (parsed.type === "whiteboard.textbox.commit") {
      const senderParticipantId = this.requireSenderParticipantId(ws);
      if (!senderParticipantId) {
        return;
      }

      const action = sanitizeWhiteboardTextBoxHistoryAction(parsed.payload.action, senderParticipantId);
      if (!action) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "invalid_whiteboard_textbox_action" } }));
        return;
      }

      const nextWhiteboard = commitWhiteboardTextBoxAction(this.snapshot.whiteboard, action);
      if (nextWhiteboard === this.snapshot.whiteboard) {
        return;
      }

      this.snapshot.whiteboard = nextWhiteboard;
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }

    if (parsed.type === "whiteboard.clear") {
      const senderParticipantId = this.requireSenderParticipantId(ws);
      if (!senderParticipantId) {
        return;
      }

      const nextWhiteboard = clearWhiteboard(this.snapshot.whiteboard, senderParticipantId);
      if (nextWhiteboard === this.snapshot.whiteboard) {
        return;
      }

      this.snapshot.whiteboard = nextWhiteboard;
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }

    if (parsed.type === "whiteboard.undo") {
      if (!this.requireSenderParticipantId(ws)) {
        return;
      }

      const nextWhiteboard = undoWhiteboard(this.snapshot.whiteboard);
      if (nextWhiteboard === this.snapshot.whiteboard) {
        return;
      }

      this.snapshot.whiteboard = nextWhiteboard;
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }

    if (parsed.type === "whiteboard.redo") {
      if (!this.requireSenderParticipantId(ws)) {
        return;
      }

      const nextWhiteboard = redoWhiteboard(this.snapshot.whiteboard);
      if (nextWhiteboard === this.snapshot.whiteboard) {
        return;
      }

      this.snapshot.whiteboard = nextWhiteboard;
      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
      return;
    }
  }

  private async applyPatch(patch: RealtimeRoomStatePatch): Promise<void> {
    this.snapshot.meetingInstanceId = patch.meetingInstanceId;
    this.snapshot.meetingStatus = patch.meetingStatus ?? this.snapshot.meetingStatus;
    this.snapshot.lockState = patch.lockState ?? this.snapshot.lockState;
    this.snapshot.recordingState = patch.recordingState ?? this.snapshot.recordingState;
    this.snapshot.mutedAllAt = patch.mutedAllAt === undefined ? this.snapshot.mutedAllAt : patch.mutedAllAt;
    this.snapshot.endedAt = patch.endedAt === undefined ? this.snapshot.endedAt : patch.endedAt;
    if (patch.handsRaised) {
      this.snapshot.handsRaised = unique(patch.handsRaised);
    }

    for (const participantPatch of patch.participants ?? []) {
      const existing = this.snapshot.participants[participantPatch.participantId];
      const nextPresence = participantPatch.presence;
      if (nextPresence === "removed") {
        delete this.snapshot.participants[participantPatch.participantId];
        this.snapshot.handsRaised = this.snapshot.handsRaised.filter((id) => id !== participantPatch.participantId);
        this.snapshot.lobby = this.snapshot.lobby.filter((id) => id !== participantPatch.participantId);
        continue;
      }

      const nextState: RealtimeConnectionState = {
        participantId: participantPatch.participantId,
        meetingInstanceId: patch.meetingInstanceId,
        displayName: participantPatch.displayName ?? existing?.displayName ?? participantPatch.participantId,
        role: participantPatch.role ?? existing?.role ?? "participant",
        presence: nextPresence ?? existing?.presence ?? "active",
        lastSeenAt: new Date().toISOString(),
      };
      this.snapshot.participants[participantPatch.participantId] = nextState;
    }

    this.snapshot.lobby = Object.values(this.snapshot.participants)
      .filter((participant) => participant.presence === "lobby")
      .map((participant) => participant.participantId);

    if (patch.endedAt) {
      this.snapshot.meetingStatus = "ended";
    }

    if (patch.event) {
      await this.persistAndBroadcast(patch.event);
      return;
    }

    await this.ctx.storage.put("snapshot", this.snapshot);
    this.broadcast({
      type: "room.snapshot",
      payload: this.snapshot,
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const participantId = this.getAttachment(ws)?.participantId;

    if (!participantId) {
      return;
    }

    delete this.snapshot.participants[participantId];
    this.snapshot.handsRaised = this.snapshot.handsRaised.filter((id) => id !== participantId);

    await this.persistAndBroadcast({
      type: "participant.leave",
      actorParticipantId: participantId,
      payload: { participantId },
    });
  }

  private async persistAndBroadcast(
    input: Omit<RoomEvent, "eventId" | "roomEventNumber" | "meetingInstanceId" | "occurredAt">,
  ): Promise<void> {
    this.snapshot.lastEventNumber += 1;
    await this.ctx.storage.put("snapshot", this.snapshot);

    const event: RoomEvent = {
      eventId: crypto.randomUUID(),
      roomEventNumber: this.snapshot.lastEventNumber,
      meetingInstanceId: this.snapshot.meetingInstanceId ?? "unknown",
      occurredAt: new Date().toISOString(),
      ...input,
    };

    const serialized = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(serialized);
    }

    this.broadcast({
      type: "room.snapshot",
      payload: this.snapshot,
    });
  }

  private broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(serialized);
    }
  }

  private sendToParticipant(participantId: string, message: unknown): boolean {
    const serialized = JSON.stringify(message);
    let delivered = false;

    for (const socket of this.ctx.getWebSockets()) {
      if (this.getAttachment(socket)?.participantId === participantId) {
        socket.send(serialized);
        delivered = true;
      }
    }

    return delivered;
  }

  private requireSenderParticipantId(ws: WebSocket): string | null {
    const participantId = this.getAttachment(ws)?.participantId;
    if (participantId) {
      return participantId;
    }

    ws.send(JSON.stringify({ type: "error", payload: { reason: "missing_sender_identity" } }));
    return null;
  }

  private getAttachment(ws: WebSocket): ConnectionAttachment | null {
    return (ws.deserializeAttachment() as ConnectionAttachment | null) ?? null;
  }
}

function createSnapshot(): RealtimeRoomSnapshot {
  return {
    meetingInstanceId: null,
    meetingStatus: null,
    lockState: "unlocked",
    recordingState: "idle",
    participants: {},
    lobby: [],
    handsRaised: [],
    mutedAllAt: null,
    endedAt: null,
    lastEventNumber: 0,
    whiteboard: createEmptyWhiteboardState(),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const MAX_WHITEBOARD_POINTS_PER_STROKE = 1_200;
const MAX_WHITEBOARD_HISTORY_ACTIONS = 200;
const MAX_WHITEBOARD_TEXT_LENGTH = 4_000;
const DEFAULT_WHITEBOARD_TEXTBOX_COLOR = "#0f172a";
const DEFAULT_WHITEBOARD_TEXTBOX_FONT_SIZE = 24;
const MIN_WHITEBOARD_TEXTBOX_DIMENSION = 0.01;

function normalizeSnapshot(snapshot: RealtimeRoomSnapshot): RealtimeRoomSnapshot {
  return {
    ...snapshot,
    whiteboard: normalizeWhiteboardState(snapshot.whiteboard),
  };
}

function sanitizeWhiteboardStroke(stroke: WhiteboardStroke, participantId: string): WhiteboardStroke | null {
  if (!stroke || typeof stroke.strokeId !== "string" || !stroke.strokeId.trim()) {
    return null;
  }

  const points = Array.isArray(stroke.points)
    ? stroke.points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({
          x: clamp(point.x, 0, 1),
          y: clamp(point.y, 0, 1),
        }))
        .slice(0, MAX_WHITEBOARD_POINTS_PER_STROKE)
    : [];

  if (!points.length) {
    return null;
  }

  return {
    strokeId: stroke.strokeId.slice(0, 96),
    participantId,
    color: isValidHexColor(stroke.color) ? stroke.color : "#0f172a",
    thickness: clamp(stroke.thickness, 1, 24),
    mode: stroke.mode === "smooth" ? "smooth" : "direct",
    points,
    updatedAt: new Date().toISOString(),
    completedAt: stroke.completedAt ? new Date().toISOString() : null,
    removedAt: null,
  };
}

function createEmptyWhiteboardState(): RealtimeRoomSnapshot["whiteboard"] {
  return {
    strokes: [],
    textBoxes: [],
    undoStack: [],
    redoStack: [],
    updatedAt: null,
  };
}

function normalizeWhiteboardState(
  state: RealtimeRoomSnapshot["whiteboard"] | null | undefined,
): RealtimeRoomSnapshot["whiteboard"] {
  if (!state) {
    return createEmptyWhiteboardState();
  }

  return pruneWhiteboardState({
    strokes: Array.isArray(state.strokes)
      ? state.strokes
          .map(normalizeStoredWhiteboardStroke)
          .filter((stroke): stroke is WhiteboardStroke => Boolean(stroke))
      : [],
    textBoxes: Array.isArray(state.textBoxes)
      ? state.textBoxes
          .map(normalizeStoredWhiteboardTextBox)
          .filter((textBox): textBox is WhiteboardTextBox => Boolean(textBox))
      : [],
    undoStack: Array.isArray(state.undoStack)
      ? state.undoStack
          .map(normalizeWhiteboardHistoryAction)
          .filter((action): action is WhiteboardHistoryAction => Boolean(action))
          .slice(-MAX_WHITEBOARD_HISTORY_ACTIONS)
      : [],
    redoStack: Array.isArray(state.redoStack)
      ? state.redoStack
          .map(normalizeWhiteboardHistoryAction)
          .filter((action): action is WhiteboardHistoryAction => Boolean(action))
          .slice(-MAX_WHITEBOARD_HISTORY_ACTIONS)
      : [],
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
  });
}

function normalizeStoredWhiteboardStroke(stroke: WhiteboardStroke): WhiteboardStroke | null {
  if (!stroke || typeof stroke.strokeId !== "string" || !stroke.strokeId.trim()) {
    return null;
  }

  const points = Array.isArray(stroke.points)
    ? stroke.points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({
          x: clamp(point.x, 0, 1),
          y: clamp(point.y, 0, 1),
        }))
        .slice(0, MAX_WHITEBOARD_POINTS_PER_STROKE)
    : [];

  if (!points.length) {
    return null;
  }

  return {
    strokeId: stroke.strokeId.slice(0, 96),
    participantId: typeof stroke.participantId === "string" ? stroke.participantId.slice(0, 96) : "unknown",
    color: isValidHexColor(stroke.color) ? stroke.color : "#0f172a",
    thickness: clamp(stroke.thickness, 1, 24),
    mode: stroke.mode === "smooth" ? "smooth" : "direct",
    points,
    updatedAt: typeof stroke.updatedAt === "string" ? stroke.updatedAt : new Date().toISOString(),
    completedAt: stroke.completedAt ? String(stroke.completedAt) : null,
    removedAt: stroke.removedAt ? String(stroke.removedAt) : null,
  };
}

function sanitizeWhiteboardTextBox(textBox: WhiteboardTextBox, participantId: string): WhiteboardTextBox | null {
  if (!textBox || typeof textBox.textBoxId !== "string" || !textBox.textBoxId.trim()) {
    return null;
  }

  const x = clamp(textBox.x, 0, 1);
  const y = clamp(textBox.y, 0, 1);
  const maxWidth = 1 - x;
  const maxHeight = 1 - y;
  const width = clampWhiteboardTextBoxDimension(textBox.width, maxWidth);
  const height = clampWhiteboardTextBoxDimension(textBox.height, maxHeight);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    textBoxId: textBox.textBoxId.slice(0, 96),
    participantId,
    x,
    y,
    width,
    height,
    text: sanitizeWhiteboardText(textBox.text),
    fontSize: clamp(textBox.fontSize, 12, 96),
    color: isValidHexColor(textBox.color) ? textBox.color : DEFAULT_WHITEBOARD_TEXTBOX_COLOR,
    updatedAt: new Date().toISOString(),
    removedAt: textBox.removedAt ? new Date().toISOString() : null,
  };
}

function normalizeStoredWhiteboardTextBox(textBox: WhiteboardTextBox): WhiteboardTextBox | null {
  if (!textBox || typeof textBox.textBoxId !== "string" || !textBox.textBoxId.trim()) {
    return null;
  }

  const x = clamp(textBox.x, 0, 1);
  const y = clamp(textBox.y, 0, 1);
  const maxWidth = 1 - x;
  const maxHeight = 1 - y;
  const width = clampWhiteboardTextBoxDimension(textBox.width, maxWidth);
  const height = clampWhiteboardTextBoxDimension(textBox.height, maxHeight);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    textBoxId: textBox.textBoxId.slice(0, 96),
    participantId: typeof textBox.participantId === "string" ? textBox.participantId.slice(0, 96) : "unknown",
    x,
    y,
    width,
    height,
    text: sanitizeWhiteboardText(textBox.text),
    fontSize: clamp(textBox.fontSize, 12, 96),
    color: isValidHexColor(textBox.color) ? textBox.color : DEFAULT_WHITEBOARD_TEXTBOX_COLOR,
    updatedAt: typeof textBox.updatedAt === "string" ? textBox.updatedAt : new Date().toISOString(),
    removedAt: textBox.removedAt ? String(textBox.removedAt) : null,
  };
}

function normalizeWhiteboardHistoryAction(action: WhiteboardHistoryAction): WhiteboardHistoryAction | null {
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    return null;
  }

  if (action.type === "stroke") {
    if (typeof action.strokeId !== "string" || !action.strokeId.trim()) {
      return null;
    }

    return {
      occurredAt: typeof action.occurredAt === "string" ? action.occurredAt : new Date().toISOString(),
      participantId:
        typeof action.participantId === "string" && action.participantId.trim()
          ? action.participantId.slice(0, 96)
          : "unknown",
      strokeId: action.strokeId.slice(0, 96),
      type: "stroke",
    };
  }

  if (action.type === "clear") {
    const strokeIds = Array.isArray(action.strokeIds)
      ? action.strokeIds
          .filter((strokeId) => typeof strokeId === "string" && strokeId.trim())
          .map((strokeId) => strokeId.slice(0, 96))
      : [];
    const textBoxIds = Array.isArray(action.textBoxIds)
      ? action.textBoxIds
          .filter((textBoxId) => typeof textBoxId === "string" && textBoxId.trim())
          .map((textBoxId) => textBoxId.slice(0, 96))
      : [];

    if (!strokeIds.length && !textBoxIds.length) {
      return null;
    }

    return {
      occurredAt: typeof action.occurredAt === "string" ? action.occurredAt : new Date().toISOString(),
      participantId:
        typeof action.participantId === "string" && action.participantId.trim()
          ? action.participantId.slice(0, 96)
          : "unknown",
      strokeIds,
      textBoxIds,
      type: "clear",
    };
  }

  if (action.type === "textbox.create" || action.type === "textbox.delete") {
    const textBox = normalizeStoredWhiteboardTextBox(action.textBox);
    if (!textBox) {
      return null;
    }

    return {
      occurredAt: typeof action.occurredAt === "string" ? action.occurredAt : new Date().toISOString(),
      participantId:
        typeof action.participantId === "string" && action.participantId.trim()
          ? action.participantId.slice(0, 96)
          : "unknown",
      textBox: {
        ...textBox,
        removedAt: null,
      },
      type: action.type,
    };
  }

  if (action.type === "textbox.update") {
    const before = normalizeStoredWhiteboardTextBox(action.before);
    const after = normalizeStoredWhiteboardTextBox(action.after);
    if (!before || !after || before.textBoxId !== after.textBoxId) {
      return null;
    }

    return {
      occurredAt: typeof action.occurredAt === "string" ? action.occurredAt : new Date().toISOString(),
      participantId:
        typeof action.participantId === "string" && action.participantId.trim()
          ? action.participantId.slice(0, 96)
          : "unknown",
      before: {
        ...before,
        removedAt: null,
      },
      after: {
        ...after,
        removedAt: null,
      },
      type: "textbox.update",
    };
  }

  return null;
}

function sanitizeWhiteboardTextBoxHistoryAction(
  action: WhiteboardTextBoxHistoryAction,
  participantId: string,
): WhiteboardTextBoxHistoryAction | null {
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    return null;
  }

  if (action.type === "textbox.create" || action.type === "textbox.delete") {
    const textBox = sanitizeWhiteboardTextBox(
      action.textBox,
      getWhiteboardTextBoxParticipantId(action.textBox, participantId),
    );
    if (!textBox) {
      return null;
    }

    return {
      occurredAt: new Date().toISOString(),
      participantId,
      textBox: {
        ...textBox,
        removedAt: null,
      },
      type: action.type,
    };
  }

  if (action.type === "textbox.update") {
    const before = sanitizeWhiteboardTextBox(
      action.before,
      getWhiteboardTextBoxParticipantId(action.before, participantId),
    );
    const after = sanitizeWhiteboardTextBox(
      action.after,
      getWhiteboardTextBoxParticipantId(action.after, participantId),
    );
    if (!before || !after || before.textBoxId !== after.textBoxId) {
      return null;
    }

    return {
      occurredAt: new Date().toISOString(),
      participantId,
      before: {
        ...before,
        removedAt: null,
      },
      after: {
        ...after,
        removedAt: null,
      },
      type: "textbox.update",
    };
  }

  return null;
}

function upsertWhiteboardStroke(
  state: RealtimeRoomSnapshot["whiteboard"],
  stroke: WhiteboardStroke,
): RealtimeRoomSnapshot["whiteboard"] {
  const nextStrokes = state.strokes.filter((entry) => entry.strokeId !== stroke.strokeId);
  nextStrokes.push(stroke);
  return {
    ...state,
    strokes: nextStrokes,
    updatedAt: stroke.updatedAt,
  };
}

function upsertWhiteboardTextBox(
  state: RealtimeRoomSnapshot["whiteboard"],
  textBox: WhiteboardTextBox,
): RealtimeRoomSnapshot["whiteboard"] {
  const nextTextBoxes = state.textBoxes.filter((entry) => entry.textBoxId !== textBox.textBoxId);
  nextTextBoxes.push(textBox);
  return {
    ...state,
    textBoxes: nextTextBoxes,
    updatedAt: textBox.updatedAt,
  };
}

function commitWhiteboardTextBoxAction(
  state: RealtimeRoomSnapshot["whiteboard"],
  action: WhiteboardTextBoxHistoryAction,
): RealtimeRoomSnapshot["whiteboard"] {
  if (action.type === "textbox.create") {
    const nextTextBox = {
      ...action.textBox,
      removedAt: null,
      updatedAt: action.occurredAt,
    } satisfies WhiteboardTextBox;

    return pruneWhiteboardState(
      commitWhiteboardAction(
        upsertWhiteboardTextBox(state, nextTextBox),
        {
          ...action,
          textBox: nextTextBox,
        },
        action.occurredAt,
      ),
    );
  }

  if (action.type === "textbox.update") {
    if (isSameWhiteboardTextBoxSnapshot(action.before, action.after)) {
      return state;
    }

    const nextTextBox = {
      ...action.after,
      removedAt: null,
      updatedAt: action.occurredAt,
    } satisfies WhiteboardTextBox;

    return pruneWhiteboardState(
      commitWhiteboardAction(
        upsertWhiteboardTextBox(state, nextTextBox),
        {
          ...action,
          before: {
            ...action.before,
            removedAt: null,
          },
          after: nextTextBox,
        },
        action.occurredAt,
      ),
    );
  }

  const existingTextBox = state.textBoxes.find((entry) => entry.textBoxId === action.textBox.textBoxId);
  if (existingTextBox?.removedAt) {
    return state;
  }

  const hiddenTextBox = {
    ...action.textBox,
    removedAt: action.occurredAt,
    updatedAt: action.occurredAt,
  } satisfies WhiteboardTextBox;

  return pruneWhiteboardState(
    commitWhiteboardAction(
      upsertWhiteboardTextBox(state, hiddenTextBox),
      {
        ...action,
        textBox: {
          ...action.textBox,
          removedAt: null,
        },
      },
      action.occurredAt,
    ),
  );
}

function clearWhiteboard(
  state: RealtimeRoomSnapshot["whiteboard"],
  participantId: string,
): RealtimeRoomSnapshot["whiteboard"] {
  const strokeIds = state.strokes
    .filter((stroke) => !stroke.removedAt)
    .map((stroke) => stroke.strokeId);
  const textBoxIds = state.textBoxes
    .filter((textBox) => !textBox.removedAt)
    .map((textBox) => textBox.textBoxId);

  if (!strokeIds.length && !textBoxIds.length) {
    return state;
  }

  const occurredAt = new Date().toISOString();
  return pruneWhiteboardState(
    commitWhiteboardAction(
      {
        ...state,
        strokes: setStrokeVisibility(state.strokes, new Set(strokeIds), false, occurredAt),
        textBoxes: setTextBoxVisibility(state.textBoxes, new Set(textBoxIds), false, occurredAt),
        updatedAt: occurredAt,
      },
      {
        occurredAt,
        participantId,
        strokeIds,
        textBoxIds,
        type: "clear",
      },
      occurredAt,
    ),
  );
}

function undoWhiteboard(state: RealtimeRoomSnapshot["whiteboard"]): RealtimeRoomSnapshot["whiteboard"] {
  const action = state.undoStack.at(-1);
  if (!action) {
    return state;
  }

  const occurredAt = new Date().toISOString();
  return pruneWhiteboardState({
    ...applyWhiteboardHistoryAction(state, action, occurredAt, "undo"),
    redoStack: [...state.redoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
    undoStack: state.undoStack.slice(0, -1),
    updatedAt: occurredAt,
  });
}

function redoWhiteboard(state: RealtimeRoomSnapshot["whiteboard"]): RealtimeRoomSnapshot["whiteboard"] {
  const action = state.redoStack.at(-1);
  if (!action) {
    return state;
  }

  const occurredAt = new Date().toISOString();
  return pruneWhiteboardState({
    ...applyWhiteboardHistoryAction(state, action, occurredAt, "redo"),
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
    updatedAt: occurredAt,
  });
}

function commitWhiteboardAction(
  state: RealtimeRoomSnapshot["whiteboard"],
  action: WhiteboardHistoryAction,
  updatedAt: string,
): RealtimeRoomSnapshot["whiteboard"] {
  return {
    ...state,
    undoStack: [...state.undoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
    redoStack: [],
    updatedAt,
  };
}

function applyWhiteboardHistoryAction(
  state: RealtimeRoomSnapshot["whiteboard"],
  action: WhiteboardHistoryAction,
  occurredAt: string,
  direction: "undo" | "redo",
): RealtimeRoomSnapshot["whiteboard"] {
  if (action.type === "stroke") {
    return {
      ...state,
      strokes: setStrokeVisibility(
        state.strokes,
        new Set([action.strokeId]),
        direction === "redo",
        occurredAt,
      ),
    };
  }

  if (action.type === "clear") {
    return {
      ...state,
      strokes: setStrokeVisibility(
        state.strokes,
        new Set(action.strokeIds),
        direction === "undo",
        occurredAt,
      ),
      textBoxes: setTextBoxVisibility(
        state.textBoxes,
        new Set(action.textBoxIds),
        direction === "undo",
        occurredAt,
      ),
    };
  }

  if (action.type === "textbox.create") {
    if (direction === "undo") {
      return {
        ...state,
        textBoxes: setTextBoxVisibility(
          state.textBoxes,
          new Set([action.textBox.textBoxId]),
          false,
          occurredAt,
        ),
      };
    }

    return {
      ...state,
      textBoxes: upsertWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  if (action.type === "textbox.update") {
    const nextTextBox = direction === "undo" ? action.before : action.after;
    return {
      ...state,
      textBoxes: upsertWhiteboardTextBoxEntry(state.textBoxes, {
        ...nextTextBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  if (direction === "undo") {
    return {
      ...state,
      textBoxes: upsertWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  return {
    ...state,
    textBoxes: setTextBoxVisibility(
      upsertWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
      new Set([action.textBox.textBoxId]),
      false,
      occurredAt,
    ),
  };
}

function setStrokeVisibility(
  strokes: WhiteboardStroke[],
  strokeIds: ReadonlySet<string>,
  visible: boolean,
  occurredAt: string,
): WhiteboardStroke[] {
  return strokes.map((stroke) => {
    if (!strokeIds.has(stroke.strokeId)) {
      return stroke;
    }

    return {
      ...stroke,
      removedAt: visible ? null : occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function setTextBoxVisibility(
  textBoxes: WhiteboardTextBox[],
  textBoxIds: ReadonlySet<string>,
  visible: boolean,
  occurredAt: string,
): WhiteboardTextBox[] {
  return textBoxes.map((textBox) => {
    if (!textBoxIds.has(textBox.textBoxId)) {
      return textBox;
    }

    return {
      ...textBox,
      removedAt: visible ? null : occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function pruneWhiteboardState(
  state: RealtimeRoomSnapshot["whiteboard"],
): RealtimeRoomSnapshot["whiteboard"] {
  const referencedStrokeIds = new Set<string>();
  const referencedTextBoxIds = new Set<string>();
  for (const action of [...state.undoStack, ...state.redoStack]) {
    if (action.type === "stroke") {
      referencedStrokeIds.add(action.strokeId);
      continue;
    }

    if (action.type === "clear") {
      for (const strokeId of action.strokeIds) {
        referencedStrokeIds.add(strokeId);
      }
      for (const textBoxId of action.textBoxIds) {
        referencedTextBoxIds.add(textBoxId);
      }
      continue;
    }

    if (action.type === "textbox.update") {
      referencedTextBoxIds.add(action.before.textBoxId);
      continue;
    }

    referencedTextBoxIds.add(action.textBox.textBoxId);
  }

  return {
    ...state,
    strokes: state.strokes.filter(
      (stroke) => !stroke.removedAt || referencedStrokeIds.has(stroke.strokeId),
    ),
    textBoxes: state.textBoxes.filter(
      (textBox) => !textBox.removedAt || referencedTextBoxIds.has(textBox.textBoxId),
    ),
  };
}

function upsertWhiteboardTextBoxEntry(
  textBoxes: WhiteboardTextBox[],
  textBox: WhiteboardTextBox,
): WhiteboardTextBox[] {
  const nextTextBoxes = textBoxes.filter((entry) => entry.textBoxId !== textBox.textBoxId);
  nextTextBoxes.push(textBox);
  return nextTextBoxes;
}

function getWhiteboardTextBoxParticipantId(
  textBox: WhiteboardTextBox | null | undefined,
  fallbackParticipantId: string,
): string {
  return typeof textBox?.participantId === "string" && textBox.participantId.trim()
    ? textBox.participantId.slice(0, 96)
    : fallbackParticipantId;
}

function sanitizeWhiteboardText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_WHITEBOARD_TEXT_LENGTH) : "";
}

function clampWhiteboardTextBoxDimension(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) {
    return 0;
  }

  return clamp(value, Math.min(MIN_WHITEBOARD_TEXTBOX_DIMENSION, max), max);
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

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
