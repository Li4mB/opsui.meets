import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import type { Env } from "../types";

export async function getMeetingRecording(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const recording = repositories.recordings.getByMeetingInstanceId(meetingInstanceId);
  if (!recording) {
    return notFound();
  }

  await repositories.commit();
  return json(recording);
}
