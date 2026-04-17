import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  AuthCapabilities,
  ChatMessageEventPayload,
  ParticipantState,
  RoomEvent,
  SessionInfo,
} from "@opsui/shared-types";
import { MeetingConversationPanel } from "../components/MeetingConversationPanel";
import { MeetingControlButton } from "../components/MeetingControlButton";
import { MeetingInfoPanel } from "../components/MeetingInfoPanel";
import { MeetingMediaStage } from "../components/MeetingMediaStage";
import {
  type ParticipantMediaIndicators,
  MeetingParticipantsPanel,
} from "../components/MeetingParticipantsPanel";
import { ChatBubbleIcon, InformationCircleIcon, ParticipantsIcon } from "../components/MeetingRoomIcons";
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
  touchMeetingParticipantSession,
  unlockMeeting,
} from "../lib/commands";
import { REALTIME_BASE_URL } from "../lib/config";
import { rotateJoinSessionId } from "../lib/join-session";
import { formatMeetingCodeLabel } from "../lib/meeting-code";
import { getMeetingShareUrl, loadMeetingRoomData, type MeetingRoomData } from "../lib/meetings";

interface MeetingRoomPageProps {
  authCapabilities: AuthCapabilities | null;
  isAuthLoading: boolean;
  meetingCode: string;
  onNavigate(pathname: string, options?: { replace?: boolean }): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { message: string; status: "error" }
  | { data: MeetingRoomData; status: "ready" };

type JoinUiState = "idle" | "joining" | "direct" | "lobby" | "blocked" | "error";
type ActiveDrawer = "chat" | "info" | "participants" | null;
const DRAWER_SWITCH_DELAY_MS = 220;
const HEARTBEAT_INTERVAL_MS = 15_000;
const REALTIME_PING_INTERVAL_MS = 20_000;
const REALTIME_RECONNECT_MAX_DELAY_MS = 10_000;
const ROOM_REFRESH_DEBOUNCE_MS = 250;
const ROOM_REFRESH_WARNING_GRACE_MS = 15_000;

export function MeetingRoomPage(props: MeetingRoomPageProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const [joinState, setJoinState] = useState<JoinUiState>("idle");
  const [guestDisplayName, setGuestDisplayName] = useState("");
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [liveStageParticipantCount, setLiveStageParticipantCount] = useState<number | null>(null);
  const [liveMediaByParticipantId, setLiveMediaByParticipantId] = useState<Record<string, ParticipantMediaIndicators>>(
    {},
  );
  const activeMeetingSessionRef = useRef<{ meetingId: string; participantId: string } | null>(null);
  const autoJoinKeyRef = useRef<string | null>(null);
  const drawerSwitchTimeoutRef = useRef<number | null>(null);
  const lastLeaveRequestKeyRef = useRef<string | null>(null);
  const meetingCodeRef = useRef(props.meetingCode);
  const meetingScopeRef = useRef(0);
  const roomRefreshFailureCountRef = useRef(0);
  const roomRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const roomRefreshQueuedRef = useRef(false);
  const roomRefreshTimeoutRef = useRef<number | null>(null);
  const lastSuccessfulRoomRefreshAtRef = useRef(0);
  const sessionRef = useRef(props.session);
  const suppressGuestPromptRef = useRef(false);

  useEffect(() => {
    sessionRef.current = props.session;
  }, [props.session]);

  useEffect(() => {
    return () => {
      if (drawerSwitchTimeoutRef.current) {
        window.clearTimeout(drawerSwitchTimeoutRef.current);
      }
      if (roomRefreshTimeoutRef.current) {
        window.clearTimeout(roomRefreshTimeoutRef.current);
      }
    };
  }, []);

  function isActiveMeetingScope(scopeId: number): boolean {
    return meetingScopeRef.current === scopeId;
  }

  const leaveActiveMeetingSession = useEffectEvent((options?: { rotateJoinSession?: boolean }) => {
    if (options?.rotateJoinSession) {
      rotateJoinSessionId();
    }

    const activeSession = activeMeetingSessionRef.current;
    if (!activeSession) {
      return;
    }

    const sessionKey = `${activeSession.meetingId}:${activeSession.participantId}`;
    if (lastLeaveRequestKeyRef.current === sessionKey) {
      return;
    }
    lastLeaveRequestKeyRef.current = sessionKey;
    leaveMeetingParticipantInBackground(activeSession.meetingId, activeSession.participantId, sessionRef.current);
  });

  const invalidateMeetingScope = useEffectEvent(() => {
    meetingScopeRef.current += 1;
    roomRefreshFailureCountRef.current = 0;
    roomRefreshPromiseRef.current = null;
    roomRefreshQueuedRef.current = false;
    lastSuccessfulRoomRefreshAtRef.current = 0;

    if (roomRefreshTimeoutRef.current) {
      window.clearTimeout(roomRefreshTimeoutRef.current);
      roomRefreshTimeoutRef.current = null;
    }
  });

  const resetMeetingSessionState = useEffectEvent((options?: { clearGuestDisplayName?: boolean }) => {
    closeDrawers();
    setJoinState("idle");
    setJoinMessage(null);
    setActionMessage(null);
    setServiceMessage(null);
    setParticipantId(null);
    setLiveStageParticipantCount(null);
    setLiveMediaByParticipantId({});
    setGuestModalOpen(false);
    activeMeetingSessionRef.current = null;
    autoJoinKeyRef.current = null;
    lastLeaveRequestKeyRef.current = null;

    if (options?.clearGuestDisplayName) {
      setGuestDisplayName("");
    }
  });

  const exitMeetingToHome = useEffectEvent(() => {
    suppressGuestPromptRef.current = true;
    leaveActiveMeetingSession({ rotateJoinSession: true });
    invalidateMeetingScope();
    resetMeetingSessionState({ clearGuestDisplayName: true });
    props.onNavigate("/", { replace: true });
  });

  const performRoomRefresh = useEffectEvent(async (scopeId = meetingScopeRef.current) => {
    try {
      const nextData = await loadMeetingRoomData(props.meetingCode);
      if (!isActiveMeetingScope(scopeId)) {
        return;
      }

      roomRefreshFailureCountRef.current = 0;
      lastSuccessfulRoomRefreshAtRef.current = Date.now();

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
      if (!isActiveMeetingScope(scopeId)) {
        return;
      }

      roomRefreshFailureCountRef.current += 1;
      setLoadState((current) => {
        if (current.status === "ready") {
          return current;
        }

        return {
          message: "Meeting services are temporarily unavailable. Please retry in a moment.",
          status: "error",
        };
      });
      if (
        roomRefreshFailureCountRef.current >= 2 ||
        Date.now() - lastSuccessfulRoomRefreshAtRef.current >= ROOM_REFRESH_WARNING_GRACE_MS
      ) {
        setServiceMessage("Connection to meeting services was interrupted. Retrying in the background.");
      }
    }
  });

  const flushRoomRefresh = useEffectEvent(async (scopeId = meetingScopeRef.current) => {
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    if (roomRefreshPromiseRef.current) {
      roomRefreshQueuedRef.current = true;
      return roomRefreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      do {
        roomRefreshQueuedRef.current = false;
        await performRoomRefresh(scopeId);
      } while (roomRefreshQueuedRef.current && isActiveMeetingScope(scopeId));
    })();

    roomRefreshPromiseRef.current = refreshPromise;
    return refreshPromise.finally(() => {
      if (roomRefreshPromiseRef.current === refreshPromise) {
        roomRefreshPromiseRef.current = null;
      }
    });
  });

