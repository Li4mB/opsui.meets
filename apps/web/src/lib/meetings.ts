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

export async function loadMeetingRoomData(meetingCode: string): Promise<MeetingRoomData | null> {
  try {
    const actorHeaders = await getActorHeaders();
    const response = await fetchWithTimeout(`${API_BASE_URL}/v1/rooms/resolve/${encodeURIComponent(meetingCode)}/state`, {
      headers: actorHeaders,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error("meeting_room_unavailable");
    }

    return (await response.json()) as MeetingRoomData;
  } catch {
    throw new Error("meeting_room_unavailable");
  }
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function getMeetingShareUrl(meetingCode: string): string {
  return `${PUBLIC_APP_BASE_URL}/${encodeURIComponent(meetingCode)}`;
}
