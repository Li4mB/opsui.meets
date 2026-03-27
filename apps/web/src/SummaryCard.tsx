import { useState } from "react";
import type { CSSProperties } from "react";
import type { ActionItem, HookDeliveryAttempt, RecordingSummary } from "@opsui/shared-types";

interface SummaryCardProps {
  headline: string;
  attendanceCount: number;
  actionItemCount: number;
  followUps: string[];
  actionItems: ActionItem[];
  followUpAttempts: HookDeliveryAttempt[];
  recording: RecordingSummary | null;
  isBusy: boolean;
  onExportFollowUp: () => void;
  onDispatchFollowUp: () => void;
  onRetryFollowUp: () => void;
  onCreateActionItem: (input: { title: string; ownerLabel?: string; dueAt?: string }) => void;
  onCompleteActionItem: (actionItemId: string) => void;
}

export function SummaryCard(props: SummaryCardProps) {
  const [title, setTitle] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [dueAt, setDueAt] = useState("");
  const openItems = props.actionItems.filter((item) => item.status === "open");
  const doneItems = props.actionItems.filter((item) => item.status === "done");
  const latestAttempt = props.followUpAttempts[0] ?? null;
  const recentAttempts = props.followUpAttempts.slice(0, 3);
  const recentFailureCount = recentAttempts.filter((attempt) => !attempt.ok).length;
  const deliveryPosture = latestAttempt
    ? latestAttempt.ok
      ? "healthy"
      : "attention"
    : "idle";

  return (
    <section
      style={{
        background: "#fff",
        borderRadius: 18,
        border: "1px solid rgba(17,32,24,0.08)",
        padding: 20,
        boxShadow: "0 12px 24px rgba(17,32,24,0.08)",
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
        Post-Meeting Output
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Operational summary</h2>
      <p style={{ margin: "0 0 14px", color: "#567567", lineHeight: 1.6 }}>{props.headline}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Metric label="Attendance" value={String(props.attendanceCount)} />
        <Metric label="Actions" value={String(props.actionItemCount)} />
        <Metric label="Recording" value={props.recording?.status ?? "missing"} />
        <Metric
          label="Hook"
          value={deliveryPosture}
          tone={deliveryPosture === "attention" ? "warn" : "neutral"}
        />
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onExportFollowUp}
            style={buttonStyle(props.isBusy)}
          >
            Export follow-up brief
          </button>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onDispatchFollowUp}
            style={buttonStyle(props.isBusy)}
          >
            Dispatch summary hook
          </button>
          {latestAttempt && !latestAttempt.ok ? (
            <button
              type="button"
              disabled={props.isBusy}
              onClick={props.onRetryFollowUp}
              style={buttonStyle(props.isBusy)}
            >
              Retry failed delivery
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: 10, color: "#567567", fontSize: 14 }}>
          {latestAttempt
            ? `Latest hook result: ${latestAttempt.meetingTitle ?? "This meeting"} / ${formatAttemptTrigger(latestAttempt.trigger)} -> ${latestAttempt.targetUrl} [${latestAttempt.statusCode ?? "network"}]`
            : "No follow-up delivery attempts yet for this meeting."}
        </div>
        {latestAttempt && !latestAttempt.ok ? (
          <div style={{ marginTop: 6, color: "#567567", fontSize: 13 }}>
            Retry uses the current workspace hook target and signing secret.
          </div>
        ) : null}
        {recentAttempts.length > 0 ? (
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {recentAttempts.map((attempt) => (
              <div
                key={attempt.id}
                style={{
                  borderRadius: 12,
                  background: "#f6faf7",
                  border: "1px solid rgba(17,32,24,0.08)",
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{formatAttemptTrigger(attempt.trigger)}</strong>
                  <span style={attemptBadgeStyle(attempt.ok)}>{attempt.ok ? "Delivered" : "Failed"}</span>
                </div>
                <div style={{ marginTop: 6, color: "#567567", fontSize: 13 }}>
                  {attempt.targetUrl} [{attempt.statusCode ?? "network"}]
                </div>
                <div style={{ marginTop: 4, color: "#567567", fontSize: 12 }}>
                  {formatOccurredAt(attempt.occurredAt)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {recentAttempts.length > 0 ? (
          <div style={{ marginTop: 10, color: "#567567", fontSize: 13 }}>
            Recent delivery failures: {recentFailureCount}
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        {props.followUps.map((followUp) => (
          <div
            key={followUp}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f6faf7",
              border: "1px solid rgba(17,32,24,0.08)",
              color: "#567567",
            }}
          >
            {followUp}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
          Action items
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {openItems.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              isBusy={props.isBusy}
              onComplete={() => props.onCompleteActionItem(item.id)}
            />
          ))}
          {openItems.length === 0 ? (
            <div style={{ color: "#567567", fontSize: 14 }}>No open action items for this session.</div>
          ) : null}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();

            if (!title.trim()) {
              return;
            }

            props.onCreateActionItem({
              title: title.trim(),
              ownerLabel: ownerLabel.trim() || undefined,
              dueAt: dueAt || undefined,
            });
            setTitle("");
            setOwnerLabel("");
            setDueAt("");
          }}
          style={{ marginTop: 14, display: "grid", gap: 10 }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Capture follow-up or owner task"
            style={inputStyle}
          />
          <input
            value={ownerLabel}
            onChange={(event) => setOwnerLabel(event.target.value)}
            placeholder="Owner label"
            style={inputStyle}
          />
          <input
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={props.isBusy || !title.trim()}
            style={buttonStyle(props.isBusy || !title.trim())}
          >
            Add action item
          </button>
        </form>
        {doneItems.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Completed
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {doneItems.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "#f6faf7",
                    border: "1px solid rgba(17,32,24,0.08)",
                    color: "#567567",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  {item.ownerLabel || item.dueAt ? (
                    <div style={{ marginTop: 4, fontSize: 13 }}>
                      {item.ownerLabel ? `Owner ${item.ownerLabel}` : "Owner unassigned"}
                      {item.dueAt ? ` | due ${item.dueAt.slice(0, 10)}` : ""}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ActionItemRow(props: {
  item: ActionItem;
  isBusy: boolean;
  onComplete: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: "#f6faf7",
        border: "1px solid rgba(17,32,24,0.08)",
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>{props.item.title}</div>
        <div style={{ marginTop: 4, color: "#567567", fontSize: 13 }}>
          {props.item.ownerLabel ? `Owner ${props.item.ownerLabel}` : "Owner unassigned"}
          {props.item.dueAt ? ` | due ${props.item.dueAt.slice(0, 10)}` : ""}
        </div>
      </div>
      <button
        type="button"
        disabled={props.isBusy}
        onClick={props.onComplete}
        style={buttonStyle(props.isBusy)}
      >
        Complete
      </button>
    </div>
  );
}

function Metric(props: { label: string; value: string; tone?: "neutral" | "warn" }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: props.tone === "warn" ? "#fff4eb" : "#f6faf7",
        border: "1px solid rgba(17,32,24,0.08)",
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#567567" }}>{props.label}</div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

const inputStyle = {
  borderRadius: 12,
  border: "1px solid rgba(17,32,24,0.14)",
  padding: "12px 14px",
  font: "inherit",
  color: "#17372c",
} satisfies CSSProperties;

function buttonStyle(disabled: boolean) {
  return {
    border: 0,
    borderRadius: 999,
    background: "#123326",
    color: "#f4f7f2",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  } satisfies CSSProperties;
}

function attemptBadgeStyle(ok: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "5px 9px",
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

function formatAttemptTrigger(trigger: HookDeliveryAttempt["trigger"]): string {
  switch (trigger) {
    case "admin_test":
      return "admin test";
    case "meeting_end_auto":
      return "auto on end";
    case "manual_dispatch":
      return "manual dispatch";
    case "manual_retry":
      return "manual retry";
    case "bulk_retry":
      return "bulk retry";
    default:
      return trigger;
  }
}
