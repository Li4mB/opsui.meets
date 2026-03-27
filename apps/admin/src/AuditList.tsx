import type { AuditLogEntry } from "@opsui/shared-types";

interface AuditListProps {
  items: AuditLogEntry[];
}

export function AuditList(props: AuditListProps) {
  return (
    <div
      style={{
        borderRadius: 20,
        background: "#fff",
        border: "1px solid rgba(19,33,25,0.08)",
        padding: 24,
        boxShadow: "0 12px 30px rgba(19,33,25,0.06)",
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
        Recent Audit
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {props.items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f6faf7",
              border: "1px solid rgba(19,33,25,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{formatAuditAction(item.action)}</strong>
              <span style={{ color: "#5d786a", fontSize: 13 }}>{item.occurredAt}</span>
            </div>
            <div style={{ marginTop: 6, color: "#5d786a", fontSize: 14 }}>
              {`${item.actor} -> ${item.target}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatAuditAction(action: string): string {
  switch (action) {
    case "follow_up.dispatched":
      return "Follow-up delivered";
    case "follow_up.dispatch_failed":
      return "Follow-up delivery failed";
    case "post_meeting_hook.tested":
      return "Hook test passed";
    case "post_meeting_hook.test_failed":
      return "Hook test failed";
    case "workspace.policy.updated":
      return "Workspace policy updated";
    default:
      return action;
  }
}
