import { getRepositories } from "../lib/data";
import { enrichHookDeliveryAttempts } from "../lib/hook-delivery-view";
import { ApiError, json } from "../lib/http";
import type { Env } from "../types";

export async function listFollowUpAttempts(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const response = json({
    items: enrichHookDeliveryAttempts(
      repositories,
      repositories.hookDeliveries.listByMeetingInstance(meetingInstanceId),
    ),
  });
  await repositories.commit();
  return response;
}
