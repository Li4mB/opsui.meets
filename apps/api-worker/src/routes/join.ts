import type { JoinMeetingResult } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { enforceRateLimit } from "../lib/rate-limit";
import { ApiError, json } from "../lib/http";
import { optionalBoolean, parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

export async function joinMeeting(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "meeting-join",
    limit: 40,
    windowMs: 60_000,
  });
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<{
    roomId: string;
    displayName: string;
    lobbyPreferred: boolean;
    sessionType: string;
  }>(request);
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const roomId = requireNonEmptyString(payload.roomId, "room_id_required", "room_ops_standup");
  const room = repositories.rooms.getById(roomId);
  if (!room) {
    throw new ApiError(404, "room_not_found");
  }

  const workspacePolicy = repositories.policies.getWorkspacePolicy(actor.workspaceId);
  const displayName = requireNonEmptyString(
    payload.displayName,
    "display_name_required",
    actor.email ?? "Guest User",
  );
  const sessionType = typeof payload.sessionType === "string" ? payload.sessionType : "guest";
  const isGuest = sessionType !== "user";

  let joinState: JoinMeetingResult["joinState"] = "direct";
  let reason: JoinMeetingResult["reason"];

  if (meeting.isLocked) {
    joinState = "blocked";
    reason = "room_locked";
  } else if (isGuest && (!room.policy.allowGuestJoin || workspacePolicy?.guestJoinMode === "disabled")) {
    joinState = "blocked";
    reason = "guest_join_disabled";
  } else if (
    room.policy.lobbyEnabled ||
    optionalBoolean(payload.lobbyPreferred, false) ||
    (isGuest && workspacePolicy?.guestJoinMode === "restricted")
  ) {
    joinState = "lobby";
  }

  const participant =
    joinState === "blocked"
      ? null
      : repositories.participants.registerJoin({
          meetingInstanceId,
          displayName,
          presence: joinState === "lobby" ? "lobby" : "active",
        });

  const result: JoinMeetingResult = {
    meetingInstanceId,
    roomId,
    joinState,
    displayName,
    participantId: participant?.participantId,
    reason,
  };

  if (joinState === "direct") {
    repositories.meetings.setStatus(meetingInstanceId, "live");
    repositories.events.append({
      meetingInstanceId,
      type: "participant.join",
      payload: {
        participantId: participant?.participantId,
        displayName,
      },
    });
    await syncRealtimeRoomState(env, meetingInstanceId, {
      meetingStatus: "live",
      participants: participant
        ? [
            {
              participantId: participant.participantId,
              displayName: participant.displayName,
              role: participant.role,
              presence: "active",
            },
          ]
        : [],
      event: {
        type: "participant.join",
        actorParticipantId: participant?.participantId,
        payload: {
          participantId: participant?.participantId,
          displayName,
        },
      },
    });
  } else if (joinState === "lobby") {
    repositories.events.append({
      meetingInstanceId,
      type: "lobby.updated",
      payload: {
        participantId: participant?.participantId,
        displayName,
        state: "waiting",
      },
    });
    await syncRealtimeRoomState(env, meetingInstanceId, {
      meetingStatus: "prejoin",
      participants: participant
        ? [
            {
              participantId: participant.participantId,
              displayName: participant.displayName,
              role: participant.role,
              presence: "lobby",
            },
          ]
        : [],
      event: {
        type: "lobby.updated",
        actorParticipantId: participant?.participantId,
        payload: {
          participantId: participant?.participantId,
          displayName,
          state: "waiting",
        },
      },
    });
  }

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action:
      joinState === "blocked"
        ? "join.blocked"
        : joinState === "lobby"
          ? "join.lobby"
      : "join.direct",
    target: displayName,
  });
  syncMeetingSummary(repositories, meetingInstanceId);

  const response = json(result, { status: 202 });
  recordApiMetric(env, {
    route: "join-meeting",
    status: response.status,
    request,
    outcome: joinState,
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  return response;
}
