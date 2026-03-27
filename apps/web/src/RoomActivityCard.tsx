import type { RoomEvent } from "@opsui/shared-types";

interface RoomActivityCardProps {
  events: RoomEvent[];
}

export function RoomActivityCard(props: RoomActivityCardProps) {
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
        Room Activity
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Live operational feed</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {props.events.map((event) => (
          <div
            key={event.eventId}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f6faf7",
              border: "1px solid rgba(17,32,24,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{formatEventTitle(event)}</strong>
              <span style={{ color: "#567567", fontSize: 13 }}>{event.occurredAt}</span>
            </div>
            <div style={{ marginTop: 6, color: "#567567", fontSize: 14 }}>
              {formatEventBody(event)} | event #{event.roomEventNumber}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatEventTitle(event: RoomEvent): string {
  switch (event.type) {
    case "participant.admitted":
      return "Lobby admitted";
    case "participant.removed":
      return "Participant removed";
    case "participants.muted_all":
      return "Mute all";
    case "room.locked":
      return "Room locked";
    case "room.unlocked":
      return "Room unlocked";
    case "room.ended":
      return "Meeting ended";
    case "recording.started":
      return "Recording started";
    case "recording.stopped":
      return "Recording stopped";
    case "action_item.created":
      return "Action item created";
    case "action_item.completed":
      return "Action item completed";
    case "follow_up.dispatched":
      return "Follow-up dispatched";
    default:
      return event.type;
  }
}

function formatEventBody(event: RoomEvent): string {
  const payload = typeof event.payload === "object" && event.payload !== null ? event.payload as Record<string, unknown> : {};

  switch (event.type) {
    case "participant.admitted":
    case "participant.removed":
      return String(payload.displayName ?? payload.participantId ?? "participant");
    case "participants.muted_all":
      return `${String(payload.count ?? 0)} participants updated`;
    case "room.locked":
      return "Late joiners are now held outside the room";
    case "room.unlocked":
      return "Room is open for normal admits";
    case "room.ended":
      return "Session has been closed by the host";
    case "action_item.created":
      return `Task opened: ${String(payload.title ?? "untitled action")}`;
    case "action_item.completed":
      return `Task closed: ${String(payload.title ?? "untitled action")}`;
    case "follow_up.dispatched":
      return `Summary hook ${Boolean(payload.ok) ? "delivered" : "failed"} to ${String(payload.targetUrl ?? "configured target")} [${String(payload.status ?? "network")}]`;
    default:
      return `actor ${event.actorParticipantId ?? "system"}`;
  }
}
