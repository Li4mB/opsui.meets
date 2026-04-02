import type { ChatMessageEventPayload, LiveRole, RoomEvent } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { ApiError, json } from "../lib/http";
import { enforceRateLimit } from "../lib/rate-limit";
import { syncRealtimeRoomState } from "../lib/realtime";
import { parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

const ELEVATED_CHAT_ROLES: LiveRole[] = ["owner", "host", "co_host", "moderator", "presenter"];
const MAX_CHAT_MESSAGE_LENGTH = 500;

export async function sendChatMessage(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "chat-send",
    limit: 80,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<{
    participantId: string;
    text: string;
  }>(request);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const room = repositories.rooms.getById(meeting.roomId);
  if (!room) {
    throw new ApiError(404, "room_not_found");
  }

  const participantId = requireNonEmptyString(payload.participantId, "participant_id_required");
  const text = requireNonEmptyString(payload.text, "chat_text_required");

  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new ApiError(400, "chat_message_too_long", `Chat messages must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.`);
  }

  const participant = repositories.participants
    .listByMeetingInstance(meetingInstanceId)
    .find((entry) => entry.participantId === participantId);

  if (!participant) {
    throw new ApiError(404, "participant_not_found");
  }

  if (participant.presence !== "active") {
    throw new ApiError(409, "participant_not_active");
  }

  if (room.policy.chatMode === "disabled") {
    throw new ApiError(403, "chat_disabled");
  }

  if (room.policy.chatMode === "host_only" && !ELEVATED_CHAT_ROLES.includes(participant.role)) {
    throw new ApiError(403, "chat_host_only");
  }

  const eventPayload: ChatMessageEventPayload = {
    displayName: participant.displayName,
    text,
  };

  const event = repositories.events.append({
    meetingInstanceId,
    type: "chat.message_sent",
    actorParticipantId: participant.participantId,
    payload: eventPayload,
  }) as RoomEvent<ChatMessageEventPayload>;

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "chat.message_sent",
    target: participant.displayName,
  });

  await repositories.commit();

  await syncRealtimeRoomState(env, meetingInstanceId, {
    event: {
      type: "chat.message_sent",
      actorParticipantId: participant.participantId,
      payload: eventPayload,
    },
  });

  const response = json(event, { status: 201 });
  recordApiMetric(env, {
    route: "chat-send",
    status: response.status,
    request,
    outcome: "sent",
    workspaceId: actor.workspaceId,
  });
  return response;
}
