import type {
  LiveRole,
  RealtimeConnectionState,
  RealtimeRoomSnapshot,
  RealtimeRoomStatePatch,
  RoomEvent,
  WhiteboardStroke,
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
  | { type: "whiteboard.stroke.upsert"; payload: { stroke: WhiteboardStroke } };

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
      const sender = this.getAttachment(ws);
      if (!sender?.participantId) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "missing_sender_identity" } }));
        return;
      }

      const stroke = sanitizeWhiteboardStroke(parsed.payload.stroke, sender.participantId);
      if (!stroke) {
        ws.send(JSON.stringify({ type: "error", payload: { reason: "invalid_whiteboard_stroke" } }));
        return;
      }

      const nextStrokes = this.snapshot.whiteboard.strokes.filter((entry) => entry.strokeId !== stroke.strokeId);
      nextStrokes.push(stroke);
      this.snapshot.whiteboard = {
        strokes: nextStrokes.slice(-MAX_WHITEBOARD_STROKES),
        updatedAt: stroke.updatedAt,
      };

      await this.ctx.storage.put("snapshot", this.snapshot);
      this.broadcast({
        type: "whiteboard.stroke.upsert",
        payload: { stroke },
      });
      this.broadcast({
        type: "room.snapshot",
        payload: this.snapshot,
      });
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
    whiteboard: {
      strokes: [],
      updatedAt: null,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const MAX_WHITEBOARD_POINTS_PER_STROKE = 1_200;
const MAX_WHITEBOARD_STROKES = 500;

function normalizeSnapshot(snapshot: RealtimeRoomSnapshot): RealtimeRoomSnapshot {
  return {
    ...snapshot,
    whiteboard: snapshot.whiteboard ?? {
      strokes: [],
      updatedAt: null,
    },
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
    color: isValidHexColor(stroke.color) ? stroke.color : "#f8fafc",
    thickness: clamp(stroke.thickness, 1, 24),
    mode: stroke.mode === "smooth" ? "smooth" : "direct",
    points,
    updatedAt: new Date().toISOString(),
    completedAt: stroke.completedAt ? new Date().toISOString() : null,
  };
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
