import type {
  AdminOverview,
  AuditLogEntry,
  HookDeliveryAttempt,
  HookDeliverySummary,
  TemplateSummary,
  WorkspacePolicy,
} from "@opsui/shared-types";
import { getActorHeaders } from "./auth";
import { ADMIN_API_BASE_URL } from "./config";

export interface AdminDashboardPayload {
  metrics: Array<{ label: string; value: string }>;
  audit: AuditLogEntry[];
  hookDeliveries: HookDeliveryAttempt[];
  hookDeliverySummary: HookDeliverySummary;
  templates: TemplateSummary[];
  workspacePolicy: WorkspacePolicy;
}

export async function getAdminAuditItems(): Promise<AuditLogEntry[]> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/admin/audit`, {
    headers: await getActorHeaders(),
  });
  if (!response.ok) {
    throw new Error("Failed to load admin audit.");
  }

  const payload = (await response.json()) as { items: AuditLogEntry[] };
  return payload.items;
}

export async function getAdminDashboardPayload(): Promise<AdminDashboardPayload> {
  try {
    const actorHeaders = await getActorHeaders();
    const [overviewResponse, auditResponse, hookDeliveryResponse, templatesResponse, policyResponse] = await Promise.all([
      fetch(`${ADMIN_API_BASE_URL}/v1/admin/analytics/overview`, {
        headers: actorHeaders,
      }),
      fetch(`${ADMIN_API_BASE_URL}/v1/admin/audit`, {
        headers: actorHeaders,
      }),
      fetch(`${ADMIN_API_BASE_URL}/v1/admin/hooks/deliveries`, {
        headers: actorHeaders,
      }),
      fetch(`${ADMIN_API_BASE_URL}/v1/templates`, {
        headers: actorHeaders,
      }),
      fetch(`${ADMIN_API_BASE_URL}/v1/policies/workspace`, {
        headers: actorHeaders,
      }),
    ]);

    if (overviewResponse.ok && auditResponse.ok && hookDeliveryResponse.ok && templatesResponse.ok && policyResponse.ok) {
      const payload = (await overviewResponse.json()) as AdminOverview;
      const audit = (await auditResponse.json()) as { items: AuditLogEntry[] };
      const hookDeliveries = (await hookDeliveryResponse.json()) as {
        items: HookDeliveryAttempt[];
        summary: HookDeliverySummary;
      };
      const templates = (await templatesResponse.json()) as { items: TemplateSummary[] };
      const workspacePolicy = (await policyResponse.json()) as WorkspacePolicy;
      return {
        metrics: payload.metrics,
        audit: audit.items,
        hookDeliveries: hookDeliveries.items,
        hookDeliverySummary: hookDeliveries.summary,
        templates: templates.items,
        workspacePolicy,
      };
    }
  } catch {}

  return {
    metrics: [
      { label: "Live rooms", value: "12" },
      { label: "Lobby waits > 2 min", value: "1" },
      { label: "Recordings today", value: "7" },
      { label: "Current hook failures", value: "1" },
      { label: "Auto-on-end failures", value: "0" },
      { label: "Historical hook failures", value: "1" },
      { label: "Moderation actions", value: "24" },
    ],
    audit: [
      {
        id: "audit_1",
        actor: "Jordan Hale",
        action: "recording.started",
        target: "Operations Daily Handoff",
        occurredAt: "2026-03-26T09:01:00.000Z",
      },
      {
        id: "audit_2",
        actor: "Amira Vale",
        action: "lobby.admit",
        target: "Noah Pike",
        occurredAt: "2026-03-26T09:03:00.000Z",
      },
    ],
    hookDeliveries: [
      {
        id: "hook_attempt_1",
        workspaceId: "workspace_local",
        meetingInstanceId: "meeting_today",
        meetingTitle: "Operations Daily Handoff",
        actor: "Jordan Hale",
        trigger: "manual_dispatch",
        eventType: "meeting.follow_up",
        deliveryMode: "manual",
        targetUrl: "https://ops.example.com/hooks/meet-follow-up",
        ok: false,
        statusCode: 503,
        occurredAt: "2026-03-26T09:12:00.000Z",
      },
    ],
    hookDeliverySummary: {
      currentFailureCount: 1,
      autoOnEndFailureCount: 0,
      historicalFailureCount: 1,
      attentionItems: [
        {
          id: "hook_attempt_1",
          workspaceId: "workspace_local",
          meetingInstanceId: "meeting_today",
          meetingTitle: "Operations Daily Handoff",
          actor: "Jordan Hale",
          trigger: "manual_dispatch",
          eventType: "meeting.follow_up",
          deliveryMode: "manual",
          targetUrl: "https://ops.example.com/hooks/meet-follow-up",
          ok: false,
          statusCode: 503,
          occurredAt: "2026-03-26T09:12:00.000Z",
        },
      ],
    },
    templates: [
      {
        id: "template_standup",
        workspaceId: "workspace_local",
        name: "Internal Standup",
        templateType: "standup",
        description: "Fast daily team sync with muted entry and presenter screenshare.",
        isSystem: true,
      },
      {
        id: "template_training",
        workspaceId: "workspace_local",
        name: "Training Session",
        templateType: "training",
        description: "Instructor-led room with moderated join and attendance tracking.",
        isSystem: true,
      },
    ],
    workspacePolicy: {
      workspaceId: "workspace_local",
      defaultRoomPolicy: {
        lobbyEnabled: true,
        allowGuestJoin: true,
        joinBeforeHost: false,
        mutedOnEntry: true,
        cameraOffOnEntry: false,
        lockAfterStart: false,
        chatMode: "open",
        screenShareMode: "presenters",
        recordingMode: "manual",
      },
      guestJoinMode: "restricted",
      recordingAccess: "owner_host_only",
      postMeetingHook: {
        enabled: false,
        deliveryMode: "manual",
        targetUrl: "",
        secret: "",
        hasSecret: false,
        includeAttendance: true,
        includeActionItems: true,
        includeRecording: true,
      },
    },
  };
}
