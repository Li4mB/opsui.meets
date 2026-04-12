import type { RoomSummary } from "@opsui/shared-types";
import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { ensureSystemRoom } from "../lib/system-room";
import type { Env } from "../types";

const STALE_PARTICIPANT_SESSION_MS = 2 * 60_000;
const RECONNECTING_PARTICIPANT_GRACE_MS = 5 * 60_000;

export async function getRoomState(slug: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const { meeting, room: roomRecord } = ensureSystemRoom(repositories, slug);
  if (!roomRecord) {
    return notFound();
  }

  const room = toRoomSummary(roomRecord);

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
    reconnectGraceMs: RECONNECTING_PARTICIPANT_GRACE_MS,
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
      participants: expiredParticipants.map(({ action, participant }) => ({
        participantId: participant.participantId,
        presence: action === "expired" ? ("removed" as const) : "reconnecting",
      })),
    });
  }

  return response;
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
