import type { MeetingRecord } from "@opsui/db";
import type { RoomSummary } from "@opsui/shared-types";
import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import type { Env } from "../types";

const STALE_PARTICIPANT_SESSION_MS = 2 * 60_000;

export async function getRoomState(slug: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const roomRecord = repositories.rooms.getBySlug(slug);
  if (!roomRecord) {
    return notFound();
  }

  const room = toRoomSummary(roomRecord);
  const meeting = pickMeetingForRoom(repositories.meetings.listByWorkspace(room.workspaceId), room.id);

  if (!meeting) {
    const response = json({
      events: [],
      meeting: null,
      participants: [],
      recording: null,
      room,
    });
    await repositories.commit();
    return response;
  }

  const expiredParticipants = repositories.participants.expireStaleSessions(meeting.id, {
    staleAfterMs: STALE_PARTICIPANT_SESSION_MS,
  });
  if (expiredParticipants.length) {
    syncMeetingSummary(repositories, meeting.id);
  }

  const response = json({
    events: repositories.events.listByMeetingInstance(meeting.id),
    meeting,
    participants: repositories.participants.listByMeetingInstance(meeting.id),
    recording: repositories.recordings.getByMeetingInstanceId(meeting.id),
    room,
  });
  await repositories.commit();

  if (expiredParticipants.length) {
    void syncRealtimeRoomState(env, meeting.id, {
      participants: expiredParticipants.map((participant) => ({
        participantId: participant.participantId,
        presence: "removed" as const,
      })),
    });
  }

  return response;
}

function pickMeetingForRoom(meetings: MeetingRecord[], roomId: string): MeetingRecord | null {
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

function getMeetingPriority(status: MeetingRecord["status"]): number {
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

function toRoomSummary(room: {
  createdAt: string;
  createdBy: string;
  id: string;
  isPersistent: boolean;
  name: string;
  policy: RoomSummary["policy"];
  roomType: RoomSummary["roomType"];
  slug: string;
  templateId?: string | null;
  workspaceId: string;
}): RoomSummary {
  return {
    id: room.id,
    workspaceId: room.workspaceId,
    name: room.name,
    slug: room.slug,
    roomType: room.roomType,
    policy: room.policy,
  };
}
