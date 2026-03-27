import type { CSSProperties } from "react";
import type { MeetingDetail, ParticipantState, RecordingSummary } from "@opsui/shared-types";

interface HostConsoleCardProps {
  meeting: MeetingDetail | null;
  participants: ParticipantState[];
  recording: RecordingSummary | null;
  mediaSessionStatus: string | null;
  onMuteAll(): void;
  onToggleLock(): void;
  onToggleRecording(): void;
  onCreateMediaSession(): void;
  onEndMeeting(): void;
  onExportAttendance(): void;
  onAdmit(participantId: string): void;
  onRemove(participantId: string): void;
  statusMessage: string | null;
  lastSyncedAt: string | null;
  isBusy: boolean;
}

export function HostConsoleCard(props: HostConsoleCardProps) {
  const lobby = props.participants.filter((participant) => participant.presence === "lobby");
  const active = props.participants.filter(
    (participant) => participant.presence !== "lobby" && participant.presence !== "left",
  );
  const isRecording = props.recording?.status === "recording";
  const isEnded = props.meeting?.status === "ended";

  return (
    <section style={sectionStyle}>
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
        Host Console
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>One-click operational control</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <StatusPill
          label={props.meeting?.isLocked ? "Room locked" : "Room open"}
          tone={isEnded ? "neutral" : props.meeting?.isLocked ? "warn" : "ok"}
        />
        <StatusPill label={`Status ${props.meeting?.status ?? "idle"}`} tone={isEnded ? "neutral" : "ok"} />
        <StatusPill
          label={isRecording ? "Recording live" : `Recording ${props.recording?.status ?? "idle"}`}
          tone={isRecording ? "danger" : "neutral"}
        />
        <StatusPill label={props.mediaSessionStatus ?? "Media session idle"} tone={props.mediaSessionStatus ? "ok" : "neutral"} />
        <StatusPill label={`${lobby.length} in lobby`} tone={lobby.length ? "warn" : "neutral"} />
        <StatusPill label={`${active.length} active`} tone="ok" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <ActionButton label="Mute all" disabled={props.isBusy || !props.meeting || isEnded} onClick={props.onMuteAll} />
        <ActionButton
          label={props.meeting?.isLocked ? "Unlock room" : "Lock room"}
          disabled={props.isBusy || !props.meeting || isEnded}
          onClick={props.onToggleLock}
          emphasis
        />
        <ActionButton
          label={isRecording ? "Stop recording" : "Start recording"}
          disabled={props.isBusy || !props.meeting || isEnded}
          onClick={props.onToggleRecording}
          danger={isRecording}
        />
        <ActionButton
          label="Prepare media"
          disabled={props.isBusy || !props.meeting || isEnded}
          onClick={props.onCreateMediaSession}
        />
        <ActionButton
          label="Export attendance"
          disabled={props.isBusy || !props.meeting}
          onClick={props.onExportAttendance}
        />
        <ActionButton
          label="End meeting"
          disabled={props.isBusy || !props.meeting || isEnded}
          onClick={props.onEndMeeting}
          danger
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <span style={{ color: "#567567", fontSize: 14 }}>
          {props.statusMessage ?? "Host actions sync to backend audit and room events."}
        </span>
        <span style={{ color: "#567567", fontSize: 13 }}>
          {props.lastSyncedAt ? `Synced ${props.lastSyncedAt}` : "Sync pending"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={sectionLabelStyle}>Lobby queue</div>
          <div style={{ display: "grid", gap: 10 }}>
            {lobby.length ? (
              lobby.map((participant) => (
                <ParticipantRow
                  key={participant.participantId}
                  participant={participant}
                  rightActions={[
                    {
                      label: "Admit",
                      disabled: props.isBusy,
                      onClick: () => props.onAdmit(participant.participantId),
                    },
                    {
                      label: "Remove",
                      disabled: props.isBusy,
                      danger: true,
                      onClick: () => props.onRemove(participant.participantId),
                    },
                  ]}
                />
              ))
            ) : (
              <EmptyState copy="No one is waiting in lobby." />
            )}
          </div>
        </div>

        <div>
          <div style={sectionLabelStyle}>
            Live roster {props.meeting ? `| room ${props.meeting.isLocked ? "locked" : "open"}` : ""}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {active.length ? (
              active.map((participant) => (
                <ParticipantRow
                  key={participant.participantId}
                  participant={participant}
                  rightActions={[
                    {
                      label: "Remove",
                      disabled: props.isBusy,
                      danger: true,
                      onClick: () => props.onRemove(participant.participantId),
                    },
                  ]}
                />
              ))
            ) : (
              <EmptyState copy="No active participants yet." />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ParticipantRow(props: {
  participant: ParticipantState;
  rightActions: Array<{ label: string; onClick(): void; disabled: boolean; danger?: boolean }>;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 14,
        background: "#f6faf7",
        border: "1px solid rgba(17,32,24,0.08)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong>{props.participant.displayName}</strong>
        <span style={{ color: "#567567", textTransform: "capitalize" }}>{props.participant.role}</span>
      </div>
      <div style={{ marginTop: 6, color: "#567567", fontSize: 13 }}>
        {props.participant.presence} | audio {props.participant.audio} | video {props.participant.video}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {props.rightActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            style={{
              ...actionButtonStyle,
              background: action.danger ? "#fff1ee" : "#123326",
              color: action.danger ? "#8f3424" : "#f4f7f2",
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButton(props: {
  label: string;
  onClick(): void;
  disabled: boolean;
  emphasis?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...actionButtonStyle,
        background: props.danger ? "#8f3424" : props.emphasis ? "#10231b" : "#123326",
        color: "#f4f7f2",
        opacity: props.disabled ? 0.6 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer",
      }}
    >
      {props.label}
    </button>
  );
}

function StatusPill(props: { label: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  return (
    <span
      style={{
        borderRadius: 999,
        padding: "8px 10px",
        fontSize: 13,
        fontWeight: 700,
        background:
          props.tone === "ok"
            ? "#dfeee7"
            : props.tone === "warn"
              ? "#fff3dd"
              : props.tone === "danger"
                ? "#ffe4df"
                : "#edf3ef",
        color:
          props.tone === "ok"
            ? "#214838"
            : props.tone === "warn"
              ? "#7a5a14"
              : props.tone === "danger"
                ? "#8f3424"
                : "#4d6f61",
      }}
    >
      {props.label}
    </span>
  );
}

function EmptyState(props: { copy: string }) {
  return (
    <div
      style={{
        padding: "16px 14px",
        borderRadius: 14,
        background: "#f6faf7",
        border: "1px dashed rgba(17,32,24,0.12)",
        color: "#567567",
      }}
    >
      {props.copy}
    </div>
  );
}

const sectionStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  border: "1px solid rgba(17,32,24,0.08)",
  padding: 20,
  boxShadow: "0 12px 24px rgba(17,32,24,0.08)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  color: "#4d6f61",
  marginBottom: 10,
};

const actionButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "10px 12px",
  fontWeight: 700,
};
