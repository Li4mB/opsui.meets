import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function listRoomEvents(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const response = json({
    items: repositories.events.listByMeetingInstance(meetingInstanceId),
  });
  await repositories.commit();
  return response;
}
