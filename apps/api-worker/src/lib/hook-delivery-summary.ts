import type { HookDeliveryAttempt, HookDeliverySummary } from "@opsui/shared-types";

export function summarizeHookDeliveries(attempts: HookDeliveryAttempt[]): HookDeliverySummary {
  const latestMeetingAttempts = getLatestMeetingAttempts(attempts);
  const attentionItems = latestMeetingAttempts.filter((attempt) => !attempt.ok);

  return {
    currentFailureCount: attentionItems.length,
    autoOnEndFailureCount: attentionItems.filter((attempt) => attempt.trigger === "meeting_end_auto").length,
    historicalFailureCount: attempts.filter((attempt) => !attempt.ok).length,
    attentionItems: attentionItems.slice(0, 3),
  };
}

function getLatestMeetingAttempts(attempts: HookDeliveryAttempt[]): HookDeliveryAttempt[] {
  const latestByMeeting = new Map<string, HookDeliveryAttempt>();

  return attempts.filter((attempt) => {
    if (!attempt.meetingInstanceId || attempt.trigger === "admin_test") {
      return false;
    }

    if (latestByMeeting.has(attempt.meetingInstanceId)) {
      return false;
    }

    latestByMeeting.set(attempt.meetingInstanceId, attempt);
    return true;
  });
}
