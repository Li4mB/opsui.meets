import { CloudflareRealtimeAdapter } from "@opsui/media-adapter";
import type { RecordingSummary } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import {
  deleteRecordingBlob,
  deleteRecordingBlobs,
  getRecordingBlob,
  putRecordingBlob,
} from "../lib/recording-blob-storage";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { ApiError, json } from "../lib/http";
import { parseJson } from "../lib/request";
import type { Env } from "../types";

const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_BROWSER_RECORDING_SIZE_BYTES = 250 * 1024 * 1024;

interface RecordingSavedPatchPayload {
  saved?: unknown;
}

export async function startRecording(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const mediaAdapter = new CloudflareRealtimeAdapter(env.MEDIA_SERVICE, env.MEDIA_CONTROL_SHARED_SECRET);
  const pendingRealtime = {
    run: null as null | (() => Promise<void>),
  };
  const result = await withIdempotency(request, `recordings.start:${meetingInstanceId}`, async () => {
    let recordingStart: { recordingId: string };
    try {
      recordingStart = await mediaAdapter.startRecording({
        meetingInstanceId,
        actorUserId: actor.userId,
      });
    } catch (error) {
      throw new ApiError(
        502,
        error instanceof Error ? error.message : "media_control_start_failed",
      );
    }

    const recording: RecordingSummary = {
      id: recordingStart.recordingId,
      meetingInstanceId,
      provider: "cloudflare-realtime",
      status: "recording",
      startedAt: new Date().toISOString(),
    };

    repositories.recordings.upsert(recording);
    repositories.events.append({
      meetingInstanceId,
      type: "recording.started",
      payload: {
        recordingId: recording.id,
      },
    });
    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "recording.started",
      target: repositories.meetings.getById(meetingInstanceId)?.title ?? meetingInstanceId,
    });
    syncMeetingSummary(repositories, meetingInstanceId);
    pendingRealtime.run = () =>
      syncRealtimeRoomState(env, meetingInstanceId, {
        recordingState: "recording",
        event: {
          type: "recording.started",
          actorParticipantId: actor.userId,
          payload: {
            recordingId: recording.id,
          },
        },
      });

    return {
      body: recording,
      status: 202,
    };
  });

  const response = json(result.body, { status: result.status });
  recordApiMetric(env, {
    route: "recording-start",
    status: response.status,
    request,
    outcome: "started",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  const runRealtime = pendingRealtime.run;
  if (typeof runRealtime === "function") {
    await runRealtime();
  }
  return response;
}

export async function stopRecording(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const mediaAdapter = new CloudflareRealtimeAdapter(env.MEDIA_SERVICE, env.MEDIA_CONTROL_SHARED_SECRET);
  try {
    await mediaAdapter.stopRecording({
      meetingInstanceId,
      actorUserId: actor.userId,
    });
  } catch (error) {
    throw new ApiError(
      502,
      error instanceof Error ? error.message : "media_control_stop_failed",
    );
  }

  const recording: RecordingSummary = {
    id: `recording-${meetingInstanceId}`,
    meetingInstanceId,
    provider: "cloudflare-realtime",
    status: "stopped",
    stoppedAt: new Date().toISOString(),
  };

  repositories.recordings.upsert(recording);
  repositories.events.append({
    meetingInstanceId,
    type: "recording.stopped",
    payload: {
      recordingId: recording.id,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "recording.stopped",
    target: repositories.meetings.getById(meetingInstanceId)?.title ?? meetingInstanceId,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      recordingState: "stopped",
      event: {
        type: "recording.stopped",
        actorParticipantId: actor.userId,
        payload: {
          recordingId: recording.id,
        },
      },
    });

  const response = json(recording, { status: 202 });
  recordApiMetric(env, {
    route: "recording-stop",
    status: response.status,
    request,
    outcome: "stopped",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();
  return response;
}

export async function listRecordings(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const expiredIds = repositories.recordings.pruneExpired();
  if (expiredIds.length) {
    await deleteRecordingBlobs(env, expiredIds);
  }

  const items = repositories.recordings
    .listByOwnerUserId(actor.userId)
    .map((recording) => withRecordingUrls(request, recording));

  await repositories.commit();

  const response = json({ items });
  recordApiMetric(env, {
    route: "recordings-list",
    status: response.status,
    request,
    outcome: String(items.length),
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function uploadBrowserRecording(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    throw new ApiError(404, "meeting_not_found", "This meeting could not be found.");
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    throw new ApiError(400, "invalid_recording_upload", "Upload a recording file.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "recording_file_required", "Upload a recording file.");
  }

  if (file.size <= 0) {
    throw new ApiError(400, "recording_empty", "The recording file was empty.");
  }

  if (file.size > MAX_BROWSER_RECORDING_SIZE_BYTES) {
    throw new ApiError(400, "recording_too_large", "Recordings must be 250 MB or smaller.");
  }

  const recordingId = crypto.randomUUID();
  const now = new Date();
  const contentType = normalizeRecordingContentType(file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const startedAt = parseOptionalDate(formData.get("startedAt"), now);
  const stoppedAt = parseOptionalDate(formData.get("stoppedAt"), now);
  const durationMs = parseOptionalNumber(formData.get("durationMs"));
  const title = normalizeRecordingTitle(formData.get("title"), meeting.title);
  const filename = normalizeRecordingFilename(formData.get("filename"), file.name, title);
  const expiresAt = new Date(now.getTime() + RECORDING_RETENTION_MS).toISOString();

  await putRecordingBlob(env, {
    bytes,
    contentType,
    ownerUserId: actor.userId,
    recordingId,
    sizeBytes: bytes.byteLength,
  });

  const recording: RecordingSummary = {
    id: recordingId,
    meetingInstanceId,
    provider: "browser-screen",
    status: "stopped",
    contentType,
    createdAt: now.toISOString(),
    durationMs,
    expiresAt,
    filename,
    ownerUserId: actor.userId,
    saved: false,
    sizeBytes: bytes.byteLength,
    startedAt,
    stoppedAt,
    title,
  };

  repositories.recordings.upsert(recording);
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "recording.uploaded",
    target: meeting.title,
  });

  await repositories.commit();

  const response = json(withRecordingUrls(request, recording), { status: 201 });
  recordApiMetric(env, {
    route: "recording-upload",
    status: response.status,
    request,
    outcome: "uploaded",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function getRecordingContent(
  request: Request,
  recordingId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const expiredIds = repositories.recordings.pruneExpired();
  if (expiredIds.length) {
    await deleteRecordingBlobs(env, expiredIds);
  }

  const recording = repositories.recordings.getById(recordingId);
  if (!recording || recording.ownerUserId !== actor.userId) {
    await repositories.commit();
    throw new ApiError(404, "recording_not_found", "That recording could not be found.");
  }

  const storedBlob = await getRecordingBlob(env, recording.id);
  if (!storedBlob) {
    await repositories.commit();
    throw new ApiError(404, "recording_unavailable", "That recording file is unavailable.");
  }

  await repositories.commit();

  const url = new URL(request.url);
  const headers = new Headers();
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", storedBlob.contentType || recording.contentType || "video/webm");
  headers.set("content-length", String(storedBlob.sizeBytes));
  headers.set(
    "content-disposition",
    buildContentDisposition(url.searchParams.get("download") === "1" ? "attachment" : "inline", recording.filename),
  );

  const response = new Response(new Uint8Array(storedBlob.bytes).buffer, {
    status: 200,
    headers,
  });
  recordApiMetric(env, {
    route: "recording-content",
    status: response.status,
    request,
    outcome: url.searchParams.get("download") === "1" ? "download" : "inline",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function updateRecordingSaved(
  request: Request,
  recordingId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const payload = await parseJson<RecordingSavedPatchPayload>(request);
  if (typeof payload.saved !== "boolean") {
    throw new ApiError(400, "saved_required", "Set saved to true or false.");
  }

  const repositories = await getRepositories(env);
  const recording = repositories.recordings.updateSaved(recordingId, actor.userId, payload.saved);
  if (!recording) {
    throw new ApiError(404, "recording_not_found", "That recording could not be found.");
  }

  await repositories.commit();

  const response = json(withRecordingUrls(request, recording));
  recordApiMetric(env, {
    route: "recording-save",
    status: response.status,
    request,
    outcome: payload.saved ? "saved" : "unsaved",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function deleteRecording(
  request: Request,
  recordingId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const recording = repositories.recordings.deleteById(recordingId, actor.userId);
  if (!recording) {
    throw new ApiError(404, "recording_not_found", "That recording could not be found.");
  }

  await deleteRecordingBlob(env, recording.id);
  await repositories.commit();

  const response = json({ ok: true });
  recordApiMetric(env, {
    route: "recording-delete",
    status: response.status,
    request,
    outcome: "deleted",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function pruneExpiredRecordings(env: Env): Promise<number> {
  const repositories = await getRepositories(env);
  const expiredIds = repositories.recordings.pruneExpired();
  if (expiredIds.length) {
    await deleteRecordingBlobs(env, expiredIds);
  }

  await repositories.commit();
  return expiredIds.length;
}

function withRecordingUrls(request: Request, recording: RecordingSummary): RecordingSummary {
  const contentUrl = new URL(`/v1/recordings/${encodeURIComponent(recording.id)}/content`, request.url);
  const downloadUrl = new URL(contentUrl);
  downloadUrl.searchParams.set("download", "1");

  return {
    ...recording,
    contentUrl: contentUrl.toString(),
    downloadUrl: downloadUrl.toString(),
  };
}

function parseOptionalDate(value: FormDataEntryValue | null, fallback: Date): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback.toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback.toISOString();
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function normalizeRecordingTitle(value: FormDataEntryValue | null, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 120);
  }

  return fallback;
}

function normalizeRecordingFilename(
  value: FormDataEntryValue | null,
  fileName: string,
  title: string,
): string {
  const raw = typeof value === "string" && value.trim()
    ? value.trim()
    : fileName.trim() || `${title}.webm`;

  return sanitizeFilename(raw).slice(0, 160) || "recording.webm";
}

function normalizeRecordingContentType(value: string): string {
  return value.trim().toLowerCase() || "video/webm";
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function buildContentDisposition(disposition: "attachment" | "inline", filename?: string): string {
  const safeFilename = sanitizeFilename(filename || "recording.webm").replace(/"/g, "'");
  return `${disposition}; filename="${safeFilename}"`;
}