  const scheduleRoomRefresh = useEffectEvent((options?: { delayMs?: number; immediate?: boolean; scopeId?: number }) => {
    const scopeId = options?.scopeId ?? meetingScopeRef.current;
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    roomRefreshQueuedRef.current = true;

    if (options?.immediate) {
      if (roomRefreshTimeoutRef.current) {
        window.clearTimeout(roomRefreshTimeoutRef.current);
        roomRefreshTimeoutRef.current = null;
      }
      void flushRoomRefresh(scopeId);
      return;
    }

    if (roomRefreshTimeoutRef.current) {
      return;
    }

    roomRefreshTimeoutRef.current = window.setTimeout(() => {
      roomRefreshTimeoutRef.current = null;
      void flushRoomRefresh(scopeId);
    }, options?.delayMs ?? ROOM_REFRESH_DEBOUNCE_MS);
  });

  useEffect(() => {
    const previousMeetingCode = meetingCodeRef.current;
    meetingCodeRef.current = props.meetingCode;
    if (previousMeetingCode !== props.meetingCode) {
      leaveActiveMeetingSession({ rotateJoinSession: true });
    }

    invalidateMeetingScope();
    const scopeId = meetingScopeRef.current;
    suppressGuestPromptRef.current = false;
    autoJoinKeyRef.current = null;
    setJoinState("idle");
    setActiveDrawer(null);
    setJoinMessage(null);
    setActionMessage(null);
    setServiceMessage(null);
    setParticipantId(null);
    setLiveStageParticipantCount(null);
    setLiveMediaByParticipantId({});
    setGuestModalOpen(false);
    setLoadState({ status: "loading" });

    void flushRoomRefresh(scopeId);
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
    if (suppressGuestPromptRef.current) {
      return;
    }

    if (!participantId || !currentParticipant) {
      return;
    }

    if (currentParticipant.presence === "left") {
      setParticipantId(null);
      setJoinState("idle");
      setJoinMessage("You are no longer in this meeting.");
      return;
    }

    if (currentParticipant.presence === "reconnecting") {
      setServiceMessage((current) => current ?? "Connection to meeting services was interrupted. Reconnecting...");
      return;
    }

    if (joinState === "lobby" && currentParticipant.presence === "active") {
      setJoinState("direct");
      setJoinMessage("You were admitted to the room.");
    }
  }, [currentParticipant, joinState, participantId]);

