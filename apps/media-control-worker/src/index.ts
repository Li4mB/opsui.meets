interface Env {
  CLOUDFLARE_REALTIME_ACCOUNT_ID?: string;
  CLOUDFLARE_REALTIME_APP_ID?: string;
  CLOUDFLARE_REALTIME_API_TOKEN?: string;
  CLOUDFLARE_REALTIME_MEETING_PRESET?: string;
  CLOUDFLARE_REALTIME_HOST_PARTICIPANT_PRESET?: string;
  CLOUDFLARE_REALTIME_ATTENDEE_PARTICIPANT_PRESET?: string;
  CLOUDFLARE_REALTIME_MEETING_PREFIX?: string;
  MEDIA_CONTROL_SHARED_SECRET?: string;
  MEETING_STATE: DurableObjectNamespace;
}

interface MediaSessionRequest {
  displayName?: string;
  meetingInstanceId?: string;
  participantId?: string;
  role?: string;
}

interface RecordingRequest {
  meetingInstanceId?: string;
  actorUserId?: string;
}

interface MeetingStateRecord {
  meetingInstanceId: string;
  providerMeetingId?: string;
  activeRecordingId?: string;
  updatedAt: string;
}

interface CloudflareResultEnvelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
  data?: T;
}

interface CloudflareRealtimeMeeting {
  id?: string;
  meetingId?: string;
}

interface CloudflareRealtimeParticipant {
  id?: string;
  authToken?: string;
  auth_token?: string;
  token?: string;
}

interface CloudflareRealtimeRecording {
  id?: string;
  recordingId?: string;
  recording_id?: string;
}

type ControlPayload = MediaSessionRequest | RecordingRequest;

