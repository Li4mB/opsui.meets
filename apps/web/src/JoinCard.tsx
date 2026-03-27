import type { CSSProperties } from "react";

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  border: "1px solid rgba(17,32,24,0.08)",
  padding: 20,
  boxShadow: "0 12px 24px rgba(17,32,24,0.08)",
};

export function JoinCard() {
  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
        Fast Join
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Low-friction room entry</h2>
      <p style={{ margin: 0, color: "#567567", lineHeight: 1.6 }}>
        Invite link, display name, device preview, join. No account wall for guests when room policy
        allows it.
      </p>
    </section>
  );
}