  useEffect(() => {
    if (!meeting?.id || !participantId) {
      activeMeetingSessionRef.current = null;
      return;
    }

    activeMeetingSessionRef.current = {
      meetingId: meeting.id,
      participantId,
    };
  }, [meeting?.id, participantId]);

  const heartbeatMeetingSession = useEffectEvent(async (scopeId = meetingScopeRef.current) => {
    if (!meeting?.id || !participantId || (joinState !== "direct" && joinState !== "lobby")) {
      return;
    }

    const participant = await touchMeetingParticipantSession(meeting.id, participantId);
    if (!isActiveMeetingScope(scopeId) || !participant) {
      return;
    }

    if (participant.presence === "left") {
      setParticipantId(null);
      setJoinState("idle");
      setJoinMessage("Meeting connection expired. Rejoining...");
    }
  });

  useEffect(() => {
    if (suppressGuestPromptRef.current) {
      return;
    }

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
      scheduleRoomRefresh({ immediate: true });
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
    let pingIntervalId: number | null = null;
    let reconnectAttempt = 0;

    const clearPingInterval = () => {
      if (pingIntervalId) {
        window.clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
    };

    function connect() {
      socket = new WebSocket(`${REALTIME_BASE_URL}/v1/rooms/${meetingId}`);
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        clearPingInterval();
        pingIntervalId = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, REALTIME_PING_INTERVAL_MS);
        socket?.send(JSON.stringify({ type: "snapshot.request" }));
        const scopeId = meetingScopeRef.current;
        void heartbeatMeetingSession(scopeId).finally(() => {
          scheduleRoomRefresh({ immediate: true, scopeId });
        });
      });
      socket.addEventListener("message", (event) => {
        if (parseRealtimeMessageType(event.data) === "pong") {
          return;
        }

        scheduleRoomRefresh();
      });
      socket.addEventListener("error", () => {
        socket?.close();
      });
      socket.addEventListener("close", () => {
        clearPingInterval();
        socket = null;
        if (!closed) {
          const reconnectDelay = Math.min(
            1_000 * Math.max(1, 2 ** reconnectAttempt),
            REALTIME_RECONNECT_MAX_DELAY_MS,
          );
          reconnectAttempt += 1;
          reconnectTimeoutId = window.setTimeout(connect, reconnectDelay);
        }
      });
    }

