import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { AppShell } from "./AppShell";
import { CreateNowCard } from "./CreateNowCard";
import { HostConsoleCard } from "./HostConsoleCard";
import { JoinCard } from "./JoinCard";
import { HOST_QUICK_ACTIONS } from "./layout";
import { getDashboardPayload } from "./lib/api";
import type { DashboardPayload } from "./lib/api";
import { getAuthCapabilities, getSessionState, logout, startLogin } from "./lib/auth";
import {
  admitParticipant,
  completeActionItem,
  createMediaSession,
  createActionItem,
  createInstantMeeting,
  dispatchFollowUpHookWithResult,
  endMeeting,
  exportAttendanceCsv,
  exportFollowUpBrief,
  lockMeeting,
  muteAllParticipants,
  removeParticipant,
  retryFollowUpHookWithResult,
  startRecording,
  stopRecording,
  unlockMeeting,
} from "./lib/commands";
import { PrejoinPanel } from "./PrejoinPanel";
import { buildRoomMetrics } from "./lib/view-models";
import { LIVE_ROOM_PANELS, WEB_ROUTES } from "./routes";
import { RoomActivityCard } from "./RoomActivityCard";
import { SummaryCard } from "./SummaryCard";
import { TemplatesCard } from "./TemplatesCard";

const sectionStyle: CSSProperties = {
  background: "rgba(255,255,255,0.8)",
  border: "1px solid rgba(17,32,24,0.12)",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 12px 32px rgba(17,32,24,0.08)",
};

