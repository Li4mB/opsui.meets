import type { ParticipantState } from "@opsui/shared-types";
import { getRepositories } from "../lib/data";
import { recordApiMetric } from "../lib/analytics";
import { getActorContext } from "../lib/actor";
import { ApiError, json } from "../lib/http";
import { parseJson } from "../lib/request";
import type { Env } from "../types";

export async function listParticipants(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const response = json({
    items: repositories.participants.listByMeetingInstance(meetingInstanceId),
  });
  await repositories.commit();
  return response;
}

export async function touchParticipantSession(
  request: Request,
  meetingInstanceId: string,
  participantId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<{ clientSessionId?: string }>(request);
  const joinSessionId =
    typeof payload.clientSessionId === "string" && payload.clientSessionId.trim()
      ? payload.clientSessionId.trim()
      : undefined;
  const participant = repositories.participants.touchSessionLease(
    meetingInstanceId,
    participantId,
    joinSessionId,
  );

  if (!participant) {
    throw new ApiError(404, "participant_not_found");
  }

  const response = json(participant satisfies ParticipantState);
  recordApiMetric(env, {
    route: "participant-heartbeat",
    status: response.status,
    request,
    outcome: "ok",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  return response;
}
