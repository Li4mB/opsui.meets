import { useState } from "react";
import type { CSSProperties } from "react";
import type { HookDeliveryAttempt, HookDeliverySummary, WorkspacePolicy } from "@opsui/shared-types";

interface FollowUpHooksPanelProps {
  policy: WorkspacePolicy | null;
  attempts: HookDeliveryAttempt[];
  summary: HookDeliverySummary;
  onRetryAttempt: (meetingInstanceId: string) => void;
  onRetryAllFailures: () => void;
  isRetrying: boolean;
}

export function FollowUpHooksPanel(props: FollowUpHooksPanelProps) {
  const [showFailuresOnly, setShowFailuresOnly] = useState(true);
  const [hideAdminTests, setHideAdminTests] = useState(true);

  if (!props.policy) {
    return null;
  }
  const successCount = props.attempts.filter((item) => item.ok).length;
  const failureCount = props.summary.historicalFailureCount;
  const autoFailureCount = props.summary.autoOnEndFailureCount;
  const affectedMeetingCount = props.summary.currentFailureCount;
  const latestAttempt = props.attempts[0] ?? null;
  const meetingsNeedingAttention = props.summary.attentionItems;
  const filteredAttempts = props.attempts.filter((attempt) => {
    if (showFailuresOnly && attempt.ok) {
      return false;
    }

    if (hideAdminTests && attempt.trigger === "admin_test") {
      return false;
    }

    return true;
  });

  return (
    <div
      style={{
        borderRadius: 20,
        background: "#fff",
        border: "1px solid rgba(19,33,25,0.08)",
        padding: 24,
        boxShadow: "0 12px 30px rgba(19,33,25,0.06)",
        display: "grid",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
          Hook Delivery
        </div>
        <h3 style={{ margin: 0 }}>Post-meeting delivery posture</h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <Metric label="Enabled" value={props.policy.postMeetingHook.enabled ? "Yes" : "No"} />
        <Metric label="Mode" value={props.policy.postMeetingHook.deliveryMode} />
        <Metric label="Current failures" value={String(affectedMeetingCount)} tone={affectedMeetingCount > 0 ? "warn" : "neutral"} />
        <Metric label="Auto-on-end" value={String(autoFailureCount)} tone={autoFailureCount > 0 ? "warn" : "neutral"} />
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderRadius: 14,
          background: "#f6faf7",
          border: "1px solid rgba(19,33,25,0.08)",
          color: "#466154",
          lineHeight: 1.6,
        }}
      >
        <div><strong>Target:</strong> {props.policy.postMeetingHook.targetUrl || "Not configured"}</div>
        <div><strong>Signing:</strong> {props.policy.postMeetingHook.hasSecret ? "HMAC configured" : "No secret set"}</div>
        <div>
          <strong>Payload:</strong>{" "}
          {[
            props.policy.postMeetingHook.includeAttendance ? "attendance" : null,
            props.policy.postMeetingHook.includeActionItems ? "action items" : null,
            props.policy.postMeetingHook.includeRecording ? "recording" : null,
          ]
            .filter(Boolean)
            .join(", ") || "summary only"}
        </div>
        <div><strong>Recent successes:</strong> {successCount}</div>
        <div><strong>Historical failures:</strong> {failureCount}</div>
        <div><strong>Auto-on-end failures:</strong> {autoFailureCount}</div>
        <div>
          <strong>Latest result:</strong>{" "}
          {latestAttempt
            ? `${latestAttempt.meetingTitle ?? "Workspace hook"} / ${formatAttemptTrigger(latestAttempt.trigger)} -> ${latestAttempt.targetUrl} [${latestAttempt.statusCode ?? "network"}]`
            : "No delivery activity yet"}
        </div>
        <div>
          <strong>Retry behavior:</strong> Meeting retries use the current workspace hook target and signing secret.
        </div>
      </div>

      {meetingsNeedingAttention.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 10,
            padding: "14px 16px",
            borderRadius: 14,
            background: "#fff4eb",
            border: "1px solid rgba(139,74,24,0.16)",
          }}
        >
          <div style={{ fontSize: 13, textTransform: "uppercase", color: "#8b4a18" }}>
            Needs Attention
          </div>
          <div>
            <button
              type="button"
              disabled={props.isRetrying}
              onClick={props.onRetryAllFailures}
              style={{
                border: 0,
                borderRadius: 999,
                background: "#8b4a18",
                color: "#fff7f1",
                padding: "10px 14px",
                fontWeight: 700,
                cursor: props.isRetrying ? "not-allowed" : "pointer",
                opacity: props.isRetrying ? 0.6 : 1,
              }}
            >
              Retry all failing meetings
            </button>
          </div>
          {meetingsNeedingAttention.map((attempt) => (
            <div
              key={attempt.id}
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fff",
                border: "1px solid rgba(139,74,24,0.14)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <strong>{attempt.meetingTitle ?? "Meeting follow-up"}</strong>
                <span style={attemptStatusStyle(false)}>Failed</span>
              </div>
              <div style={{ marginTop: 6, color: "#8b4a18", fontSize: 14 }}>
                {`${formatAttemptTrigger(attempt.trigger)} -> ${attempt.targetUrl} [${attempt.statusCode ?? "network"}]`}
              </div>
              <div style={{ marginTop: 4, color: "#8b4a18", fontSize: 12 }}>
                {formatOccurredAt(attempt.occurredAt)}
              </div>
              {attempt.meetingInstanceId ? (
                <button
                  type="button"
                  disabled={props.isRetrying}
                  onClick={() => {
                    if (attempt.meetingInstanceId) {
                      props.onRetryAttempt(attempt.meetingInstanceId);
                    }
                  }}
                  style={{
                    marginTop: 10,
                    border: 0,
                    borderRadius: 999,
                    background: "#8b4a18",
                    color: "#fff7f1",
                    padding: "9px 12px",
                    fontWeight: 700,
                    cursor: props.isRetrying ? "not-allowed" : "pointer",
                    opacity: props.isRetrying ? 0.6 : 1,
                  }}
                >
                  Retry now
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            setShowFailuresOnly((current) => !current);
          }}
          style={toggleButtonStyle(showFailuresOnly)}
        >
          {showFailuresOnly ? "Showing failures only" : "Showing all attempts"}
        </button>
        <button
          type="button"
          onClick={() => {
            setHideAdminTests((current) => !current);
          }}
          style={toggleButtonStyle(hideAdminTests)}
        >
          {hideAdminTests ? "Admin tests hidden" : "Admin tests visible"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {filteredAttempts.length > 0 ? (
          filteredAttempts.slice(0, 5).map((attempt) => (
            <div
              key={attempt.id}
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "#f6faf7",
                border: "1px solid rgba(19,33,25,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{formatAttemptTrigger(attempt.trigger)}</strong>
                <span style={{ color: "#5d786a", fontSize: 13 }}>{formatOccurredAt(attempt.occurredAt)}</span>
              </div>
              {attempt.meetingTitle ? (
                <div style={{ marginTop: 6, color: "#24463a", fontSize: 14, fontWeight: 600 }}>
                  {attempt.meetingTitle}
                </div>
              ) : null}
              <div style={{ marginTop: 6, color: "#5d786a", fontSize: 14 }}>
                {`${attempt.actor} -> ${attempt.targetUrl} [${attempt.statusCode ?? "network"}]`}
              </div>
              <div style={{ marginTop: 6, color: "#5d786a", fontSize: 14 }}>
                {attempt.eventType} | {attempt.deliveryMode} | {attempt.ok ? "ok" : "failed"}
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={attemptStatusStyle(attempt.ok)}>
                  {attempt.ok ? "Delivered" : "Failed"}
                </span>
              </div>
              {!attempt.ok && attempt.meetingInstanceId ? (
                <button
                  type="button"
                  disabled={props.isRetrying}
                  onClick={() => {
                    if (attempt.meetingInstanceId) {
                      props.onRetryAttempt(attempt.meetingInstanceId);
                    }
                  }}
                  style={{
                    marginTop: 10,
                    border: 0,
                    borderRadius: 999,
                    background: "#123326",
                    color: "#f4f7f2",
                    padding: "9px 12px",
                    fontWeight: 700,
                    cursor: props.isRetrying ? "not-allowed" : "pointer",
                    opacity: props.isRetrying ? 0.6 : 1,
                  }}
                >
                  Retry meeting delivery
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <div style={{ color: "#5d786a", fontSize: 14 }}>
            {props.attempts.length > 0
              ? "No delivery attempts match the current filters."
              : "No hook delivery activity yet. Test the target or dispatch a meeting follow-up to populate this feed."}
          </div>
        )}
      </div>
    </div>
  );
}

function formatAttemptTrigger(trigger: HookDeliveryAttempt["trigger"]): string {
  switch (trigger) {
    case "admin_test":
      return "Admin test";
    case "meeting_end_auto":
      return "Auto on end";
    case "manual_dispatch":
      return "Manual dispatch";
    case "manual_retry":
      return "Manual retry";
    case "bulk_retry":
      return "Bulk retry";
    default:
      return trigger;
  }
}

function Metric(props: { label: string; value: string; tone?: "neutral" | "warn" }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: props.tone === "warn" ? "#fff4eb" : "#f6faf7",
        border: "1px solid rgba(19,33,25,0.08)",
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{props.label}</div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

function toggleButtonStyle(active: boolean) {
  return {
    border: 0,
    borderRadius: 999,
    background: active ? "#123326" : "#dfeee7",
    color: active ? "#f4f7f2" : "#24463a",
    padding: "9px 12px",
    fontWeight: 700,
    cursor: "pointer",
  } satisfies CSSProperties;
}

function attemptStatusStyle(ok: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "6px 10px",
    background: ok ? "#dfeee7" : "#fff4eb",
    color: ok ? "#24463a" : "#8b4a18",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
  } satisfies CSSProperties;
}

function formatOccurredAt(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
