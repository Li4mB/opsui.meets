import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { dispatchConfiguredFollowUp } from "../lib/follow-up-hook";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { ApiError, json } from "../lib/http";
import type { Env } from "../types";

export async function muteAllParticipants(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const participants = repositories.participants.muteAll(meetingInstanceId);
  const meetingTitle = repositories.meetings.getById(meetingInstanceId)?.title ?? meetingInstanceId;

  repositories.events.append({
    meetingInstanceId,
    type: "participants.muted_all",
    payload: {
      count: participants.length,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "participants.muted_all",
    target: meetingTitle,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      mutedAllAt: new Date().toISOString(),
      event: {
        type: "participants.muted_all",
        actorParticipantId: actor.userId,
        payload: {
          count: participants.length,
        },
      },
    });

  const response = json({ items: participants });
  recordApiMetric(env, {
    route: "moderation-mute-all",
    status: response.status,
    request,
    outcome: "muted_all",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();
  return response;
}

export async function lockMeeting(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  return setMeetingLockState(request, meetingInstanceId, env, true);
}

export async function unlockMeeting(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  return setMeetingLockState(request, meetingInstanceId, env, false);
}

export async function endMeeting(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.setStatus(meetingInstanceId, "ended");

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  repositories.participants.endMeeting(meetingInstanceId);

  const recording = repositories.recordings.getByMeetingInstanceId(meetingInstanceId);
  if (recording?.status === "recording") {
    repositories.recordings.upsert({
      ...recording,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    });
  }

  repositories.events.append({
    meetingInstanceId,
    type: "room.ended",
    payload: {
      meetingTitle: meeting.title,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "meeting.ended",
    target: meeting.title,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      endedAt: new Date().toISOString(),
      meetingStatus: "ended",
      recordingState: recording?.status === "recording" ? "stopped" : undefined,
      participants: repositories.participants.listByMeetingInstance(meetingInstanceId).map((participant) => ({
        participantId: participant.participantId,
        displayName: participant.displayName,
        role: participant.role,
        presence: "left",
      })),
      event: {
        type: "room.ended",
        actorParticipantId: actor.userId,
        payload: {
          meetingTitle: meeting.title,
        },
      },
    });

  const workspacePolicy = repositories.policies.getWorkspacePolicy(meeting.workspaceId);
  const shouldDispatchAutoFollowUp =
    workspacePolicy?.postMeetingHook.enabled && workspacePolicy.postMeetingHook.deliveryMode === "on_end";

  const response = json(meeting);
  recordApiMetric(env, {
    route: "meeting-end",
    status: response.status,
    request,
    outcome: "ended",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();

  if (shouldDispatchAutoFollowUp) {
    try {
      const followUpRepositories = await getRepositories(env);
      await dispatchConfiguredFollowUp({
        env,
        request,
        repositories: followUpRepositories,
        meetingInstanceId,
        actorLabel: actor.email ?? actor.userId,
        trigger: "meeting_end_auto",
      });
      await followUpRepositories.commit();
    } catch {}
  }

  return response;
}

export async function admitParticipant(
  request: Request,
  meetingInstanceId: string,
  participantId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const participant = repositories.participants.admitToMeeting(meetingInstanceId, participantId);

  if (!participant) {
    throw new ApiError(404, "participant_not_found");
  }

  repositories.meetings.setStatus(meetingInstanceId, "live");
  repositories.events.append({
    meetingInstanceId,
    type: "participant.admitted",
    payload: {
      participantId: participant.participantId,
      displayName: participant.displayName,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "lobby.admit",
    target: participant.displayName,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      meetingStatus: "live",
      participants: [
        {
          participantId: participant.participantId,
          displayName: participant.displayName,
          role: participant.role,
          presence: "active",
        },
      ],
      event: {
        type: "participant.admitted",
        actorParticipantId: actor.userId,
        payload: {
          participantId: participant.participantId,
          displayName: participant.displayName,
        },
      },
    });

  const response = json(participant);
  recordApiMetric(env, {
    route: "moderation-admit",
    status: response.status,
    request,
    outcome: "admitted",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();
  return response;
}

export async function removeParticipant(
  request: Request,
  meetingInstanceId: string,
  participantId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const participant = repositories.participants.removeFromMeeting(meetingInstanceId, participantId);

  if (!participant) {
    throw new ApiError(404, "participant_not_found");
  }

  repositories.events.append({
    meetingInstanceId,
    type: "participant.removed",
    payload: {
      participantId: participant.participantId,
      displayName: participant.displayName,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "participant.removed",
    target: participant.displayName,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      participants: [
        {
          participantId: participant.participantId,
          presence: "removed",
        },
      ],
      event: {
        type: "participant.removed",
        actorParticipantId: actor.userId,
        payload: {
          participantId: participant.participantId,
          displayName: participant.displayName,
        },
      },
    });

  const response = json(participant);
  recordApiMetric(env, {
    route: "moderation-remove",
    status: response.status,
    request,
    outcome: "removed",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();
  return response;
}

export async function leaveParticipant(
  request: Request,
  meetingInstanceId: string,
  participantId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const participant = repositories.participants.leaveMeeting(meetingInstanceId, participantId);

  if (!participant) {
    throw new ApiError(404, "participant_not_found");
  }

  repositories.events.append({
    meetingInstanceId,
    type: "participant.leave",
    payload: {
      participantId: participant.participantId,
      displayName: participant.displayName,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "participant.left",
    target: participant.displayName,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  await repositories.commit();

  await syncRealtimeRoomState(env, meetingInstanceId, {
    participants: [
      {
        participantId: participant.participantId,
        presence: "removed",
      },
    ],
    event: {
      type: "participant.leave",
      actorParticipantId: participant.participantId,
      payload: {
        participantId: participant.participantId,
        displayName: participant.displayName,
      },
    },
  });

  const response = json(participant);
  recordApiMetric(env, {
    route: "participant-leave",
    status: response.status,
    request,
    outcome: "left",
    workspaceId: actor.workspaceId,
  });
  return response;
}

async function setMeetingLockState(
  request: Request,
  meetingInstanceId: string,
  env: Env,
  isLocked: boolean,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.setLockState(meetingInstanceId, isLocked);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  repositories.events.append({
    meetingInstanceId,
    type: isLocked ? "room.locked" : "room.unlocked",
    payload: {
      isLocked,
    },
  });
  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: isLocked ? "room.locked" : "room.unlocked",
    target: meeting.title,
  });
  syncMeetingSummary(repositories, meetingInstanceId);
  const syncRealtime = () =>
    syncRealtimeRoomState(env, meetingInstanceId, {
      lockState: isLocked ? "locked" : "unlocked",
      event: {
        type: isLocked ? "room.locked" : "room.unlocked",
        actorParticipantId: actor.userId,
        payload: {
          isLocked,
        },
      },
    });

  const response = json(meeting);
  recordApiMetric(env, {
    route: isLocked ? "meeting-lock" : "meeting-unlock",
    status: response.status,
    request,
    outcome: isLocked ? "locked" : "unlocked",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  await syncRealtime();
  return response;
}