    const resumeRealtime = () => {
      if (closed) {
        return;
      }

      const scopeId = meetingScopeRef.current;
      if (document.visibilityState !== "hidden") {
        void heartbeatMeetingSession(scopeId).finally(() => {
          scheduleRoomRefresh({ immediate: true, scopeId });
        });
      }

      if (!socket || socket.readyState === WebSocket.CLOSED) {
        if (reconnectTimeoutId) {
          window.clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = null;
        }
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", resumeRealtime);
    window.addEventListener("focus", resumeRealtime);
    window.addEventListener("online", resumeRealtime);

    return () => {
      closed = true;
      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
      }
      clearPingInterval();
      document.removeEventListener("visibilitychange", resumeRealtime);
      window.removeEventListener("focus", resumeRealtime);
      window.removeEventListener("online", resumeRealtime);
      socket?.close();
    };
  }, [meeting?.id]);

  useEffect(() => {
    const resumeMeetingSession = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const scopeId = meetingScopeRef.current;
      void heartbeatMeetingSession(scopeId).finally(() => {
        scheduleRoomRefresh({ immediate: true, scopeId });
      });
    };

    document.addEventListener("visibilitychange", resumeMeetingSession);
    window.addEventListener("focus", resumeMeetingSession);
    window.addEventListener("online", resumeMeetingSession);

    return () => {
      document.removeEventListener("visibilitychange", resumeMeetingSession);
      window.removeEventListener("focus", resumeMeetingSession);
      window.removeEventListener("online", resumeMeetingSession);
    };
  }, []);

  useEffect(() => {
    if (!meeting?.id || !participantId || (joinState !== "direct" && joinState !== "lobby")) {
      return;
    }

    const scopeId = meetingScopeRef.current;
    void heartbeatMeetingSession(scopeId);
    const intervalId = window.setInterval(() => {
      void heartbeatMeetingSession(scopeId);
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [joinState, meeting?.id, participantId]);

  async function submitJoin(displayName: string, sessionType: string) {
    if (loadState.status !== "ready" || !loadState.data.meeting) {
      return;
    }

    const scopeId = meetingScopeRef.current;
    const meetingId = loadState.data.meeting.id;
    const roomId = loadState.data.room.id;

    setJoinState("joining");
    setJoinMessage(null);

    const result = await joinMeeting(
      meetingId,
      roomId,
      displayName,
      sessionType,
    );
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    if (!result) {
      setJoinState("error");
      setJoinMessage("We could not join this meeting.");
      return;
    }

    setParticipantId(result.participantId ?? null);
    setGuestModalOpen(false);
    setJoinState(result.joinState);
    setJoinMessage(getJoinMessage(result.joinState, result.reason));
    await flushRoomRefresh(scopeId);
  }

  async function runAction(
    action: () => Promise<boolean>,
    successMessage: string,
    failureMessage: string,
  ) {
    const scopeId = meetingScopeRef.current;
    setIsActionBusy(true);
    setActionMessage(null);

    const ok = await action();
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    if (!ok) {
      setIsActionBusy(false);
      setActionMessage(failureMessage);
      return;
    }

    await flushRoomRefresh(scopeId);
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

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

    const scopeId = meetingScopeRef.current;
    setIsActionBusy(true);
    setActionMessage(null);

    const nextMeeting = await createInstantMeeting({
      roomId: room.id,
      startsAt: new Date().toISOString(),
      title: `Meeting ${formatMeetingCodeLabel(props.meetingCode)}`,
    });
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    if (!nextMeeting) {
      setIsActionBusy(false);
      setActionMessage("We could not start a meeting for this room.");
      return;
    }

    await flushRoomRefresh(scopeId);
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    setIsActionBusy(false);
    setActionMessage("Meeting started.");
  }

  function toggleDrawer(nextDrawer: Exclude<ActiveDrawer, null>) {
    if (drawerSwitchTimeoutRef.current) {
      window.clearTimeout(drawerSwitchTimeoutRef.current);
      drawerSwitchTimeoutRef.current = null;
    }

    if (activeDrawer === nextDrawer) {
      setActiveDrawer(null);
      return;
    }

    if (activeDrawer && activeDrawer !== nextDrawer) {
      setActiveDrawer(null);
      drawerSwitchTimeoutRef.current = window.setTimeout(() => {
        setActiveDrawer(nextDrawer);
        drawerSwitchTimeoutRef.current = null;
      }, DRAWER_SWITCH_DELAY_MS);
      return;
    }

    setActiveDrawer(nextDrawer);
  }

  function closeDrawers() {
    if (drawerSwitchTimeoutRef.current) {
      window.clearTimeout(drawerSwitchTimeoutRef.current);
      drawerSwitchTimeoutRef.current = null;
    }
    setActiveDrawer(null);
  }

  function leaveRoom() {
    exitMeetingToHome();
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
                scheduleRoomRefresh({ immediate: true });
              }}
              type="button"
            >
              Retry
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                exitMeetingToHome();
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

  const activeParticipants = participants.filter((entry) => isInMeetingPresence(entry.presence));
  const lobbyParticipants = participants.filter((entry) => entry.presence === "lobby");
  const canManageMeeting =
    Boolean(props.session?.authenticated) ||
    Boolean(
      currentParticipant &&
        ["owner", "host", "co_host", "moderator", "presenter"].includes(currentParticipant.role),
    ) ||
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
  const screenShareDisabledReason = getScreenShareDisabledReason({
    canManageMeeting,
    currentParticipant,
    joinState,
    roomScreenShareMode: room?.policy?.screenShareMode ?? "presenters",
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

      const nextEvents = [
        result as RoomEvent<ChatMessageEventPayload>,
        ...current.data.events.filter((event) => event.eventId !== result.eventId),
      ];

      return {
        status: "ready",
        data: {
          ...current.data,
          events: nextEvents,
        },
      };
    });

    scheduleRoomRefresh({ immediate: true });
    return {};
  }

  const identityLabel = props.session?.authenticated ? getSessionDisplayName(props.session) : participantDisplayName;
  const isChatOpen = activeDrawer === "chat";
  const isInfoOpen = activeDrawer === "info";
  const isParticipantsOpen = activeDrawer === "participants";
  const effectiveStageParticipantCount = liveStageParticipantCount ?? activeParticipants.length;
  const immersiveSoloMode = joinState === "direct" && effectiveStageParticipantCount === 1;
  const stageMessages = [
    serviceMessage
      ? { kind: "warning" as const, text: serviceMessage }
      : null,
    joinState !== "direct" && joinMessage
      ? { kind: "default" as const, text: joinMessage }
      : null,
    actionMessage
      ? { kind: "default" as const, text: actionMessage }
      : null,
  ].filter((value): value is { kind: "default" | "warning"; text: string } => Boolean(value));

  return (
    <>
      <section className={`page page--room${guestModalOpen ? " page--obscured" : ""}`}>
        <div
          className={[
            "meeting-room-shell",
            isChatOpen ? " meeting-room-shell--chat-open" : "",
            isInfoOpen ? " meeting-room-shell--info-open" : "",
            isParticipantsOpen ? " meeting-room-shell--participants-open" : "",
          ].join("")}
        >
          <button
            aria-label="Close drawer"
            className={`meeting-room-shell__scrim${activeDrawer ? " is-visible" : ""}`}
            onClick={closeDrawers}
            type="button"
          />

          <aside
            aria-hidden={!isChatOpen}
            className={`meeting-room-drawer meeting-room-drawer--chat${isChatOpen ? " is-open" : ""}`}
          >
            <MeetingConversationPanel
              currentParticipantId={participantId}
              disabledReason={chatDisabledReason}
              events={events}
              onClose={closeDrawers}
              onSendMessage={handleSendChatMessage}
            />
          </aside>

          <aside
            aria-hidden={!isParticipantsOpen}
            className={`meeting-room-drawer meeting-room-drawer--participants${isParticipantsOpen ? " is-open" : ""}`}
          >
            <MeetingParticipantsPanel
              activeParticipants={activeParticipants}
              canManageMeeting={canManageMeeting}
              currentParticipantId={participantId}
              lobbyParticipants={lobbyParticipants}
              mediaByParticipantId={liveMediaByParticipantId}
              onAdmitParticipant={(nextParticipantId) => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => admitParticipant(meeting.id, nextParticipantId),
                  "Participant admitted.",
                  "Admit failed.",
                );
              }}
              onClose={closeDrawers}
              onRemoveParticipant={(nextParticipantId) => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => removeParticipant(meeting.id, nextParticipantId),
                  "Participant removed.",
                  "Remove failed.",
                );
              }}
            />
          </aside>

          <div className="meeting-room-stage-layout">
            <section
              className={`meeting-room-stage-surface${immersiveSoloMode ? " meeting-room-stage-surface--immersive" : ""}`}
            >
              <MeetingMediaStage
                activeParticipants={activeParticipants}
                extraControls={
                  <>
                    <MeetingControlButton
                      active={isChatOpen}
                      icon={<ChatBubbleIcon />}
                      label="Chat"
                      onClick={() => {
                        toggleDrawer("chat");
                      }}
                    />
                    <MeetingControlButton
                      active={isParticipantsOpen}
                      icon={<ParticipantsIcon />}
                      label="Participants"
                      onClick={() => {
                        toggleDrawer("participants");
                      }}
                    />
                    <MeetingControlButton
                      active={isInfoOpen}
                      icon={<InformationCircleIcon />}
                      label="Info"
                      onClick={() => {
                        toggleDrawer("info");
                      }}
                    />
                  </>
                }
                meetingActive={Boolean(meeting)}
                meetingId={meeting?.id ?? null}
                immersiveSoloMode={immersiveSoloMode}
                onLeave={leaveRoom}
                onLiveMediaStateChange={setLiveMediaByParticipantId}
                onLiveParticipantCountChange={setLiveStageParticipantCount}
                participantDisplayName={participantDisplayName}
                participantId={participantId}
                participantRole={participantRole}
                screenShareDisabledReason={screenShareDisabledReason}
                stageMessages={stageMessages}
                shouldConnect={shouldConnectMedia}
              />
            </section>
          </div>

          <aside
            aria-hidden={!isInfoOpen}
            className={`meeting-room-drawer meeting-room-drawer--info${isInfoOpen ? " is-open" : ""}`}
          >
            <MeetingInfoPanel
              actionMessage={actionMessage}
              activeParticipants={activeParticipants}
              canManageMeeting={canManageMeeting}
              identityLabel={identityLabel}
              isActionBusy={isActionBusy}
              joinMessage={joinMessage}
              joinState={joinState}
              lobbyParticipants={lobbyParticipants}
              meeting={meeting}
              meetingCode={props.meetingCode}
              onAdmitParticipant={(nextParticipantId) => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => admitParticipant(meeting.id, nextParticipantId),
                  "Participant admitted.",
                  "Admit failed.",
                );
              }}
              onClose={closeDrawers}
              onCopyLink={() => {
                void copyMeetingLink();
              }}
              onEndMeeting={() => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => endMeeting(meeting.id),
                  "Meeting ended.",
                  "End meeting failed.",
                );
              }}
              onRefresh={() => {
                scheduleRoomRefresh({ immediate: true });
              }}
              onRemoveParticipant={(nextParticipantId) => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => removeParticipant(meeting.id, nextParticipantId),
                  "Participant removed.",
                  "Remove failed.",
                );
              }}
              onSignIn={() => {
                startLogin(window.location.pathname);
              }}
              onStartMeetingNow={() => {
                void handleStartMeetingNow();
              }}
              onToggleLock={() => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => (meeting.isLocked ? unlockMeeting(meeting.id) : lockMeeting(meeting.id)),
                  meeting.isLocked ? "Meeting unlocked." : "Meeting locked.",
                  "Lock update failed.",
                );
              }}
              onToggleMuteAll={() => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () => muteAllParticipants(meeting.id),
                  "Everyone in the room was muted.",
                  "Mute all failed.",
                );
              }}
              onToggleRecording={() => {
                if (!meeting) {
                  return;
                }

                void runAction(
                  () =>
                    recording?.status === "recording"
                      ? stopRecording(meeting.id)
                      : startRecording(meeting.id),
                  recording?.status === "recording" ? "Recording stopped." : "Recording started.",
                  "Recording update failed.",
                );
              }}
              recording={recording}
              serviceMessage={serviceMessage}
              sessionAuthenticated={Boolean(props.session?.authenticated)}
              showStartMeetingAction={!meeting && Boolean(props.session?.authenticated)}
            />
          </aside>
        </div>
      </section>

      <Modal
        description="Enter the name other people should see before you join."
        onClose={() => {
          exitMeetingToHome();
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

function parseRealtimeMessageType(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string };
    return typeof parsed.type === "string" ? parsed.type : null;
  } catch {
    return null;
  }
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

function isInMeetingPresence(
  presence: ParticipantState["presence"],
): boolean {
  return presence === "active" || presence === "reconnecting";
}

function getScreenShareDisabledReason(input: {
  canManageMeeting: boolean;
  currentParticipant: ParticipantState | null;
  joinState: JoinUiState;
  roomScreenShareMode: "hosts_only" | "presenters" | "everyone";
}): string | null {
  if (!input.currentParticipant || input.joinState !== "direct") {
    return "Join the room to share your screen.";
  }

  const role = input.currentParticipant.role;
  const hostRoles = new Set(["owner", "host", "co_host", "moderator"]);
  const presenterRoles = new Set([...hostRoles, "presenter"]);

  if (input.roomScreenShareMode === "everyone") {
    return null;
  }

  if (input.roomScreenShareMode === "presenters" && !input.canManageMeeting && !presenterRoles.has(role)) {
    return "Screen sharing is limited to presenters in this room.";
  }

  if (input.roomScreenShareMode === "hosts_only" && !input.canManageMeeting && !hostRoles.has(role)) {
    return "Screen sharing is limited to hosts in this room.";
  }

  return null;
}