export function App() {
  const [focusedMeetingId, setFocusedMeetingId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    return new URL(window.location.href).searchParams.get("meeting") ?? undefined;
  });
  const [payload, setPayload] = useState<DashboardPayload>({
    primaryMeeting: null,
    rooms: [],
    meetings: [],
    templates: [],
    participants: [],
    roomEvents: [],
    summary: {
      roomsCount: 0,
      meetingsCount: 0,
      activeParticipants: 0,
      lobbyParticipants: 0,
      raisedHands: 0,
    },
    meetingSummary: {
      headline: "",
      attendanceCount: 0,
      actionItemCount: 0,
      recordingStatus: "idle",
      followUps: [],
    },
      recording: null,
      actionItems: [],
      followUpAttempts: [],
    });
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [mediaSessionStatus, setMediaSessionStatus] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  async function refreshDashboard(nextFocusedMeetingId = focusedMeetingId) {
    setPayload(await getDashboardPayload(nextFocusedMeetingId));
    setLastSyncedAt(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    let mounted = true;

    void getDashboardPayload(focusedMeetingId).then((nextPayload) => {
      if (mounted) {
        setPayload(nextPayload);
        setLastSyncedAt(new Date().toLocaleTimeString());
      }
    });
    void getSessionState().then((nextSession) => {
      if (mounted) {
        setSession(nextSession);
      }
    });
    void getAuthCapabilities().then((nextCapabilities) => {
      if (mounted) {
        setAuthCapabilities(nextCapabilities);
      }
    });

    return () => {
      mounted = false;
    };
  }, [focusedMeetingId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!isMutating) {
        void refreshDashboard();
      }
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isMutating]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    if (focusedMeetingId) {
      url.searchParams.set("meeting", focusedMeetingId);
    } else {
      url.searchParams.delete("meeting");
    }

    window.history.replaceState({}, "", url.toString());
  }, [focusedMeetingId]);

  async function runMutation(
    action: () => Promise<boolean>,
    successMessage: string,
    failureMessage: string,
  ) {
    setIsMutating(true);
    setActionStatus(null);
    try {
      const ok = await action();
      if (ok) {
        await refreshDashboard();
        setActionStatus(successMessage);
      } else {
        setActionStatus(failureMessage);
      }
    } finally {
      setIsMutating(false);
    }
  }

  async function launchRoomSession(roomId: string, roomName: string) {
    setIsMutating(true);
    setActionStatus(null);

    try {
      const meeting = await createInstantMeeting({
        roomId,
        title: `${roomName} Live Session`,
        startsAt: new Date().toISOString(),
      });

      if (!meeting) {
        setActionStatus("Room launch failed.");
        return;
      }

      setFocusedMeetingId(meeting.id);
      await refreshDashboard(meeting.id);
      setActionStatus(`Live session launched for ${roomName}.`);
    } finally {
      setIsMutating(false);
    }
  }

  const roomMetrics = buildRoomMetrics(payload);

  return (
    <AppShell>
      <header style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              marginBottom: 18,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span
                style={{
                  borderRadius: 999,
                  padding: "8px 12px",
                  background: "#dfeee7",
                  color: "#214838",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {session?.authenticated ? `Signed in ${session.actor.userId}` : "Guest session"}
              </span>
              <span
                style={{
                  borderRadius: 999,
                  padding: "8px 12px",
                  background: "#edf3ef",
                  color: "#4d6f61",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                provider {session?.provider ?? "anonymous"} / workspace {session?.actor.workspaceId ?? "workspace_local"}
              </span>
              <span
                style={{
                  borderRadius: 999,
                  padding: "8px 12px",
                  background: "#edf3ef",
                  color: "#4d6f61",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                role {session?.actor.workspaceRole ?? "guest"} / source {session?.actor.membershipSource ?? "anonymous"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  startLogin(window.location.pathname + window.location.search);
                }}
                disabled={!authCapabilities?.oidcConfigured}
                style={{
                  ...headerSecondaryButtonStyle,
                  opacity: authCapabilities?.oidcConfigured ? 1 : 0.6,
                  cursor: authCapabilities?.oidcConfigured ? "pointer" : "not-allowed",
                }}
              >
                {authCapabilities?.oidcConfigured ? "OIDC login" : "OIDC unavailable"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMutating(true);
                  void logout()
                    .then(async (ok) => {
                      if (!ok) {
                        setActionStatus("Logout failed.");
                        return;
                      }
                      const nextSession = await getSessionState(true);
                      setSession(nextSession);
                      setActionStatus("Session cleared.");
                    })
                    .finally(() => {
                      setIsMutating(false);
                    });
                }}
                style={headerPrimaryButtonStyle}
              >
                Logout
              </button>
            </div>
          </div>
          <div style={{ letterSpacing: 1.6, fontSize: 12, textTransform: "uppercase", color: "#356451" }}>
            OpsUI Meets
          </div>
          <h1 style={{ fontSize: 48, lineHeight: 1, margin: "10px 0 14px" }}>
            Faster rooms. Cleaner control. Better follow-through.
          </h1>
          <p style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.5, margin: 0 }}>
            The first-pass shell is focused on the three differentiators that matter most:
            fast join, one-click host operations, and post-meeting outputs that turn sessions
            into actions.
          </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 20,
          alignItems: "start",
          marginBottom: 20,
        }}
      >
        <div style={sectionStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Live Room Shell
            </div>
            <div
              style={{
                display: "grid",
                gap: 14,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {roomMetrics.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: "#f6faf7",
                      border: "1px solid rgba(17,32,24,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 12, textTransform: "uppercase", color: "#567567" }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 700 }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {HOST_QUICK_ACTIONS.map((action) => (
                  <span
                    key={action}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 999,
                      background: "#123326",
                      color: "#f4f7f2",
                      fontSize: 13,
                    }}
                  >
                    {action}
                  </span>
                ))}
              </div>
              <div
                style={{
                  minHeight: 320,
                  borderRadius: 16,
                  background: "linear-gradient(135deg, #17372c 0%, #244b3d 100%)",
                  color: "#f4f7f2",
                  padding: 20,
                  display: "flex",
                  alignItems: "end",
                  fontSize: 22,
                  fontWeight: 600,
                }}
              >
                Stage region for screenshare, presenter, or active speaker.
              </div>
            </div>
        </div>

        <div style={sectionStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Room Panels
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {LIVE_ROOM_PANELS.map((panel) => (
                <div
                  key={panel}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: panel === "host-console" ? "#dfeee7" : "#f6faf7",
                    border: "1px solid rgba(17,32,24,0.08)",
                  }}
                >
                  {panel}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Participants
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {payload.participants.map((participant) => (
                <div
                  key={participant.participantId}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "#fff",
                    border: "1px solid rgba(17,32,24,0.08)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{participant.displayName}</strong>
                    <span style={{ color: "#567567", textTransform: "capitalize" }}>{participant.role}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#567567" }}>
                    {participant.presence} | audio {participant.audio} | video {participant.video}
                  </div>
                </div>
              ))}
            </div>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <section style={sectionStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Dashboard Summary
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              {[
                { label: "Rooms", value: String(payload.summary.roomsCount) },
                { label: "Meetings", value: String(payload.summary.meetingsCount) },
                { label: "Participants", value: String(payload.summary.activeParticipants) },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "#fff",
                    border: "1px solid rgba(17,32,24,0.08)",
                  }}
                >
                  <div style={{ fontSize: 12, textTransform: "uppercase", color: "#567567" }}>{item.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{item.value}</div>
                </div>
              ))}
            </div>
        </section>
        <JoinCard />
        <CreateNowCard
          templates={payload.templates}
          onCreated={(meetingInstanceId) => {
            setFocusedMeetingId(meetingInstanceId);
            void refreshDashboard(meetingInstanceId);
          }}
        />
        <PrejoinPanel
          roomId={payload.primaryMeeting?.roomId ?? payload.rooms[0]?.id ?? "room_ops_standup"}
          meetingInstanceId={payload.primaryMeeting?.id ?? payload.meetings[0]?.id ?? "meeting_today"}
        />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <section style={sectionStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Upcoming Meetings
            </div>
            <div style={{ marginBottom: 10, color: "#567567", fontSize: 14 }}>
              Active context: {payload.primaryMeeting?.title ?? "No meeting selected"}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {payload.meetings.map((meeting) => (
                <div
                  key={meeting.id}
                  onClick={() => {
                    setFocusedMeetingId(meeting.id);
                    void refreshDashboard(meeting.id);
                  }}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: payload.primaryMeeting?.id === meeting.id ? "#dfeee7" : "#fff",
                    border: "1px solid rgba(17,32,24,0.08)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{meeting.title}</div>
                  <div style={{ marginTop: 6, color: "#567567", fontSize: 14 }}>
                    {meeting.status} | starts {meeting.startsAt}
                  </div>
                  {payload.primaryMeeting?.id === meeting.id ? (
                    <div style={{ marginTop: 6, color: "#356451", fontSize: 13 }}>
                      join {payload.primaryMeeting.joinUrl}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
        </section>

        <section style={sectionStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
              Persistent Rooms
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {payload.rooms.map((room) => (
                <div
                  key={room.id}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "#fff",
                    border: "1px solid rgba(17,32,24,0.08)",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{room.name}</div>
                  <div style={{ marginTop: 6, color: "#567567", fontSize: 14 }}>
                    {room.roomType} | lobby {room.policy.lobbyEnabled ? "on" : "off"} | chat {room.policy.chatMode}
                  </div>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => {
                      void launchRoomSession(room.id, room.name);
                    }}
                    style={{
                      marginTop: 10,
                      border: 0,
                      borderRadius: 999,
                      background: "#123326",
                      color: "#f4f7f2",
                      padding: "10px 12px",
                      fontWeight: 700,
                      cursor: isMutating ? "not-allowed" : "pointer",
                      opacity: isMutating ? 0.6 : 1,
                    }}
                  >
                    Start live session
                  </button>
                </div>
              ))}
            </div>
        </section>

        <TemplatesCard templates={payload.templates} />
      </section>

      <SummaryCard
        headline={payload.meetingSummary.headline}
        attendanceCount={payload.meetingSummary.attendanceCount}
        actionItemCount={payload.meetingSummary.actionItemCount}
        followUps={payload.meetingSummary.followUps}
        actionItems={payload.actionItems}
        followUpAttempts={payload.followUpAttempts}
        recording={payload.recording}
        isBusy={isMutating || !payload.primaryMeeting}
        onExportFollowUp={() => {
          const meeting = payload.primaryMeeting;
          if (!meeting) {
            return;
          }

          void runMutation(
            () => exportFollowUpBrief(meeting.id, meeting.title),
            "Follow-up brief downloaded.",
            "Follow-up export failed.",
          );
        }}
        onDispatchFollowUp={() => {
          const meeting = payload.primaryMeeting;
          if (!meeting) {
            return;
          }

          setIsMutating(true);
          setActionStatus(null);

          void dispatchFollowUpHookWithResult(meeting.id)
            .then(async (result) => {
              if (result.ok) {
                await refreshDashboard();
                setActionStatus("Summary hook dispatched.");
                return;
              }

              setActionStatus(result.errorMessage ?? "Summary hook dispatch failed.");
            })
            .finally(() => {
              setIsMutating(false);
            });
        }}
        onRetryFollowUp={() => {
          const meeting = payload.primaryMeeting;
          if (!meeting) {
            return;
          }

          setIsMutating(true);
          setActionStatus(null);

          void retryFollowUpHookWithResult(meeting.id)
            .then(async (result) => {
              if (result.ok) {
                await refreshDashboard();
                setActionStatus("Summary hook retry sent.");
                return;
              }

              setActionStatus(result.errorMessage ?? "Summary hook retry failed.");
            })
            .finally(() => {
              setIsMutating(false);
            });
        }}
        onCreateActionItem={(input) => {
          const meeting = payload.primaryMeeting;
          if (!meeting) {
            return;
          }

          void runMutation(
            async () => Boolean(await createActionItem(meeting.id, input)),
            "Action item added to the meeting follow-up list.",
            "Action item creation failed.",
          );
        }}
        onCompleteActionItem={(actionItemId) => {
          const meeting = payload.primaryMeeting;
          if (!meeting) {
            return;
          }

          void runMutation(
            () => completeActionItem(meeting.id, actionItemId),
            "Action item marked complete.",
            "Action item update failed.",
          );
        }}
      />

      <div style={{ marginTop: 20 }}>
        <HostConsoleCard
          meeting={payload.primaryMeeting}
          participants={payload.participants}
          recording={payload.recording}
          statusMessage={actionStatus}
          lastSyncedAt={lastSyncedAt}
          isBusy={isMutating}
          onMuteAll={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () => muteAllParticipants(meeting.id),
              "Everyone in the active room was muted.",
              "Mute-all failed.",
            );
          }}
          onToggleLock={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(() =>
              meeting.isLocked ? unlockMeeting(meeting.id) : lockMeeting(meeting.id),
              meeting.isLocked ? "Room unlocked for admits." : "Room locked against late entry.",
              "Room lock update failed.",
            );
          }}
          onToggleRecording={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () =>
                payload.recording?.status === "recording"
                  ? stopRecording(meeting.id)
                  : startRecording(meeting.id),
              payload.recording?.status === "recording"
                ? "Recording stopped."
                : "Recording started.",
              "Recording control failed.",
            );
          }}
          onCreateMediaSession={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            const currentParticipant =
              payload.participants.find((participant) => participant.presence === "active") ??
              payload.participants[0];

            setIsMutating(true);
            setActionStatus(null);

            void createMediaSession(
              meeting.id,
              currentParticipant?.participantId ?? "participant_local",
              currentParticipant?.role ?? "participant",
            )
              .then((session) => {
                if (!session) {
                  setActionStatus("Media session preparation failed.");
                  setMediaSessionStatus(null);
                  return;
                }

                setMediaSessionStatus(`token ready until ${new Date(session.expiresAt).toLocaleTimeString()}`);
                setActionStatus("Media session prepared for the live room.");
              })
              .finally(() => {
                setIsMutating(false);
              });
          }}
          onEndMeeting={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () => endMeeting(meeting.id),
              "Meeting ended and room state closed.",
              "End meeting failed.",
            );
          }}
          onExportAttendance={() => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () => exportAttendanceCsv(meeting.id, meeting.title),
              "Attendance export downloaded.",
              "Attendance export failed.",
            );
          }}
          onAdmit={(participantId) => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () => admitParticipant(meeting.id, participantId),
              "Participant admitted from lobby.",
              "Admit failed.",
            );
          }}
          onRemove={(participantId) => {
            const meeting = payload.primaryMeeting;
            if (!meeting) {
              return;
            }

            void runMutation(
              () => removeParticipant(meeting.id, participantId),
              "Participant removed from room.",
              "Remove failed.",
            );
          }}
          mediaSessionStatus={mediaSessionStatus}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <RoomActivityCard events={payload.roomEvents} />
      </div>

      <section style={{ ...sectionStyle, marginTop: 20 }}>
        <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
          Route Inventory
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {WEB_ROUTES.map((route) => (
            <div
              key={route}
              style={{
                padding: "14px 16px",
                borderRadius: 14,
                border: "1px solid rgba(17,32,24,0.08)",
                background: "#fff",
              }}
            >
              {route}
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

const headerPrimaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 999,
  background: "#123326",
  color: "#f4f7f2",
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
};

const headerSecondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(17,32,24,0.12)",
  borderRadius: 999,
  background: "#f6faf7",
  color: "#112018",
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
