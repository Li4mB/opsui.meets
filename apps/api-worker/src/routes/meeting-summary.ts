import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import type { Env } from "../types";

export async function getMeetingSummary(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const summary = repositories.meetings.getSummary(meetingInstanceId);
  if (!summary) {
    return notFound();
  }

  await repositories.commit();
  return json(summary);
}
