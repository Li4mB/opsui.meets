import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AuthCapabilities, ChatMessageEventPayload, ParticipantState, RoomEvent, SessionInfo } from "@opsui/shared-types";
import { MeetingConversationPanel } from "../components/MeetingConversationPanel";
import { MeetingMediaStage } from "../components/MeetingMediaStage";
import { Modal } from "../components/Modal";
import { getSessionDisplayName, startLogin } from "../lib/auth";
import {
  admitParticipant,
  createInstantMeeting,
  endMeeting,
  joinMeeting,
  leaveMeetingParticipantInBackground,
  lockMeeting,
  muteAllParticipants,
  removeParticipant,
  sendChatMessage,
  startRecording,
  stopRecording,
  unlockMeeting,
} from "../lib/commands";
import { REALTIME_BASE_URL } from "../lib/config";
import { formatMeetingCodeLabel } from "../lib/meeting-code";
import { getMeetingShareUrl, loadMeetingRoomData, type MeetingRoomData } from "../lib/meetings";

interface MeetingRoomPageProps {
  authCapabilities: AuthCapabilities | null;
  isAuthLoading: boolean;
  meetingCode: string;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { message: string; status: "error" }
  | { data: MeetingRoomData; status: "ready" };

type JoinUiState = "idle" | "joining" | "direct" | "lobby" | "blocked" | "error";

export function MeetingRoomPage(props: MeetingRoomPageProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [joinState, setJoinState] = useState<JoinUiState>("idle");
  const [guestDisplayName, setGuestDisplayName] = useState("");
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const autoJoinKeyRef = useRef<string | null>(null);
  const sessionRef = useRef(props.session);

  useEffect(() => {
    sessionRef.current = props.session;
  }, [props.session]);

  const refreshRoom = useEffectEvent(async () => {
    try {
      const nextData = await loadMeetingRoomData(props.meetingCode);
      if (!nextData) {
        setLoadState((current) => {
          if (current.status === "ready") {
            return current;
          }

          return { status: "not-found" };
        });
        return;
      }

      setServiceMessage(null);
      setLoadState({
        data: nextData,
        status: "ready",
      });
    } catch {
      setLoadState((current) => {
        if (current.status === "ready") {
          return current;
        }

        return {
          message: "Meeting services are temporarily unavailable. Please retry in a moment.",
          status: "error",
        };
      });
      setServiceMessage("Connection to meeting services was interrupted. Retrying in the background.");
    }
  });

  useEffect(() => {
    autoJoinKeyRef.current = null;
    setJoinState("idle");
    setJoinMessage(null);
    setActionMessage(null);
    setServiceMessage(null);
    setParticipantId(null);
    setGuestModalOpen(false);
    setLoadState({ status: "loading" });

    void refreshRoom();
  }, [props.meetingCode]);

  const meeting = loadState.status === "ready" ? loadState.data.meeting : null;
  const room = loadState.status === "ready" ? loadState.data.room : null;
  const participants = loadState.status === "ready" ? loadState.data.participants : [];
  const events = loadState.status === "ready" ? loadState.data.events : [];
  const recording = loadState.status === "ready" ? loadState.data.recording : null;
  const currentParticipant = participantId
    ? participants.find((entry) => entry.participantId === participantId) ?? null
    : null;

  useEffect(() => {
    if (joinState !== "lobby" || !participantId || !currentParticipant) {
      return;
    }

    if (currentParticipant.presence === "active") {
      setJoinState("direct");
      setJoinMessage("You were admitted to the room.");
    }

    if (currentParticipant.presence === "left") {
      setJoinState("blocked");
      setJoinMessage("You were removed from the meeting.");
    }
  }, [currentParticipant, joinState, participantId]);

  useEffect(() => {
    if (props.isAuthLoading || loadState.status !== "ready" || !loadState.data.meeting || !props.session) {
      return;
    }

    if (!props.session.authenticated) {
      if (joinState === "idle") {
        setGuestDisplayName((current) => current || "Guest User");
        setGuestModalOpen(true);
      }
      return;
    }

    const autoJoinKey = `${loadState.data.meeting.id}:${props.session.actor.userId}`;
    if (joinState !== "idle" || autoJoinKeyRef.current === autoJoinKey) {
      return;
    }

    autoJoinKeyRef.current = autoJoinKey;
    const displayName = getSessionDisplayName(props.session);
    void submitJoin(displayName, props.session.sessionType);
  }, [joinState, loadState, props.isAuthLoading, props.session]);

  useEffect(() => {
    if (!meeting?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRoom();
    }, joinState === "lobby" ? 4_000 : 12_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [joinState, meeting?.id]);

  useEffect(() => {
    if (!meeting?.id || !REALTIME_BASE_URL) {
      return;
    }

    const meetingId = meeting.id;
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;

    function connect() {
      socket = new WebSocket(`${REALTIME_BASE_URL}/v1/rooms/${meetingId}`);
      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({ type: "snapshot.request" }));
      });
      socket.addEventListener("message", () => {
        void refreshRoom();
      });
      socket.addEventListener("close", () => {
        if (!closed) {
          reconnectTimeoutId = window.setTimeout(connect, 3_000);
        }
      });
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
      }
      socket?.close();
    };
  }, [meeting?.id]);

  useEffect(() => {
    if (!meeting?.id || !participantId) {
      return;
    }

    let leaveSent = false;

    const notifyLeave = () => {
      if (leaveSent) {
        return;
      }

      leaveSent = true;
      leaveMeetingParticipantInBackground(meeting.id, participantId, sessionRef.current);
    };

    window.addEventListener("pagehide", notifyLeave);

    return () => {
      window.removeEventListener("pagehide", notifyLeave);
      notifyLeave();
    };
  }, [meeting?.id, participantId]);

  async function submitJoin(displayName: string, sessionType: string) {
    if (loadState.status !== "ready" || !loadState.data.meeting) {
      return;
    }

    setJoinState("joining");
    setJoinMessage(null);

    const result = await joinMeeting(
      loadState.data.meeting.id,
      loadState.data.room.id,
      displayName,
      sessionType,
    );

    if (!result) {
      setJoinState("error");
      setJoinMessage("We could not join this meeting.");
      return;
    }

    setParticipantId(result.participantId ?? null);
    setGuestModalOpen(false);
    setJoinState(result.joinState);
    setJoinMessage(getJoinMessage(result.joinState, result.reason));
    await refreshRoom();
  }

  async function runAction(
    action: () => Promise<boolean>,
    successMessage: string,
    failureMessage: string,
  ) {
    setIsActionBusy(true);
    setActionMessage(null);

    const ok = await action();
    if (!ok) {
      setIsActionBusy(false);
      setActionMessage(failureMessage);
      return;
    }

    await refreshRoom();
    setIsActionBusy(false);
    setActionMessage(successMessage);
  }

  async function copyMeetingLink() {
    try {
      await navigator.clipboard.writeText(getMeetingShareUrl(props.meetingCode));
      setActionMessage("Meeting link copied.");
    } catch {
      setActionMessage("Copy failed. The room link is visible in the address bar.");
    }
  }

  async function handleStartMeetingNow() {
    if (!room) {
      return;
    }

    setIsActionBusy(true);
    setActionMessage(null);

    const nextMeeting = await createInstantMeeting({
      roomId: room.id,
      startsAt: new Date().toISOString(),
      title: `Meeting ${formatMeetingCodeLabel(props.meetingCode)}`,
    });

    if (!nextMeeting) {
      setIsActionBusy(false);
      setActionMessage("We could not start a meeting for this room.");
      return;
    }

    await refreshRoom();
    setIsActionBusy(false);
    setActionMessage("Meeting started.");
  }

  if (loadState.status === "loading") {
    return (
      <section className="page page--centered">
        <div className="status-card">
          <div className="eyebrow">Meeting</div>
          <h1 className="status-card__title">Opening room...</h1>
        </div>
      </section>
    );
  }

  if (loadState.status === "not-found") {
    return (
      <section className="page page--centered">
        <div className="status-card">
          <div className="eyebrow">Not Found</div>
          <h1 className="status-card__title">That meeting code does not exist.</h1>
          <button
            className="button button--primary"
            onClick={() => {
              props.onNavigate("/");
            }}
            type="button"
          >
            Back Home
          </button>
        </div>
      </section>
    );
  }

  if (loadState.status === "error") {
    return (
      <section className="page page--centered">
        <div className="status-card">
          <div className="eyebrow">Error</div>
          <h1 className="status-card__title">{loadState.message}</h1>
          <div className="stack-actions">
            <button
              className="button button--primary"
              onClick={() => {
                void refreshRoom();
              }}
              type="button"
            >
              Retry
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                props.onNavigate("/");
              }}
              type="button"
            >
              Back Home
            </button>
          </div>
        </div>
      </section>
    );
  }

  const activeParticipants = participants.filter((entry) => entry.presence === "active");
  const lobbyParticipants = participants.filter((entry) => entry.presence === "lobby");
  const canManageMeeting =
    Boolean(props.session?.authenticated) ||
    Boolean(currentParticipant && ["owner", "host", "co_host", "moderator", "presenter"].includes(currentParticipant.role)) ||
    Boolean(meeting?.hostUserId && meeting.hostUserId === props.session?.actor.userId);
  const participantDisplayName =
    currentParticipant?.displayName ??
    (props.session?.authenticated ? getSessionDisplayName(props.session) : guestDisplayName.trim() || "Guest User");
  const participantRole = currentParticipant?.role ?? props.session?.actor.workspaceRole ?? "participant";
  const shouldConnectMedia = joinState === "direct" && Boolean(currentParticipant && participantId);
  const chatDisabledReason = getChatDisabledReason({
    canManageMeeting,
    currentParticipant,
    joinState,
    roomChatMode: room?.policy?.chatMode ?? "open",
  });

  async function handleSendChatMessage(text: string): Promise<{ errorMessage?: string }> {
    if (!meeting?.id || !participantId || chatDisabledReason) {
      return { errorMessage: chatDisabledReason ?? "Join the room to send messages." };
    }

    const result = await sendChatMessage(meeting.id, participantId, text);
    if (!result) {
      return { errorMessage: "Message failed to send." };
    }

    setLoadState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      const nextEvents = [result as RoomEvent<ChatMessageEventPayload>, ...current.data.events.filter((event) => event.eventId !== result.eventId)];
      return {
        status: "ready",
        data: {
          ...current.data,
          events: nextEvents,
        },
      };
    });

    void refreshRoom();
    return {};
  }

  return (
    <>
      <section className={`page page--room${guestModalOpen ? " page--obscured" : ""}`}>
        <div className="meeting-room">
          <div className="stage-card">
            <div className="stage-card__header">
              <div>
                <div className="eyebrow">Meeting {formatMeetingCodeLabel(props.meetingCode)}</div>
                <h1 className="stage-card__title">{meeting?.title ?? room?.name ?? "Meeting room"}</h1>
              </div>
              <div className="status-pills">
                <span className="status-pill">{meeting?.status ?? "waiting"}</span>
                <span className="status-pill">{recording?.status ?? "idle"}</span>
                <span className="status-pill">{joinState === "idle" ? "not joined" : joinState}</span>
              </div>
            </div>

            <MeetingMediaStage
              activeParticipants={activeParticipants}
              meetingActive={Boolean(meeting)}
              meetingId={meeting?.id ?? null}
              participantDisplayName={participantDisplayName}
              participantId={participantId}
              participantRole={participantRole}
              shouldConnect={shouldConnectMedia}
            />

            <div className="stage-card__footer">
              <button
                className="button button--secondary"
                onClick={() => {
                  void copyMeetingLink();
                }}
                type="button"
              >
                Copy Link
              </button>
              <button
                className="button button--ghost"
                onClick={() => {
                  void refreshRoom();
                }}
                type="button"
              >
                Refresh
              </button>
              {!props.session?.authenticated ? (
                <button
                  className="button button--ghost"
                  onClick={() => {
                    startLogin(window.location.pathname);
                  }}
                  type="button"
                >
                  Sign In
                </button>
              ) : null}
            </div>
          </div>

          <aside className="side-rail">
            <section className="panel-card">
              <div className="panel-card__header">
                <div>
                  <div className="eyebrow">Room Status</div>
                  <h2 className="panel-card__title">Session</h2>
                </div>
              </div>
              <div className="detail-grid detail-grid--compact">
                <Detail label="Code" value={formatMeetingCodeLabel(props.meetingCode)} />
                <Detail label="Identity" value={props.session?.authenticated ? getSessionDisplayName(props.session) : "Guest"} />
                <Detail label="Joined" value={joinState} />
                <Detail label="Recording" value={recording?.status ?? "idle"} />
              </div>
              {joinMessage ? <p className="inline-feedback">{joinMessage}</p> : null}
              {actionMessage ? <p className="inline-feedback">{actionMessage}</p> : null}
              {serviceMessage ? <p className="inline-feedback inline-feedback--warning">{serviceMessage}</p> : null}
            </section>

            <section className="panel-card panel-card--scroll">
              <div className="panel-card__header">
                <div>
                  <div className="eyebrow">People</div>
                  <h2 className="panel-card__title">
                    {activeParticipants.length} active · {lobbyParticipants.length} lobby
                  </h2>
                </div>
              </div>

              <div className="people-list">
                {activeParticipants.map((participant) => (
                  <ParticipantRow
                    key={participant.participantId}
                    onAdmit={null}
                    onRemove={
                      meeting && canManageMeeting
                        ? () => {
                            void runAction(
                              () => removeParticipant(meeting.id, participant.participantId),
                              `${participant.displayName} removed.`,
                              "Remove failed.",
                            );
                          }
                        : null
                    }
                    participant={participant}
                  />
                ))}
                {lobbyParticipants.map((participant) => (
                  <ParticipantRow
                    key={participant.participantId}
                    onAdmit={
                      meeting && canManageMeeting
                        ? () => {
                            void runAction(
                              () => admitParticipant(meeting.id, participant.participantId),
                              `${participant.displayName} admitted.`,
                              "Admit failed.",
                            );
                          }
                        : null
                    }
                    onRemove={
                      meeting && canManageMeeting
                        ? () => {
                            void runAction(
                              () => removeParticipant(meeting.id, participant.participantId),
                              `${participant.displayName} removed.`,
                              "Remove failed.",
                            );
                          }
                        : null
                    }
                    participant={participant}
                  />
                ))}
                {!activeParticipants.length && !lobbyParticipants.length ? (
                  <div className="empty-list">No participants yet.</div>
                ) : null}
              </div>
            </section>

            {meeting && canManageMeeting ? (
              <section className="panel-card">
                <div className="panel-card__header">
                  <div>
                    <div className="eyebrow">Controls</div>
                    <h2 className="panel-card__title">Host tools</h2>
                  </div>
                </div>
                <div className="host-actions">
                  <button
                    className="button button--secondary"
                    disabled={isActionBusy}
                    onClick={() => {
                      void runAction(
                        () => muteAllParticipants(meeting.id),
                        "Everyone in the room was muted.",
                        "Mute all failed.",
                      );
                    }}
                    type="button"
                  >
                    Mute All
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={isActionBusy}
                    onClick={() => {
                      void runAction(
                        () => (meeting.isLocked ? unlockMeeting(meeting.id) : lockMeeting(meeting.id)),
                        meeting.isLocked ? "Meeting unlocked." : "Meeting locked.",
                        "Lock update failed.",
                      );
                    }}
                    type="button"
                  >
                    {meeting.isLocked ? "Unlock" : "Lock"}
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={isActionBusy}
                    onClick={() => {
                      void runAction(
                        () =>
                          recording?.status === "recording"
                            ? stopRecording(meeting.id)
                            : startRecording(meeting.id),
                        recording?.status === "recording" ? "Recording stopped." : "Recording started.",
                        "Recording update failed.",
                      );
                    }}
                    type="button"
                  >
                    {recording?.status === "recording" ? "Stop Recording" : "Start Recording"}
                  </button>
                  <button
                    className="button button--danger"
                    disabled={isActionBusy}
                    onClick={() => {
                      void runAction(
                        () => endMeeting(meeting.id),
                        "Meeting ended.",
                        "End meeting failed.",
                      );
                    }}
                    type="button"
                  >
                    End Meeting
                  </button>
                </div>
              </section>
            ) : null}

            {!meeting && props.session?.authenticated ? (
              <section className="panel-card">
                <div className="panel-card__header">
                  <div>
                    <div className="eyebrow">No Active Session</div>
                    <h2 className="panel-card__title">Start this room</h2>
                  </div>
                </div>
                <button
                  className="button button--primary"
                  disabled={isActionBusy}
                  onClick={() => {
                    void handleStartMeetingNow();
                  }}
                  type="button"
                >
                  Start Meeting Now
                </button>
              </section>
            ) : null}

            <MeetingConversationPanel
              currentParticipantId={participantId}
              disabledReason={chatDisabledReason}
              events={events}
              onSendMessage={handleSendChatMessage}
            />
          </aside>
        </div>
      </section>

      <Modal
        description="Enter the name other people should see before you join."
        onClose={() => {
          setGuestModalOpen(false);
          props.onNavigate("/");
        }}
        open={guestModalOpen}
        title="Join as a guest"
      >
        <label className="field">
          <span className="field__label">Display name</span>
          <input
            autoFocus
            className="field__input"
            onChange={(event) => {
              setGuestDisplayName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && guestDisplayName.trim()) {
                void submitJoin(guestDisplayName.trim(), "guest");
              }
            }}
            placeholder="Your name"
            value={guestDisplayName}
          />
        </label>
        <div className="stack-actions stack-actions--inline">
          <button
            className="button button--primary"
            disabled={!guestDisplayName.trim() || joinState === "joining"}
            onClick={() => {
              void submitJoin(guestDisplayName.trim(), "guest");
            }}
            type="button"
          >
            {joinState === "joining" ? "Joining..." : "Enter Room"}
          </button>
          <button
            className="button button--ghost"
            onClick={() => {
              startLogin(window.location.pathname);
            }}
            type="button"
          >
            Sign In Instead
          </button>
        </div>
      </Modal>
    </>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <span className="detail-card__label">{props.label}</span>
      <strong className="detail-card__value">{props.value}</strong>
    </div>
  );
}

