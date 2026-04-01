import type {
  MeetingDetail,
  MeetingSummary,
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
    const roomResponse = await fetchWithTimeout(
      `${API_BASE_URL}/v1/rooms/resolve/${encodeURIComponent(meetingCode)}`,
      {
        headers: actorHeaders,
      },
    );

    if (roomResponse.status === 404) {
      return null;
    }

    if (!roomResponse.ok) {
      throw new Error("meeting_room_unavailable");
    }

    const room = (await roomResponse.json()) as RoomSummary;
    const meetingsResponse = await fetchWithTimeout(`${API_BASE_URL}/v1/meetings`, {
      headers: actorHeaders,
    });

    if (!meetingsResponse.ok) {
      throw new Error("meeting_room_unavailable");
    }

    const meetingsJson = (await meetingsResponse.json()) as { items: MeetingSummary[] };
    const meetingSummary = pickMeetingForRoom(meetingsJson.items, room.id);

    if (!meetingSummary) {
      return {
        events: [],
        meeting: null,
        participants: [],
        recording: null,
        room,
      };
    }

    const [meetingResponse, participantsResponse, eventsResponse, recordingResponse] = await Promise.all([
      fetchWithTimeout(`${API_BASE_URL}/v1/meetings/${meetingSummary.id}`, {
        headers: actorHeaders,
      }),
      fetchWithTimeout(`${API_BASE_URL}/v1/meetings/${meetingSummary.id}/participants`, {
        headers: actorHeaders,
      }),
      fetchWithTimeout(`${API_BASE_URL}/v1/meetings/${meetingSummary.id}/events`, {
        headers: actorHeaders,
      }),
      fetchWithTimeout(`${API_BASE_URL}/v1/meetings/${meetingSummary.id}/recordings`, {
        headers: actorHeaders,
      }),
    ]);

    const meeting =
      meetingResponse.ok
        ? ((await meetingResponse.json()) as MeetingDetail)
        : ({
            ...meetingSummary,
            hostUserId: null,
            isLocked: false,
            joinUrl: getMeetingShareUrl(meetingCode),
          } satisfies MeetingDetail);
    const participants = participantsResponse.ok
      ? ((await participantsResponse.json()) as { items: ParticipantState[] }).items
      : [];
    const events = eventsResponse.ok
      ? ((await eventsResponse.json()) as { items: RoomEvent[] }).items
      : [];
    const recording = recordingResponse.ok
      ? ((await recordingResponse.json()) as RecordingSummary)
      : null;

    return {
      events,
      meeting,
      participants,
      recording,
      room,
    };
  } catch {
    throw new Error("meeting_room_unavailable");
  }
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 4_000,
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

function pickMeetingForRoom(meetings: MeetingSummary[], roomId: string): MeetingSummary | null {
  const candidates = meetings.filter((meeting) => meeting.roomId === roomId);
  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    const statusDelta = getMeetingPriority(left.status) - getMeetingPriority(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });

  return candidates[0] ?? null;
}

function getMeetingPriority(status: MeetingSummary["status"]): number {
  switch (status) {
    case "live":
      return 0;
    case "prejoin":
      return 1;
    case "scheduled":
      return 2;
    case "ending":
      return 3;
    case "ended":
      return 4;
    default:
      return 5;
  }
}
