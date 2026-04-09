import { CloudflareRealtimeAdapter } from "@opsui/media-adapter";
import type { RecordingSummary } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { ApiError, json } from "../lib/http";
import type { Env } from "../types";

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
