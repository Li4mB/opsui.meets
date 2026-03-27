import type { CreateMeetingMediaSessionInput, MeetingMediaSession } from "@opsui/shared-types";
import { CloudflareRealtimeAdapter } from "@opsui/media-adapter";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { ApiError, json } from "../lib/http";
import { parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

export async function createMeetingMediaSession(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const payload = await parseJson<CreateMeetingMediaSessionInput>(request);
  const participantId = requireNonEmptyString(
    payload.participantId,
    "participant_id_required",
    "participant_local",
  );
  const role = requireNonEmptyString(payload.role, "participant_role_required", "participant");
  const mediaAdapter = new CloudflareRealtimeAdapter(env.MEDIA_SERVICE, env.MEDIA_CONTROL_SHARED_SECRET);

  let session: MeetingMediaSession;
  try {
    session = await mediaAdapter.createSession({
      meetingInstanceId,
      participantId,
      role,
    });
  } catch (error) {
    throw new ApiError(
      502,
      error instanceof Error ? error.message : "media_session_create_failed",
    );
  }

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "media_session.created",
    target: `${meeting.title} / ${participantId}`,
  });

  const response = json(session, { status: 201 });
  recordApiMetric(env, {
    route: "media-session-create",
    status: response.status,
    request,
    outcome: role,
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  return response;
}
