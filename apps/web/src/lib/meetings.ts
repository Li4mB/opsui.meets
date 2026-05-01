import type {
  MeetingDetail,
  ParticipantState,
  RecordingSummary,
  RoomEvent,
  RoomSummary,
} from "@opsui/shared-types";
import { getActorHeaders } from "./auth";
import { API_BASE_URL, PUBLIC_APP_BASE_URL } from "./config";

export interface MeetingRoomData {
  events: RoomEvent[];
  meeting: MeetingDetail | null;
  participants: ParticipantState[];
  recording: RecordingSummary | null;
  room: RoomSummary;
}

export class MeetingRoomUnavailableError extends Error {
  constructor() {
    super("meeting_room_unavailable");
    this.name = "MeetingRoomUnavailableError";
  }
}

export async function loadMeetingRoomData(
  meetingCode: string,
  options?: { signal?: AbortSignal },
): Promise<MeetingRoomData | null> {
  try {
    const actorHeaders = await getActorHeaders();
    const response = await fetchWithTimeout(`${API_BASE_URL}/v1/rooms/resolve/${encodeURIComponent(meetingCode)}/state`, {
      headers: actorHeaders,
    }, 8_000, options?.signal);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.error("[opsui-meets] loadMeetingRoomData failed:", response.status, response.statusText, "for code:", meetingCode);
      throw new MeetingRoomUnavailableError();
    }

    return (await response.json()) as MeetingRoomData;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    if (error instanceof MeetingRoomUnavailableError) {
      throw error;
    }
    console.error("[opsui-meets] loadMeetingRoomData error:", error, "for code:", meetingCode);
    throw new MeetingRoomUnavailableError();
  }
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 8_000,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromExternalSignal = () => {
    controller.abort();
  };
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export function getMeetingShareUrl(meetingCode: string): string {
  return `${PUBLIC_APP_BASE_URL}/${encodeURIComponent(meetingCode)}`;
}
