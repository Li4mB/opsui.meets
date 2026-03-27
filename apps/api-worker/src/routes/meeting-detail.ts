import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import type { Env } from "../types";

export async function getMeetingDetail(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    return notFound();
  }

  await repositories.commit();
  return json(meeting);
}
