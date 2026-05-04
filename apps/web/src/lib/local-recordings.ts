import type { RecordingSummary } from "@opsui/shared-types";
import { getActorHeaders } from "./auth";
import { API_BASE_URL } from "./config";
import { createIdempotencyKey } from "./idempotency";

export interface CapturedRecording {
  blob: Blob;
  durationMs: number;
  endedAt: string;
  id: string;
  meetingCode: string | null;
  mimeType: string;
  size: number;
  startedAt: string;
  title: string;
}

export interface LocalScreenRecordingSession {
  done: Promise<CapturedRecording>;
  id: string;
  startedAt: string;
  stop(): Promise<CapturedRecording>;
}

interface StartLocalScreenRecordingOptions {
  meetingCode?: string;
  title?: string;
}

const RECORDING_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm",
];

export function isLocalScreenRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

export async function startLocalScreenRecording(
  options: StartLocalScreenRecordingOptions = {},
): Promise<LocalScreenRecordingSession> {
  if (!isLocalScreenRecordingSupported()) {
    throw new Error("screen_recording_unsupported");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: {
      frameRate: {
        ideal: 30,
        max: 60,
      },
    },
  });
  const mimeType = getSupportedRecordingMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    stopStreamTracks(stream);
    throw error;
  }

  const chunks: Blob[] = [];
  const id = createRecordingId();
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const title = options.title?.trim() || "Screen recording";
  const meetingCode = options.meetingCode?.trim() || null;

  let finalized = false;
  let resolveDone: (recording: CapturedRecording) => void = () => {};
  let rejectDone: (error: unknown) => void = () => {};
  const done = new Promise<CapturedRecording>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function finalizeRecording() {
    if (finalized) {
      return done;
    }

    finalized = true;
    stopStreamTracks(stream);

    const endedAtDate = new Date();
    const recordingMimeType = recorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(chunks, { type: recordingMimeType });
    resolveDone({
      blob,
      durationMs: Math.max(0, endedAtDate.getTime() - startedAtDate.getTime()),
      endedAt: endedAtDate.toISOString(),
      id,
      meetingCode,
      mimeType: recordingMimeType,
      size: blob.size,
      startedAt,
      title,
    });

    return done;
  }

  function stop() {
    if (finalized) {
      return done;
    }

    try {
      if (recorder.state === "recording") {
        recorder.requestData();
      }
    } catch {}

    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      finalizeRecording();
    }

    stopStreamTracks(stream);
    return done;
  }

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  recorder.addEventListener("stop", () => {
    finalizeRecording();
  });
  recorder.addEventListener("error", (event) => {
    stopStreamTracks(stream);
    rejectDone(event);
  });

  for (const track of stream.getVideoTracks()) {
    track.addEventListener(
      "ended",
      () => {
        void stop();
      },
      { once: true },
    );
  }

  try {
    recorder.start(1_000);
  } catch (error) {
    stopStreamTracks(stream);
    throw error;
  }

  return {
    done,
    id,
    startedAt,
    stop,
  };
}

export async function uploadMeetingRecording(
  meetingInstanceId: string,
  recording: CapturedRecording,
): Promise<{ ok: true; recording: RecordingSummary } | { ok: false; error: string }> {
  try {
    const filename = createRecordingFilename(recording);
    const formData = new FormData();
    formData.set("file", recording.blob, filename);
    formData.set("filename", filename);
    formData.set("title", recording.title);
    formData.set("startedAt", recording.startedAt);
    formData.set("stoppedAt", recording.endedAt);
    formData.set("durationMs", String(recording.durationMs));

    const headers = await getActorHeaders({
      "Idempotency-Key": createIdempotencyKey("recording-upload"),
    });
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/recordings/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        error: payload?.message ?? "Recording could not be uploaded.",
      };
    }

    return {
      ok: true,
      recording: normalizeRecording((await response.json()) as RecordingSummary),
    };
  } catch {
    return {
      ok: false,
      error: "Recording could not be uploaded.",
    };
  }
}

export async function listServerRecordings(): Promise<
  { ok: true; items: RecordingSummary[] } | { ok: false; error: string }
> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/recordings`, {
      cache: "no-store",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      return { ok: false, error: "Recordings could not be loaded." };
    }

    const payload = (await response.json()) as { items?: RecordingSummary[] };
    return {
      ok: true,
      items: Array.isArray(payload.items) ? payload.items.map(normalizeRecording) : [],
    };
  } catch {
    return { ok: false, error: "Recordings could not be loaded." };
  }
}

export async function updateServerRecordingSaved(
  recordingId: string,
  saved: boolean,
): Promise<{ ok: true; recording: RecordingSummary } | { ok: false; error: string }> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("recording-save"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/recordings/${encodeURIComponent(recordingId)}`, {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ saved }),
    });

    if (!response.ok) {
      return { ok: false, error: "Recording could not be updated." };
    }

    return {
      ok: true,
      recording: normalizeRecording((await response.json()) as RecordingSummary),
    };
  } catch {
    return { ok: false, error: "Recording could not be updated." };
  }
}

export async function deleteServerRecording(recordingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const headers = await getActorHeaders({
      "Idempotency-Key": createIdempotencyKey("recording-delete"),
    });
    const response = await fetch(`${API_BASE_URL}/v1/recordings/${encodeURIComponent(recordingId)}`, {
      method: "DELETE",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      return { ok: false, error: "Recording could not be deleted." };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Recording could not be deleted." };
  }
}

export async function fetchServerRecordingBlob(recordingId: string, options?: { download?: boolean }): Promise<Blob> {
  const headers = await getActorHeaders();
  const url = new URL(`${API_BASE_URL}/v1/recordings/${encodeURIComponent(recordingId)}/content`);
  if (options?.download) {
    url.searchParams.set("download", "1");
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    throw new Error("recording_fetch_failed");
  }

  return response.blob();
}

export function createRecordingFilename(recording: Pick<CapturedRecording, "startedAt" | "title">): string {
  const datePart = recording.startedAt.slice(0, 19).replace(/[:T]/g, "-");
  const titlePart = recording.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${titlePart || "opsui-recording"}-${datePart}.webm`;
}

export function createServerRecordingFilename(recording: RecordingSummary): string {
  if (recording.filename?.trim()) {
    return recording.filename.trim();
  }

  return createRecordingFilename({
    startedAt: recording.startedAt ?? recording.createdAt ?? new Date().toISOString(),
    title: recording.title ?? "Screen recording",
  });
}

export function formatRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatRecordingSize(size: number): string {
  if (size < 1_024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1_024;
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function normalizeRecording(recording: RecordingSummary): RecordingSummary {
  return {
    ...recording,
    contentType: recording.contentType || "video/webm",
    durationMs: typeof recording.durationMs === "number" && Number.isFinite(recording.durationMs)
      ? recording.durationMs
      : 0,
    saved: Boolean(recording.saved),
    sizeBytes: typeof recording.sizeBytes === "number" && Number.isFinite(recording.sizeBytes)
      ? recording.sizeBytes
      : 0,
    title: recording.title || "Screen recording",
  };
}

function createRecordingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `recording-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSupportedRecordingMimeType(): string | undefined {
  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function stopStreamTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    if (track.readyState !== "ended") {
      track.stop();
    }
  }
}
