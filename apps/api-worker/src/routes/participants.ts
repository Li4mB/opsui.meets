import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function listParticipants(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const response = json({
    items: repositories.participants.listByMeetingInstance(meetingInstanceId),
  });
  await repositories.commit();
  return response;
}
