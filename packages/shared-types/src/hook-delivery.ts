export interface HookDeliveryAttempt {
  id: string;
  workspaceId: string;
  meetingInstanceId?: string;
  meetingTitle?: string;
  actor: string;
  trigger: "manual_dispatch" | "manual_retry" | "bulk_retry" | "meeting_end_auto" | "admin_test";
  eventType: "meeting.follow_up" | "meeting.follow_up.test";
  deliveryMode: "manual" | "on_end";
  targetUrl: string;
  ok: boolean;
  statusCode: number | null;
  occurredAt: string;
}