const HOST_ROLES = new Set(["owner", "host", "co-host", "moderator", "presenter"]);
const DEFAULT_HOST_PARTICIPANT_PRESET = "group_call_host";
const DEFAULT_ATTENDEE_PARTICIPANT_PRESET = "group_call_participant";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/v1/health") {
      return Response.json(
        {
          ok: true,
          service: "opsui-meets-media-control",
          realtimeAccountConfigured: Boolean(env.CLOUDFLARE_REALTIME_ACCOUNT_ID),
          realtimeAppConfigured: Boolean(env.CLOUDFLARE_REALTIME_APP_ID),
          realtimeApiTokenConfigured: Boolean(env.CLOUDFLARE_REALTIME_API_TOKEN),
          realtimeConfigured: Boolean(
            env.CLOUDFLARE_REALTIME_ACCOUNT_ID &&
              env.CLOUDFLARE_REALTIME_APP_ID &&
              env.CLOUDFLARE_REALTIME_API_TOKEN,
          ),
          controlSecretConfigured: Boolean(env.MEDIA_CONTROL_SHARED_SECRET),
        },
        {
          headers: {
            "access-control-allow-origin": "*",
          },
        },
      );
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const authError = validateControlSecret(request, env.MEDIA_CONTROL_SHARED_SECRET);
    if (authError) {
      return Response.json(
        {
          ok: false,
          error: authError,
        },
        {
          status: authError === "media_control_auth_not_configured" ? 501 : 401,
        },
      );
    }

    const payload = (await request.json().catch(() => null)) as ControlPayload | null;
    if (!payload || typeof payload !== "object") {
      return Response.json(
        {
          ok: false,
          error: "invalid_json",
        },
        { status: 400 },
      );
    }

    const meetingInstanceId = getRequiredString(
      payload.meetingInstanceId,
      "meeting_instance_id_required",
    );
    if (!meetingInstanceId.ok) {
      return Response.json({ ok: false, error: meetingInstanceId.error }, { status: 400 });
    }

    const stub = env.MEETING_STATE.get(env.MEETING_STATE.idFromName(meetingInstanceId.value));
    return stub.fetch(`https://media-control.internal${url.pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
  },
};

export class MeetingState {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const payload = (await request.json().catch(() => null)) as ControlPayload | null;
    if (!payload || typeof payload !== "object") {
      return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    try {
      if (request.method === "POST" && url.pathname === "/sessions") {
        return await this.handleCreateSession(payload as MediaSessionRequest);
      }

      if (request.method === "POST" && url.pathname === "/recordings/start") {
        return await this.handleStartRecording(payload as RecordingRequest);
      }

      if (request.method === "POST" && url.pathname === "/recordings/stop") {
        return await this.handleStopRecording(payload as RecordingRequest);
      }
    } catch (error) {
      return toErrorResponse(error);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleCreateSession(payload: MediaSessionRequest): Promise<Response> {
    const meetingInstanceId = requireString(payload.meetingInstanceId, "meeting_instance_id_required");
    const participantId = requireString(payload.participantId, "participant_id_required");
    const role = requireString(payload.role, "participant_role_required");
    const displayName = optionalString(payload.displayName) ?? participantId;
    const state = await this.loadState(meetingInstanceId);
    const meetingId = await this.ensureMeeting(state);
    const participantPreset = resolveParticipantPreset(role, this.env);
    const participant = await this.cloudflareApi<CloudflareRealtimeParticipant>(
      `/meetings/${meetingId}/participants`,
      "POST",
      {
        custom_participant_id: participantId,
        name: displayName,
        preset_name: participantPreset,
        metadata: {
          displayName,
          meetingInstanceId,
          participantId,
          role,
        },
      },
    );
    const token = pickFirstString(participant, ["authToken", "auth_token", "token"]);
    if (!token) {
      throw new ControlError(502, "cloudflare_realtime_participant_token_missing");
    }

    return Response.json({
      sessionId: meetingId,
      token,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
  }

  private async handleStartRecording(payload: RecordingRequest): Promise<Response> {
    const meetingInstanceId = requireString(payload.meetingInstanceId, "meeting_instance_id_required");
    const state = await this.loadState(meetingInstanceId);
    const meetingId = await this.ensureMeeting(state);

    const existingRecordingId = state.activeRecordingId ?? (await this.lookupActiveRecordingId(meetingId));
    if (existingRecordingId) {
      state.activeRecordingId = existingRecordingId;
      await this.saveState(state);
      return Response.json({ recordingId: existingRecordingId });
    }

    const recording = await this.cloudflareApi<CloudflareRealtimeRecording>("/recordings", "POST", {
      meeting_id: meetingId,
      metadata: {
        meetingInstanceId,
        actorUserId: payload.actorUserId ?? "system",
      },
    });
    const recordingId = pickFirstString(recording, ["id", "recordingId", "recording_id"]);
    if (!recordingId) {
      throw new ControlError(502, "cloudflare_realtime_recording_id_missing");
    }

    state.activeRecordingId = recordingId;
    await this.saveState(state);
    return Response.json({ recordingId });
  }

  private async handleStopRecording(payload: RecordingRequest): Promise<Response> {
    const meetingInstanceId = requireString(payload.meetingInstanceId, "meeting_instance_id_required");
    const state = await this.loadState(meetingInstanceId);
    const meetingId = state.providerMeetingId;
    if (!meetingId) {
      return Response.json({ stopped: true });
    }

    const recordingId = state.activeRecordingId ?? (await this.lookupActiveRecordingId(meetingId));
    if (!recordingId) {
      state.activeRecordingId = undefined;
      await this.saveState(state);
      return Response.json({ stopped: true });
    }

    await this.cloudflareApi(`/recordings/${recordingId}`, "PUT", {
      action: "stop",
      metadata: {
        meetingInstanceId,
        actorUserId: payload.actorUserId ?? "system",
      },
    });

    state.activeRecordingId = undefined;
    await this.saveState(state);
    return Response.json({ stopped: true });
  }

  private async ensureMeeting(state: MeetingStateRecord): Promise<string> {
    if (state.providerMeetingId) {
      return state.providerMeetingId;
    }

    const title = `${this.env.CLOUDFLARE_REALTIME_MEETING_PREFIX || "opsui-meets"}:${state.meetingInstanceId}`;
    const meeting = await this.cloudflareApi<CloudflareRealtimeMeeting>("/meetings", "POST", {
      title,
      preset_name: emptyToUndefined(this.env.CLOUDFLARE_REALTIME_MEETING_PRESET),
      record_on_start: false,
      metadata: {
        meetingInstanceId: state.meetingInstanceId,
      },
    });
    const meetingId = pickFirstString(meeting, ["id", "meetingId"]);
    if (!meetingId) {
      throw new ControlError(502, "cloudflare_realtime_meeting_id_missing");
    }

    state.providerMeetingId = meetingId;
    await this.saveState(state);
    return meetingId;
  }

  private async lookupActiveRecordingId(meetingId: string): Promise<string | undefined> {
    try {
      const recording = await this.cloudflareApi<CloudflareRealtimeRecording>(
        `/recordings/active-recording/${meetingId}`,
        "GET",
      );
      return pickFirstString(recording, ["id", "recordingId", "recording_id"]);
    } catch (error) {
      if (error instanceof ControlError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async loadState(meetingInstanceId: string): Promise<MeetingStateRecord> {
    const existing = await this.ctx.storage.get<MeetingStateRecord>("state");
    if (existing) {
      return existing;
    }

    return {
      meetingInstanceId,
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveState(state: MeetingStateRecord): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.ctx.storage.put("state", state);
  }

  private async cloudflareApi<T = Record<string, unknown>>(
    endpoint: string,
    method: string,
    requestBody?: Record<string, unknown>,
  ): Promise<T> {
    const accountId = this.env.CLOUDFLARE_REALTIME_ACCOUNT_ID;
    const appId = this.env.CLOUDFLARE_REALTIME_APP_ID;
    const apiToken = this.env.CLOUDFLARE_REALTIME_API_TOKEN;
    if (!accountId || !appId || !apiToken) {
      throw new ControlError(
        501,
        "cloudflare_realtime_not_configured",
        "Set CLOUDFLARE_REALTIME_ACCOUNT_ID, CLOUDFLARE_REALTIME_APP_ID, and CLOUDFLARE_REALTIME_API_TOKEN.",
      );
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}${endpoint}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: requestBody ? JSON.stringify(stripUndefined(requestBody)) : undefined,
      },
    );

    const envelope = (await response.json().catch(() => null)) as CloudflareResultEnvelope<T> | null;
    const responseData = envelope?.result ?? envelope?.data;
    if (!response.ok || envelope?.success === false || !responseData) {
      const firstError = envelope?.errors?.[0];
      const status = response.ok ? 502 : response.status;
      throw new ControlError(
        status,
        firstError?.message ? slugify(firstError.message) : `cloudflare_realtime_request_failed_${response.status}`,
        firstError?.message,
      );
    }

    return responseData as T;
  }
}

class ControlError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ControlError";
  }
}

function validateControlSecret(
  request: Request,
  secret: string | undefined,
): "media_control_auth_not_configured" | "media_control_unauthorized" | null {
  if (!secret) {
    return "media_control_auth_not_configured";
  }

  return request.headers.get("x-opsui-media-secret") === secret
    ? null
    : "media_control_unauthorized";
}

function getRequiredString(
  value: unknown,
  error: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value === "string" && value.trim().length > 0) {
    return { ok: true, value: value.trim() };
  }

  return { ok: false, error };
}

function requireString(value: unknown, error: string): string {
  const result = getRequiredString(value, error);
  if (!result.ok) {
    throw new ControlError(400, result.error);
  }
  return result.value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveParticipantPreset(role: string, env: Env): string | undefined {
  return HOST_ROLES.has(role)
    ? emptyToUndefined(env.CLOUDFLARE_REALTIME_HOST_PARTICIPANT_PRESET) ?? DEFAULT_HOST_PARTICIPANT_PRESET
    : emptyToUndefined(env.CLOUDFLARE_REALTIME_ATTENDEE_PARTICIPANT_PRESET) ?? DEFAULT_ATTENDEE_PARTICIPANT_PRESET;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function pickFirstString(source: unknown, keys: string[]): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof ControlError) {
    return Response.json(
      {
        ok: false,
        error: error.code,
        message: error.message !== error.code ? error.message : undefined,
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      ok: false,
      error: "media_control_internal_error",
    },
    { status: 500 },
  );
}
