import type { HookDeliveryAttempt } from "@opsui/shared-types";
import type { RepositoryContext } from "@opsui/db";

export function enrichHookDeliveryAttempts(
  repositories: Pick<RepositoryContext, "meetings">,
  attempts: HookDeliveryAttempt[],
): HookDeliveryAttempt[] {
  return attempts.map((attempt) => {
    if (attempt.meetingTitle || !attempt.meetingInstanceId) {
      return attempt;
    }

    const meeting = repositories.meetings.getById(attempt.meetingInstanceId);
    if (!meeting) {
      return attempt;
    }

    return {
      ...attempt,
      meetingTitle: meeting.title,
    };
  });
}