function ParticipantRow(props: {
  onAdmit: (() => void) | null;
  onRemove: (() => void) | null;
  participant: ParticipantState;
}) {
  return (
    <article className="people-row">
      <div>
        <strong>{props.participant.displayName}</strong>
        <div className="people-row__meta">
          {props.participant.presence} · {props.participant.audio} audio · {props.participant.video} video
        </div>
      </div>
      <div className="people-row__actions">
        {props.onAdmit ? (
          <button className="chip-button" onClick={props.onAdmit} type="button">
            Admit
          </button>
        ) : null}
        {props.onRemove ? (
          <button className="chip-button chip-button--danger" onClick={props.onRemove} type="button">
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

function getJoinMessage(
  joinState: "direct" | "lobby" | "blocked",
  reason?: "room_locked" | "guest_join_disabled",
): string {
  if (joinState === "direct") {
    return "You are in the meeting.";
  }

  if (joinState === "lobby") {
    return "You are waiting in the lobby for a host to admit you.";
  }

  if (reason === "room_locked") {
    return "This meeting is locked.";
  }

  if (reason === "guest_join_disabled") {
    return "Guest access is disabled for this room.";
  }

  return "You cannot join this meeting right now.";
}

function getChatDisabledReason(input: {
  canManageMeeting: boolean;
  currentParticipant: ParticipantState | null;
  joinState: JoinUiState;
  roomChatMode: "open" | "host_only" | "moderated" | "disabled";
}): string | null {
  if (!input.currentParticipant || input.joinState !== "direct") {
    return "Join the room to send messages.";
  }

  if (input.roomChatMode === "disabled") {
    return "Chat is disabled for this room.";
  }

  if (input.roomChatMode === "host_only" && !input.canManageMeeting) {
    return "Chat is limited to hosts in this room.";
  }

  return null;
}
