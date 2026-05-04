import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  AuthCapabilities,
  ChatMessageEventPayload,
  ParticipantState,
  RealtimeRoomSnapshot,
  RealtimeWhiteboardState,
  RoomEvent,
  SessionInfo,
  WhiteboardHistoryAction,
  WhiteboardStroke,
  WhiteboardTextBox,
  WhiteboardTextBoxHistoryAction,
} from "@opsui/shared-types";
import { MeetingConversationPanel } from "../components/MeetingConversationPanel";
import { MeetingControlButton } from "../components/MeetingControlButton";
import { MeetingInfoPanel, type LocalRecordingControlState } from "../components/MeetingInfoPanel";
import { MeetingJoinLoader } from "../components/MeetingJoinLoader";
import { MeetingMediaStage, type MediaConnectionPhase, type StageViewMode } from "../components/MeetingMediaStage";
import { MeetingToolsLauncher } from "../components/MeetingToolsLauncher";
import { MeetingWhiteboardStage } from "../components/MeetingWhiteboardStage";
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
import {
  type CapturedRecording,
  isLocalScreenRecordingSupported,
  startLocalScreenRecording,
  type LocalScreenRecordingSession,
  uploadMeetingRecording,
} from "../lib/local-recordings";
import { formatMeetingCodeLabel } from "../lib/meeting-code";
import { getMeetingShareUrl, loadMeetingRoomData, type MeetingRoomData } from "../lib/meetings";
import {
  TEST_ROOM_DUMMY_USER_DEFAULT,
  TEST_ROOM_DUMMY_USER_MAX,
  createTestRoomDummyParticipants,
  isTestRoomCode,
} from "../lib/test-room";

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
type ActiveMeetingTool = "whiteboard" | null;
type RealtimeSocketStatus = "unavailable" | "connecting" | "connected" | "disconnected";
const DRAWER_SWITCH_DELAY_MS = 220;
const HEARTBEAT_INTERVAL_MS = 15_000;
const REALTIME_PING_INTERVAL_MS = 20_000;
const REALTIME_RECONNECT_MAX_DELAY_MS = 10_000;
const ROOM_REFRESH_DEBOUNCE_MS = 250;
const ROOM_REFRESH_WARNING_GRACE_MS = 15_000;
const MEETING_SESSION_RECOVERY_MAX_ATTEMPTS = 6;
const MEETING_SESSION_RECOVERY_RETRY_MS = 3_000;
const MEETING_SERVICE_WARNING_GRACE_MS = MEETING_SESSION_RECOVERY_RETRY_MS + 1_000;
const MEETING_SERVICE_RECONNECTING_MESSAGE = "Connection to meeting services was interrupted. Reconnecting...";
const MEETING_SERVICE_RETRYING_MESSAGE =
  "Connection to meeting services was interrupted. Retrying in the background.";

function isMeetingServiceInterruption(message: string | null): boolean {
  return message === MEETING_SERVICE_RECONNECTING_MESSAGE || message === MEETING_SERVICE_RETRYING_MESSAGE;
}

function clearMeetingServiceReconnectingMessage(message: string | null): string | null {
  return message === MEETING_SERVICE_RECONNECTING_MESSAGE ? null : message;
}

function clearMeetingRefreshRetryMessage(message: string | null): string | null {
  return message === MEETING_SERVICE_RETRYING_MESSAGE ? null : message;
}

export function MeetingRoomPage(props: MeetingRoomPageProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const [joinState, setJoinState] = useState<JoinUiState>("idle");
  const [mediaConnectionPhase, setMediaConnectionPhase] = useState<MediaConnectionPhase>("idle");
  const [guestDisplayName, setGuestDisplayName] = useState("");
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [testRoomSetupModalOpen, setTestRoomSetupModalOpen] = useState(false);
  const [testRoomDummyUserInput, setTestRoomDummyUserInput] = useState(String(TEST_ROOM_DUMMY_USER_DEFAULT));
  const [testRoomDummyUserCount, setTestRoomDummyUserCount] = useState<number | null>(null);
  const [testRoomDummyUserError, setTestRoomDummyUserError] = useState<string | null>(null);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [hasDirectJoinLoaderYielded, setHasDirectJoinLoaderYielded] = useState(false);
  const [isJoinLoaderMounted, setIsJoinLoaderMounted] = useState(true);
  const [joinLoaderCycleKey, setJoinLoaderCycleKey] = useState(0);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [activeMeetingTool, setActiveMeetingTool] = useState<ActiveMeetingTool>(null);
  const [stageViewMode, setStageViewMode] = useState<StageViewMode>("grid");
  const [localRecordingState, setLocalRecordingState] = useState<LocalRecordingControlState>("idle");
  const [isToolsLauncherOpen, setIsToolsLauncherOpen] = useState(false);
  const [liveStageParticipantCount, setLiveStageParticipantCount] = useState<number | null>(null);
  const [liveMediaByParticipantId, setLiveMediaByParticipantId] = useState<Record<string, ParticipantMediaIndicators>>(
    {},
  );
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeRoomSnapshot | null>(null);
  const [realtimeSocketStatus, setRealtimeSocketStatus] = useState<RealtimeSocketStatus>(
    REALTIME_BASE_URL ? "disconnected" : "unavailable",
  );
  const activeMeetingSessionRef = useRef<{ meetingId: string; participantId: string } | null>(null);
  const localRecordingSessionRef = useRef<LocalScreenRecordingSession | null>(null);
  const isMountedRef = useRef(true);
  const autoJoinKeyRef = useRef<string | null>(null);
  const drawerSwitchTimeoutRef = useRef<number | null>(null);
  const lastLeaveRequestKeyRef = useRef<string | null>(null);
  const meetingCodeRef = useRef(props.meetingCode);
  const joinLoaderVisibleRef = useRef(true);
  const meetingScopeRef = useRef(0);
  const roomRefreshFailureCountRef = useRef(0);
  const roomRefreshAbortControllerRef = useRef<AbortController | null>(null);
  const roomRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const roomRefreshQueuedRef = useRef(false);
  const roomRefreshTimeoutRef = useRef<number | null>(null);
  const lastSuccessfulRoomRefreshAtRef = useRef(0);
  const meetingSessionRecoveryAttemptRef = useRef(0);
  const meetingSessionRecoveryInFlightRef = useRef(false);
  const meetingSessionRecoveryTimeoutRef = useRef<number | null>(null);
  const meetingSessionRecoveryActiveRef = useRef(false);
  const pendingServiceMessageRef = useRef<string | null>(null);
  const pendingServiceMessageTimeoutRef = useRef<number | null>(null);
  const realtimeHelloKeyRef = useRef<string | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const serviceMessageRef = useRef<string | null>(null);
  const sessionRef = useRef(props.session);
  const suppressGuestPromptRef = useRef(false);
  const isTestRoom = isTestRoomCode(props.meetingCode);

  useEffect(() => {
    serviceMessageRef.current = serviceMessage;
  }, [serviceMessage]);

  useEffect(() => {
    sessionRef.current = props.session;
  }, [props.session]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (drawerSwitchTimeoutRef.current) {
        window.clearTimeout(drawerSwitchTimeoutRef.current);
      }
      if (roomRefreshTimeoutRef.current) {
        window.clearTimeout(roomRefreshTimeoutRef.current);
      }
      roomRefreshAbortControllerRef.current?.abort();
      if (meetingSessionRecoveryTimeoutRef.current) {
        window.clearTimeout(meetingSessionRecoveryTimeoutRef.current);
      }
      if (pendingServiceMessageTimeoutRef.current) {
        window.clearTimeout(pendingServiceMessageTimeoutRef.current);
      }
      const activeRecordingSession = localRecordingSessionRef.current;
      localRecordingSessionRef.current = null;
      if (activeRecordingSession) {
        void activeRecordingSession.stop();
      }
    };
  }, []);

  function isActiveMeetingScope(scopeId: number): boolean {
    return meetingScopeRef.current === scopeId;
  }

  function stopLocalRecordingForRoomReset() {
    const activeRecordingSession = localRecordingSessionRef.current;
    if (!activeRecordingSession) {
      return;
    }

    const activeMeetingId = loadState.status === "ready" ? loadState.data.meeting?.id ?? null : null;
    const scopeId = meetingScopeRef.current;
    localRecordingSessionRef.current = null;
    setLocalRecordingState("idle");
    void activeRecordingSession.stop();
    if (activeMeetingId) {
      syncRecordingCommand(() => stopRecording(activeMeetingId), scopeId);
    }
  }

  const clearMeetingSessionRecovery = useEffectEvent(() => {
    meetingSessionRecoveryActiveRef.current = false;
    meetingSessionRecoveryAttemptRef.current = 0;
    meetingSessionRecoveryInFlightRef.current = false;
    if (meetingSessionRecoveryTimeoutRef.current) {
      window.clearTimeout(meetingSessionRecoveryTimeoutRef.current);
      meetingSessionRecoveryTimeoutRef.current = null;
    }
  });

  const setVisibleServiceMessage = useEffectEvent((message: string | null) => {
    serviceMessageRef.current = message;
    setServiceMessage(message);
  });

  const clearPendingServiceMessage = useEffectEvent((shouldClear?: (message: string) => boolean) => {
    const pendingMessage = pendingServiceMessageRef.current;
    if (!pendingMessage || (shouldClear && !shouldClear(pendingMessage))) {
      return;
    }

    pendingServiceMessageRef.current = null;
    if (pendingServiceMessageTimeoutRef.current) {
      window.clearTimeout(pendingServiceMessageTimeoutRef.current);
      pendingServiceMessageTimeoutRef.current = null;
    }
  });

  const clearServiceMessage = useEffectEvent(() => {
    clearPendingServiceMessage();
    setVisibleServiceMessage(null);
  });

  const clearMeetingRefreshRetryServiceMessage = useEffectEvent(() => {
    clearPendingServiceMessage((message) => message === MEETING_SERVICE_RETRYING_MESSAGE);
    const currentMessage = serviceMessageRef.current;
    const nextMessage = clearMeetingRefreshRetryMessage(currentMessage);
    if (nextMessage !== currentMessage) {
      setVisibleServiceMessage(nextMessage);
    }
  });

  const clearMeetingServiceReconnectingServiceMessage = useEffectEvent(() => {
    clearPendingServiceMessage((message) => message === MEETING_SERVICE_RECONNECTING_MESSAGE);
    const currentMessage = serviceMessageRef.current;
    const nextMessage = clearMeetingServiceReconnectingMessage(currentMessage);
    if (nextMessage !== currentMessage) {
      setVisibleServiceMessage(nextMessage);
    }
  });

  const showMeetingServiceInterruption = useEffectEvent((message: string) => {
    const currentMessage = serviceMessageRef.current;
    if (currentMessage === message || pendingServiceMessageRef.current === message) {
      return;
    }

    if (isMeetingServiceInterruption(currentMessage)) {
      clearPendingServiceMessage();
      setVisibleServiceMessage(message);
      return;
    }

    pendingServiceMessageRef.current = message;
    if (pendingServiceMessageTimeoutRef.current) {
      return;
    }

    pendingServiceMessageTimeoutRef.current = window.setTimeout(() => {
      pendingServiceMessageTimeoutRef.current = null;
      const nextMessage = pendingServiceMessageRef.current;
      pendingServiceMessageRef.current = null;
      if (!nextMessage) {
        return;
      }

      const latestMessage = serviceMessageRef.current;
      if (latestMessage && !isMeetingServiceInterruption(latestMessage)) {
        return;
      }

      setVisibleServiceMessage(nextMessage);
    }, MEETING_SERVICE_WARNING_GRACE_MS);
  });

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
    roomRefreshAbortControllerRef.current?.abort();
    roomRefreshAbortControllerRef.current = null;
    roomRefreshPromiseRef.current = null;
    roomRefreshQueuedRef.current = false;
    lastSuccessfulRoomRefreshAtRef.current = 0;
    clearMeetingSessionRecovery();

    if (roomRefreshTimeoutRef.current) {
      window.clearTimeout(roomRefreshTimeoutRef.current);
      roomRefreshTimeoutRef.current = null;
    }
  });

  const resetMeetingSessionState = useEffectEvent((options?: { clearGuestDisplayName?: boolean }) => {
    stopLocalRecordingForRoomReset();
    closeDrawers();
    setJoinState("idle");
    setMediaConnectionPhase("idle");
    setJoinMessage(null);
    setActionMessage(null);
    clearServiceMessage();
    setHasDirectJoinLoaderYielded(false);
    setParticipantId(null);
    setActiveMeetingTool(null);
    setStageViewMode("grid");
    setLocalRecordingState("idle");
    setIsToolsLauncherOpen(false);
    setLiveStageParticipantCount(null);
    setLiveMediaByParticipantId({});
    setRealtimeSnapshot(null);
    setGuestModalOpen(false);
    setTestRoomSetupModalOpen(false);
    setTestRoomDummyUserCount(null);
    setTestRoomDummyUserInput(String(TEST_ROOM_DUMMY_USER_DEFAULT));
    setTestRoomDummyUserError(null);
    clearMeetingSessionRecovery();
    activeMeetingSessionRef.current = null;
    autoJoinKeyRef.current = null;
    lastLeaveRequestKeyRef.current = null;
    realtimeHelloKeyRef.current = null;

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
    const refreshAbortController = new AbortController();
    roomRefreshAbortControllerRef.current = refreshAbortController;

    try {
      const nextData = await loadMeetingRoomData(props.meetingCode, {
        signal: refreshAbortController.signal,
      });
      if (!isActiveMeetingScope(scopeId)) {
        return;
      }

      roomRefreshFailureCountRef.current = 0;
      lastSuccessfulRoomRefreshAtRef.current = Date.now();

      if (!nextData) {
        clearMeetingRefreshRetryServiceMessage();
        setLoadState({ status: "not-found" });
        return;
      }

      clearMeetingRefreshRetryServiceMessage();
      setLoadState({
        data: nextData,
        status: "ready",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

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
        showMeetingServiceInterruption(MEETING_SERVICE_RETRYING_MESSAGE);
      }
    } finally {
      if (roomRefreshAbortControllerRef.current === refreshAbortController) {
        roomRefreshAbortControllerRef.current = null;
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
      stopLocalRecordingForRoomReset();
    }

    invalidateMeetingScope();
    const scopeId = meetingScopeRef.current;
    suppressGuestPromptRef.current = false;
    autoJoinKeyRef.current = null;
    setJoinState("idle");
    setMediaConnectionPhase("idle");
    setActiveDrawer(null);
    setJoinMessage(null);
    setActionMessage(null);
    clearServiceMessage();
    setHasDirectJoinLoaderYielded(false);
    setIsJoinLoaderMounted(true);
    setParticipantId(null);
    setActiveMeetingTool(null);
    setStageViewMode("grid");
    setLocalRecordingState("idle");
    setIsToolsLauncherOpen(false);
    setLiveStageParticipantCount(null);
    setLiveMediaByParticipantId({});
    setRealtimeSnapshot(null);
    realtimeHelloKeyRef.current = null;
    setGuestModalOpen(false);
    setTestRoomSetupModalOpen(false);
    setTestRoomDummyUserCount(null);
    setTestRoomDummyUserInput(String(TEST_ROOM_DUMMY_USER_DEFAULT));
    setTestRoomDummyUserError(null);
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
  const participantDisplayName =
    currentParticipant?.displayName ??
    (props.session?.authenticated ? getSessionDisplayName(props.session) : guestDisplayName.trim() || "Guest User");
  const participantRole = currentParticipant?.role ?? props.session?.actor.workspaceRole ?? "participant";
  const activeParticipants = useMemo(
    () => participants.filter((entry) => isInMeetingPresence(entry.presence)),
    [participants],
  );
  const testRoomDummyParticipants = useMemo(
    () =>
      isTestRoom && joinState === "direct" && meeting?.id && testRoomDummyUserCount
        ? createTestRoomDummyParticipants({
            count: testRoomDummyUserCount,
            joinedAt: meeting.startsAt,
            meetingInstanceId: meeting.id,
          })
        : [],
    [isTestRoom, joinState, meeting?.id, meeting?.startsAt, testRoomDummyUserCount],
  );
  const visibleActiveParticipants = useMemo(
    () => [...activeParticipants, ...testRoomDummyParticipants],
    [activeParticipants, testRoomDummyParticipants],
  );
  const lobbyParticipants = useMemo(
    () => participants.filter((entry) => entry.presence === "lobby"),
    [participants],
  );

  const concludeMeetingSessionLoss = useEffectEvent((message: string) => {
    clearMeetingSessionRecovery();
    activeMeetingSessionRef.current = null;
    realtimeHelloKeyRef.current = null;
    setActiveMeetingTool(null);
    setParticipantId(null);
    setJoinState("idle");
    setJoinMessage(message);
    clearServiceMessage();
  });

  const syncRecoveredParticipant = useEffectEvent((participant: ParticipantState) => {
    setLoadState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        data: {
          ...current.data,
          participants: upsertParticipantState(current.data.participants, participant),
        },
      };
    });
  });

  const attemptMeetingSessionRecovery = useEffectEvent(async (scopeId = meetingScopeRef.current) => {
    if (
      meetingSessionRecoveryInFlightRef.current ||
      !meeting?.id ||
      !participantId ||
      (joinState !== "direct" && joinState !== "lobby")
    ) {
      return false;
    }

    meetingSessionRecoveryActiveRef.current = true;
    meetingSessionRecoveryInFlightRef.current = true;
    meetingSessionRecoveryAttemptRef.current += 1;

    const participant = await touchMeetingParticipantSession(meeting.id, participantId);
    meetingSessionRecoveryInFlightRef.current = false;

    if (!isActiveMeetingScope(scopeId) || !meetingSessionRecoveryActiveRef.current) {
      return false;
    }

    if (participant && participant.presence !== "left") {
      syncRecoveredParticipant(participant);
      if (joinState === "lobby" && participant.presence === "active") {
        setJoinState("direct");
        setJoinMessage("You were admitted to the room.");
      }
      clearMeetingSessionRecovery();
      clearMeetingServiceReconnectingServiceMessage();
      scheduleRoomRefresh({ immediate: true, scopeId });
      return true;
    }

    if (meetingSessionRecoveryAttemptRef.current >= MEETING_SESSION_RECOVERY_MAX_ATTEMPTS) {
      concludeMeetingSessionLoss("Meeting connection expired. Join again to continue.");
      return false;
    }

    if (!meetingSessionRecoveryTimeoutRef.current) {
      meetingSessionRecoveryTimeoutRef.current = window.setTimeout(() => {
        meetingSessionRecoveryTimeoutRef.current = null;
        void attemptMeetingSessionRecovery(scopeId);
      }, MEETING_SESSION_RECOVERY_RETRY_MS);
    }

    return false;
  });

  const beginMeetingSessionRecovery = useEffectEvent((options?: { immediate?: boolean }) => {
    if (!meeting?.id || !participantId || (joinState !== "direct" && joinState !== "lobby")) {
      return;
    }

    meetingSessionRecoveryActiveRef.current = true;
    showMeetingServiceInterruption(MEETING_SERVICE_RECONNECTING_MESSAGE);

    if (options?.immediate) {
      if (meetingSessionRecoveryTimeoutRef.current) {
        window.clearTimeout(meetingSessionRecoveryTimeoutRef.current);
        meetingSessionRecoveryTimeoutRef.current = null;
      }
      void attemptMeetingSessionRecovery();
      return;
    }

    if (meetingSessionRecoveryInFlightRef.current || meetingSessionRecoveryTimeoutRef.current) {
      return;
    }

    meetingSessionRecoveryTimeoutRef.current = window.setTimeout(() => {
      meetingSessionRecoveryTimeoutRef.current = null;
      void attemptMeetingSessionRecovery();
    }, MEETING_SESSION_RECOVERY_RETRY_MS);
  });

  useEffect(() => {
    if (suppressGuestPromptRef.current) {
      return;
    }

    if (!participantId) {
      clearMeetingSessionRecovery();
      return;
    }

    if (!currentParticipant) {
      beginMeetingSessionRecovery({ immediate: true });
      return;
    }

    if (currentParticipant.presence === "left") {
      beginMeetingSessionRecovery({ immediate: true });
      return;
    }

    if (currentParticipant.presence === "reconnecting") {
      beginMeetingSessionRecovery({ immediate: true });
      return;
    }

    clearMeetingSessionRecovery();
    clearMeetingServiceReconnectingServiceMessage();

    if (joinState === "lobby" && currentParticipant.presence === "active") {
      setJoinState("direct");
      setJoinMessage("You were admitted to the room.");
    }
  }, [beginMeetingSessionRecovery, clearMeetingSessionRecovery, currentParticipant, joinState, participantId]);

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
    if (!isActiveMeetingScope(scopeId)) {
      return;
    }

    if (!participant) {
      beginMeetingSessionRecovery();
      return;
    }

    syncRecoveredParticipant(participant);

    if (participant.presence === "left") {
      beginMeetingSessionRecovery({ immediate: true });
      return;
    }

    if (participant.presence === "reconnecting") {
      beginMeetingSessionRecovery({ immediate: true });
      return;
    }

    clearMeetingSessionRecovery();
    clearMeetingServiceReconnectingServiceMessage();
  });

  const sendRealtimeHello = useEffectEvent(() => {
    const socket = realtimeSocketRef.current;
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !meeting?.id ||
      !participantId ||
      joinState !== "direct" ||
      !currentParticipant
    ) {
      return;
    }

    const helloKey = `${meeting.id}:${participantId}:${participantDisplayName}:${participantRole}`;
    if (realtimeHelloKeyRef.current === helloKey) {
      return;
    }

    realtimeHelloKeyRef.current = helloKey;
    socket.send(
      JSON.stringify({
        type: "hello",
        payload: {
          displayName: participantDisplayName,
          meetingInstanceId: meeting.id,
          participantId,
          role: participantRole,
        },
      }),
    );
  });

  const sendWhiteboardStroke = useEffectEvent((stroke: WhiteboardStroke): boolean => {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || joinState !== "direct" || !participantId) {
      return false;
    }

    socket.send(
      JSON.stringify({
        type: "whiteboard.stroke.upsert",
        payload: { stroke },
      }),
    );
    return true;
  });

  const sendWhiteboardTextBoxUpsert = useEffectEvent((textBox: WhiteboardTextBox): boolean => {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || joinState !== "direct" || !participantId) {
      return false;
    }

    socket.send(
      JSON.stringify({
        type: "whiteboard.textbox.upsert",
        payload: { textBox },
      }),
    );
    return true;
  });

  const sendWhiteboardTextBoxCommit = useEffectEvent((action: WhiteboardTextBoxHistoryAction): boolean => {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || joinState !== "direct" || !participantId) {
      return false;
    }

    socket.send(
      JSON.stringify({
        type: "whiteboard.textbox.commit",
        payload: { action },
      }),
    );
    return true;
  });

  const sendWhiteboardCommand = useEffectEvent(
    (type: "whiteboard.clear" | "whiteboard.undo" | "whiteboard.redo"): boolean => {
      const socket = realtimeSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || joinState !== "direct" || !participantId) {
        return false;
      }

      socket.send(JSON.stringify({ type }));
      return true;
    },
  );

  const sendWhiteboardClear = useEffectEvent((): boolean => {
    if (!participantId || !sendWhiteboardCommand("whiteboard.clear")) {
      return false;
    }

    setRealtimeSnapshot((current) => clearRealtimeWhiteboard(current, participantId));
    return true;
  });

  const sendWhiteboardUndo = useEffectEvent((): boolean => {
    if (!sendWhiteboardCommand("whiteboard.undo")) {
      return false;
    }

    setRealtimeSnapshot((current) => undoRealtimeWhiteboard(current));
    return true;
  });

  const sendWhiteboardRedo = useEffectEvent((): boolean => {
    if (!sendWhiteboardCommand("whiteboard.redo")) {
      return false;
    }

    setRealtimeSnapshot((current) => redoRealtimeWhiteboard(current));
    return true;
  });

  useEffect(() => {
    if (suppressGuestPromptRef.current) {
      return;
    }

    if (props.isAuthLoading || loadState.status !== "ready" || !loadState.data.meeting || !props.session) {
      return;
    }

    if (isTestRoom && testRoomDummyUserCount === null) {
      if (joinState === "idle") {
        setTestRoomSetupModalOpen(true);
      }
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
  }, [isTestRoom, joinState, loadState, props.isAuthLoading, props.session, testRoomDummyUserCount]);

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
      realtimeSocketRef.current = null;
      setRealtimeSocketStatus(REALTIME_BASE_URL ? "disconnected" : "unavailable");
      setRealtimeSnapshot(null);
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
      realtimeHelloKeyRef.current = null;
      setRealtimeSocketStatus("connecting");
      socket = new WebSocket(`${REALTIME_BASE_URL}/v1/rooms/${meetingId}`);
      realtimeSocketRef.current = socket;
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        setRealtimeSocketStatus("connected");
        clearPingInterval();
        pingIntervalId = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, REALTIME_PING_INTERVAL_MS);
        socket?.send(JSON.stringify({ type: "snapshot.request" }));
        sendRealtimeHello();
        const scopeId = meetingScopeRef.current;
        void heartbeatMeetingSession(scopeId).finally(() => {
          scheduleRoomRefresh({ immediate: true, scopeId });
        });
      });
      socket.addEventListener("message", (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message || message.type === "pong") {
          return;
        }

        if (message.type === "room.snapshot") {
          setRealtimeSnapshot(message.payload);
          return;
        }

        if (message.type === "whiteboard.stroke.upsert") {
          setRealtimeSnapshot((current) => upsertRealtimeWhiteboardStroke(current, message.payload.stroke));
          return;
        }

        if (message.type === "whiteboard.textbox.upsert") {
          setRealtimeSnapshot((current) => upsertRealtimeWhiteboardTextBox(current, message.payload.textBox));
          return;
        }

        scheduleRoomRefresh();
      });
      socket.addEventListener("error", () => {
        socket?.close();
      });
      socket.addEventListener("close", () => {
        clearPingInterval();
        const isCurrentSocket = realtimeSocketRef.current === socket;
        if (isCurrentSocket) {
          realtimeSocketRef.current = null;
          realtimeHelloKeyRef.current = null;
          setRealtimeSocketStatus("disconnected");
        }
        socket = null;
        if (!closed && isCurrentSocket) {
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
      } else {
        sendRealtimeHello();
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
      if (realtimeSocketRef.current === socket) {
        realtimeSocketRef.current = null;
      }
      socket?.close();
    };
  }, [meeting?.id]);

  useEffect(() => {
    sendRealtimeHello();
  }, [currentParticipant, joinState, meeting?.id, participantDisplayName, participantId, participantRole, sendRealtimeHello]);

  useEffect(() => {
    if (REALTIME_BASE_URL) {
      return;
    }

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
      clearMeetingSessionRecovery();
      setJoinState("error");
      setJoinMessage("We could not join this meeting.");
      return;
    }

    clearMeetingSessionRecovery();
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

  function watchLocalRecordingSession(session: LocalScreenRecordingSession, scopeId: number, meetingId: string) {
    session.done
      .then(async (capturedRecording) => {
        const wasCurrentSession = localRecordingSessionRef.current?.id === session.id;
        if (wasCurrentSession) {
          localRecordingSessionRef.current = null;
          syncRecordingCommand(() => stopRecording(meetingId), scopeId);
        }

        if (isMountedRef.current && (wasCurrentSession || isActiveMeetingScope(scopeId))) {
          setLocalRecordingState("stopping");
          setActionMessage("Uploading recording...");
        }

        const uploadResult = await uploadMeetingRecording(meetingId, capturedRecording);
        if (!isMountedRef.current || (!wasCurrentSession && !isActiveMeetingScope(scopeId))) {
          return;
        }

        setLocalRecordingState("idle");
        setActionMessage(uploadResult.ok ? getLocalRecordingUploadedMessage(capturedRecording) : uploadResult.error);
        scheduleRoomRefresh({ immediate: true, scopeId });
      })
      .catch(() => {
        const wasCurrentSession = localRecordingSessionRef.current?.id === session.id;
        if (wasCurrentSession) {
          localRecordingSessionRef.current = null;
          syncRecordingCommand(() => stopRecording(meetingId), scopeId);
        }

        if (!isMountedRef.current || (!wasCurrentSession && !isActiveMeetingScope(scopeId))) {
          return;
        }

        setLocalRecordingState("idle");
        setActionMessage("Recording stopped, but the video could not be prepared for upload.");
      });
  }

  function syncRecordingCommand(action: () => Promise<boolean>, scopeId: number) {
    void action().then((ok) => {
      if (ok && isMountedRef.current && isActiveMeetingScope(scopeId)) {
        scheduleRoomRefresh({ immediate: true, scopeId });
      }
    });
  }

  async function handleToggleRecording() {
    if (!meeting) {
      return;
    }

    if (localRecordingState === "starting" || localRecordingState === "stopping") {
      return;
    }

    const activeRecordingSession = localRecordingSessionRef.current;
    const scopeId = meetingScopeRef.current;
    if (activeRecordingSession) {
      setLocalRecordingState("stopping");
      setActionMessage("Preparing recording...");
      void activeRecordingSession.stop();
      return;
    }

    if (!isLocalScreenRecordingSupported()) {
      setActionMessage("Screen recording is not supported in this browser.");
      return;
    }

    setLocalRecordingState("starting");
    setActionMessage("Choose a screen, window, or tab to record.");

    try {
      const session = await startLocalScreenRecording({
        meetingCode: props.meetingCode,
        title: `Meeting ${formatMeetingCodeLabel(props.meetingCode)}`,
      });

      if (!isMountedRef.current || !isActiveMeetingScope(scopeId)) {
        void session.stop();
        return;
      }

      localRecordingSessionRef.current = session;
      watchLocalRecordingSession(session, scopeId, meeting.id);
      setLocalRecordingState("recording");
      setActionMessage("Recording started. Your selected screen is being captured.");
      syncRecordingCommand(() => startRecording(meeting.id), scopeId);
    } catch (error) {
      if (!isMountedRef.current || !isActiveMeetingScope(scopeId)) {
        return;
      }

      setLocalRecordingState("idle");
      setActionMessage(getLocalRecordingStartFailureMessage(error));
    }
  }

  function toggleDrawer(nextDrawer: Exclude<ActiveDrawer, null>) {
    setIsToolsLauncherOpen(false);

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

  function toggleToolsLauncher() {
    closeDrawers();
    setIsToolsLauncherOpen((current) => !current);
  }

  function openWhiteboardTool() {
    closeDrawers();
    setIsToolsLauncherOpen(false);
    setActiveMeetingTool("whiteboard");
  }

  function closeActiveTool() {
    setActiveMeetingTool(null);
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

  function submitTestRoomSetup() {
    const requestedCount = Number(testRoomDummyUserInput);
    if (!Number.isInteger(requestedCount) || requestedCount < 0 || requestedCount > TEST_ROOM_DUMMY_USER_MAX) {
      setTestRoomDummyUserError(`Enter a whole number from 0 to ${TEST_ROOM_DUMMY_USER_MAX}.`);
      return;
    }

    setTestRoomDummyUserError(null);
    setTestRoomDummyUserCount(requestedCount);
    setTestRoomSetupModalOpen(false);
  }

  const directJoinLoaderIdentity = joinState === "direct" && participantId ? `${meeting?.id ?? "meeting"}:${participantId}` : null;
  const testRoomSetupPending = isTestRoom && testRoomDummyUserCount === null;
  const waitingForTestRoomSetup =
    loadState.status === "ready" &&
    Boolean(meeting) &&
    testRoomSetupPending &&
    !participantId &&
    !joinMessage &&
    joinState === "idle" &&
    !testRoomSetupModalOpen;
  const waitingForGuestPrompt =
    loadState.status === "ready" &&
    Boolean(meeting) &&
    !props.isAuthLoading &&
    !props.session?.authenticated &&
    !testRoomSetupPending &&
    !participantId &&
    !joinMessage &&
    joinState === "idle" &&
    !guestModalOpen;
  const waitingForSignedInAutoJoin =
    loadState.status === "ready" &&
    Boolean(meeting) &&
    !props.isAuthLoading &&
    Boolean(props.session?.authenticated) &&
    !testRoomSetupPending &&
    !participantId &&
    !joinMessage &&
    joinState === "idle";
  const waitingForAuthResolution =
    loadState.status === "ready" &&
    Boolean(meeting) &&
    props.isAuthLoading &&
    !participantId &&
    !joinMessage &&
    joinState === "idle";
  const waitingForJoinSubmit = joinState === "joining";
  const waitingForDirectJoinHandoff = joinState === "direct" && !hasDirectJoinLoaderYielded;
  const shouldShowMeetingJoinLoader =
    loadState.status === "loading" ||
    waitingForAuthResolution ||
    waitingForTestRoomSetup ||
    waitingForGuestPrompt ||
    waitingForSignedInAutoJoin ||
    waitingForJoinSubmit ||
    waitingForDirectJoinHandoff;

  useEffect(() => {
    setHasDirectJoinLoaderYielded(false);
  }, [directJoinLoaderIdentity]);

  useEffect(() => {
    if (joinState !== "direct") {
      setHasDirectJoinLoaderYielded(false);
      return;
    }

    if (
      mediaConnectionPhase === "requesting-device-access" ||
      mediaConnectionPhase === "connected" ||
      mediaConnectionPhase === "warning" ||
      mediaConnectionPhase === "error"
    ) {
      setHasDirectJoinLoaderYielded(true);
    }
  }, [joinState, mediaConnectionPhase]);

  useEffect(() => {
    let timeoutId: number | null = null;

    if (shouldShowMeetingJoinLoader) {
      setIsJoinLoaderMounted(true);
      if (!joinLoaderVisibleRef.current) {
        setJoinLoaderCycleKey((current) => current + 1);
      }
    } else if (joinLoaderVisibleRef.current) {
      timeoutId = window.setTimeout(() => {
        setIsJoinLoaderMounted(false);
      }, 280);
    }

    joinLoaderVisibleRef.current = shouldShowMeetingJoinLoader;

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [shouldShowMeetingJoinLoader]);

  function handleJoinLoaderCancel() {
    if (participantId || activeMeetingSessionRef.current) {
      exitMeetingToHome();
      return;
    }

    suppressGuestPromptRef.current = true;
    props.onNavigate("/", { replace: true });
  }

  if (loadState.status === "loading") {
    return (
      <section className="page page--room page--room-loader-only">
        <MeetingJoinLoader
          active
          meetingCode={props.meetingCode}
          onCancel={handleJoinLoaderCancel}
        />
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

  const canManageMeeting =
    Boolean(props.session?.authenticated) ||
    Boolean(
      currentParticipant &&
        ["owner", "host", "co_host", "moderator", "presenter"].includes(currentParticipant.role),
    ) ||
    Boolean(meeting?.hostUserId && meeting.hostUserId === props.session?.actor.userId);
  const shouldConnectMedia = joinState === "direct" && Boolean(participantId);
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
  const isWhiteboardOpen = activeMeetingTool === "whiteboard";
  const whiteboardState = realtimeSnapshot?.whiteboard ?? createEmptyWhiteboardState();
  const canClearWhiteboard =
    whiteboardState.strokes.some((stroke) => !stroke.removedAt) ||
    whiteboardState.textBoxes.some((textBox) => !textBox.removedAt);
  const canUndoWhiteboard = whiteboardState.undoStack.length > 0;
  const canRedoWhiteboard = whiteboardState.redoStack.length > 0;
  const whiteboardCollaboratorReady = realtimeSocketStatus === "connected" && Boolean(REALTIME_BASE_URL);
  const whiteboardDisabledReason =
    joinState !== "direct" || !participantId || !currentParticipant
      ? "Join the room to use the whiteboard."
      : !whiteboardCollaboratorReady
        ? "Realtime whiteboard is reconnecting."
        : null;
  const effectiveStageParticipantCount = liveStageParticipantCount ?? visibleActiveParticipants.length;
  const immersiveSoloMode = joinState === "direct" && effectiveStageParticipantCount === 1;
  const shouldUseImmersiveStageSurface = immersiveSoloMode && !isWhiteboardOpen;
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
      <section className={`page page--room${guestModalOpen || testRoomSetupModalOpen ? " page--obscured" : ""}`}>
        {isJoinLoaderMounted ? (
          <MeetingJoinLoader
            active={shouldShowMeetingJoinLoader}
            className="meeting-entry-loader--overlay"
            key={joinLoaderCycleKey}
            meetingCode={props.meetingCode}
            onCancel={handleJoinLoaderCancel}
          />
        ) : null}

        <div
          className={[
            "meeting-room-shell",
            shouldShowMeetingJoinLoader ? " meeting-room-shell--loader-hidden" : "",
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
              activeParticipants={visibleActiveParticipants}
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
              className={`meeting-room-stage-surface${shouldUseImmersiveStageSurface ? " meeting-room-stage-surface--immersive" : ""}`}
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
                    <MeetingToolsLauncher
                      activeTool={activeMeetingTool}
                      open={isToolsLauncherOpen}
                      onSelectWhiteboard={openWhiteboardTool}
                      onToggleOpen={toggleToolsLauncher}
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
                immersiveSoloMode={shouldUseImmersiveStageSurface}
                onConnectionPhaseChange={setMediaConnectionPhase}
                onLeave={leaveRoom}
                onLiveMediaStateChange={setLiveMediaByParticipantId}
                onLiveParticipantCountChange={setLiveStageParticipantCount}
                participantDisplayName={participantDisplayName}
                participantId={participantId}
                participantRole={participantRole}
                screenShareDisabledReason={screenShareDisabledReason}
                stageMessages={stageMessages}
                stageViewMode={stageViewMode}
                shouldConnect={shouldConnectMedia}
                syntheticParticipants={testRoomDummyParticipants}
                toolStage={
                  isWhiteboardOpen ? (
                    <MeetingWhiteboardStage
                      canClear={canClearWhiteboard}
                      canRedo={canRedoWhiteboard}
                      canUndo={canUndoWhiteboard}
                      disabledReason={whiteboardDisabledReason}
                      onClear={sendWhiteboardClear}
                      onClose={closeActiveTool}
                      onRedo={sendWhiteboardRedo}
                      onStrokeUpsert={sendWhiteboardStroke}
                      onTextBoxCommit={sendWhiteboardTextBoxCommit}
                      onTextBoxUpsert={sendWhiteboardTextBoxUpsert}
                      onUndo={sendWhiteboardUndo}
                      participantId={participantId}
                      strokes={whiteboardState.strokes}
                      textBoxes={whiteboardState.textBoxes}
                    />
                  ) : null
                }
              />
            </section>
          </div>

          <aside
            aria-hidden={!isInfoOpen}
            className={`meeting-room-drawer meeting-room-drawer--info${isInfoOpen ? " is-open" : ""}`}
          >
            <MeetingInfoPanel
              actionMessage={actionMessage}
              activeParticipants={visibleActiveParticipants}
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
              onToggleStageView={() => {
                setStageViewMode((current) => (current === "speaker" ? "grid" : "speaker"));
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
                void handleToggleRecording();
              }}
              recording={recording}
              localRecordingState={localRecordingState}
              serviceMessage={serviceMessage}
              sessionAuthenticated={Boolean(props.session?.authenticated)}
              showStartMeetingAction={!meeting && Boolean(props.session?.authenticated)}
              stageViewMode={stageViewMode}
            />
          </aside>
        </div>
      </section>

      <Modal
        description="Choose how many local dummy users should appear with you in this room."
        onClose={() => {
          exitMeetingToHome();
        }}
        open={testRoomSetupModalOpen}
        title="Set up test room"
      >
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitTestRoomSetup();
          }}
        >
          <label className="field">
            <span className="field__label">Dummy users</span>
            <input
              autoFocus
              className="field__input"
              inputMode="numeric"
              max={TEST_ROOM_DUMMY_USER_MAX}
              min={0}
              onChange={(event) => {
                setTestRoomDummyUserInput(event.target.value);
                setTestRoomDummyUserError(null);
              }}
              step={1}
              type="number"
              value={testRoomDummyUserInput}
            />
          </label>
          {testRoomDummyUserError ? <p className="inline-feedback inline-feedback--error">{testRoomDummyUserError}</p> : null}
          <div className="stack-actions stack-actions--inline">
            <button className="button button--primary" type="submit">
              Enter Test Room
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                exitMeetingToHome();
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

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

type RealtimeClientMessage =
  | { type: "pong" }
  | { type: "room.snapshot"; payload: RealtimeRoomSnapshot }
  | { type: "whiteboard.stroke.upsert"; payload: { stroke: WhiteboardStroke } }
  | { type: "whiteboard.textbox.upsert"; payload: { textBox: WhiteboardTextBox } }
  | { type: "other" };

function parseRealtimeMessage(raw: string): RealtimeClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as { payload?: unknown; type?: string };
    if (parsed.type === "pong") {
      return { type: "pong" };
    }

    if (parsed.type === "room.snapshot" && isRealtimeRoomSnapshot(parsed.payload)) {
      return { type: "room.snapshot", payload: parsed.payload };
    }

    if (parsed.type === "whiteboard.stroke.upsert" && isWhiteboardStrokePayload(parsed.payload)) {
      return { type: "whiteboard.stroke.upsert", payload: parsed.payload };
    }

    if (parsed.type === "whiteboard.textbox.upsert" && isWhiteboardTextBoxPayload(parsed.payload)) {
      return { type: "whiteboard.textbox.upsert", payload: parsed.payload };
    }

    return typeof parsed.type === "string" ? { type: "other" } : null;
  } catch {
    return null;
  }
}

function isRealtimeRoomSnapshot(value: unknown): value is RealtimeRoomSnapshot {
  return Boolean(value && typeof value === "object" && "whiteboard" in value);
}

function isWhiteboardStrokePayload(value: unknown): value is { stroke: WhiteboardStroke } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "stroke" in value &&
      value.stroke &&
      typeof value.stroke === "object",
  );
}

function isWhiteboardTextBoxPayload(value: unknown): value is { textBox: WhiteboardTextBox } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "textBox" in value &&
      value.textBox &&
      typeof value.textBox === "object",
  );
}

function upsertRealtimeWhiteboardStroke(
  snapshot: RealtimeRoomSnapshot | null,
  stroke: WhiteboardStroke,
): RealtimeRoomSnapshot {
  const baseSnapshot = snapshot ?? createEmptyRealtimeSnapshot();
  const existingStroke = baseSnapshot.whiteboard.strokes.find((entry) => entry.strokeId === stroke.strokeId);
  const nextStrokes = baseSnapshot.whiteboard.strokes.filter((entry) => entry.strokeId !== stroke.strokeId);
  nextStrokes.push({
    ...stroke,
    removedAt: stroke.removedAt ?? existingStroke?.removedAt ?? null,
  });

  return {
    ...baseSnapshot,
    whiteboard: {
      ...baseSnapshot.whiteboard,
      strokes: nextStrokes,
      updatedAt: stroke.updatedAt,
    },
  };
}

function upsertRealtimeWhiteboardTextBox(
  snapshot: RealtimeRoomSnapshot | null,
  textBox: WhiteboardTextBox,
): RealtimeRoomSnapshot {
  const baseSnapshot = snapshot ?? createEmptyRealtimeSnapshot();
  const existingTextBox = baseSnapshot.whiteboard.textBoxes.find((entry) => entry.textBoxId === textBox.textBoxId);
  const nextTextBoxes = baseSnapshot.whiteboard.textBoxes.filter((entry) => entry.textBoxId !== textBox.textBoxId);
  nextTextBoxes.push({
    ...textBox,
    removedAt: textBox.removedAt ?? existingTextBox?.removedAt ?? null,
  });

  return {
    ...baseSnapshot,
    whiteboard: {
      ...baseSnapshot.whiteboard,
      textBoxes: nextTextBoxes,
      updatedAt: textBox.updatedAt,
    },
  };
}

function clearRealtimeWhiteboard(
  snapshot: RealtimeRoomSnapshot | null,
  participantId: string,
): RealtimeRoomSnapshot {
  const baseSnapshot = snapshot ?? createEmptyRealtimeSnapshot();
  const strokeIds = baseSnapshot.whiteboard.strokes
    .filter((stroke) => !stroke.removedAt)
    .map((stroke) => stroke.strokeId);
  const textBoxIds = baseSnapshot.whiteboard.textBoxes
    .filter((textBox) => !textBox.removedAt)
    .map((textBox) => textBox.textBoxId);

  if (!strokeIds.length && !textBoxIds.length) {
    return baseSnapshot;
  }

  const occurredAt = new Date().toISOString();
  return {
    ...baseSnapshot,
    whiteboard: pruneRealtimeWhiteboardState(
      commitRealtimeWhiteboardAction(
        {
          ...baseSnapshot.whiteboard,
          strokes: setRealtimeWhiteboardStrokeVisibility(
            baseSnapshot.whiteboard.strokes,
            new Set(strokeIds),
            false,
            occurredAt,
          ),
          textBoxes: setRealtimeWhiteboardTextBoxVisibility(
            baseSnapshot.whiteboard.textBoxes,
            new Set(textBoxIds),
            false,
            occurredAt,
          ),
          updatedAt: occurredAt,
        },
        {
          occurredAt,
          participantId,
          strokeIds,
          textBoxIds,
          type: "clear",
        },
        occurredAt,
      ),
    ),
  };
}

function undoRealtimeWhiteboard(snapshot: RealtimeRoomSnapshot | null): RealtimeRoomSnapshot {
  const baseSnapshot = snapshot ?? createEmptyRealtimeSnapshot();
  const action = baseSnapshot.whiteboard.undoStack.at(-1);
  if (!action) {
    return baseSnapshot;
  }

  const occurredAt = new Date().toISOString();
  return {
    ...baseSnapshot,
    whiteboard: pruneRealtimeWhiteboardState({
      ...applyRealtimeWhiteboardHistoryAction(baseSnapshot.whiteboard, action, occurredAt, "undo"),
      redoStack: [...baseSnapshot.whiteboard.redoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
      undoStack: baseSnapshot.whiteboard.undoStack.slice(0, -1),
      updatedAt: occurredAt,
    }),
  };
}

function redoRealtimeWhiteboard(snapshot: RealtimeRoomSnapshot | null): RealtimeRoomSnapshot {
  const baseSnapshot = snapshot ?? createEmptyRealtimeSnapshot();
  const action = baseSnapshot.whiteboard.redoStack.at(-1);
  if (!action) {
    return baseSnapshot;
  }

  const occurredAt = new Date().toISOString();
  return {
    ...baseSnapshot,
    whiteboard: pruneRealtimeWhiteboardState({
      ...applyRealtimeWhiteboardHistoryAction(baseSnapshot.whiteboard, action, occurredAt, "redo"),
      redoStack: baseSnapshot.whiteboard.redoStack.slice(0, -1),
      undoStack: [...baseSnapshot.whiteboard.undoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
      updatedAt: occurredAt,
    }),
  };
}

function createEmptyRealtimeSnapshot(): RealtimeRoomSnapshot {
  return {
    meetingInstanceId: null,
    meetingStatus: null,
    lockState: "unlocked",
    recordingState: "idle",
    participants: {},
    lobby: [],
    handsRaised: [],
    mutedAllAt: null,
    endedAt: null,
    lastEventNumber: 0,
    whiteboard: createEmptyWhiteboardState(),
  };
}

function createEmptyWhiteboardState(): RealtimeWhiteboardState {
  return {
    strokes: [],
    textBoxes: [],
    undoStack: [],
    redoStack: [],
    updatedAt: null,
  };
}

const MAX_WHITEBOARD_HISTORY_ACTIONS = 200;

function commitRealtimeWhiteboardAction(
  state: RealtimeWhiteboardState,
  action: WhiteboardHistoryAction,
  updatedAt: string,
): RealtimeWhiteboardState {
  return {
    ...state,
    undoStack: [...state.undoStack, action].slice(-MAX_WHITEBOARD_HISTORY_ACTIONS),
    redoStack: [],
    updatedAt,
  };
}

function applyRealtimeWhiteboardHistoryAction(
  state: RealtimeWhiteboardState,
  action: WhiteboardHistoryAction,
  occurredAt: string,
  direction: "undo" | "redo",
): RealtimeWhiteboardState {
  if (action.type === "stroke") {
    return {
      ...state,
      strokes: setRealtimeWhiteboardStrokeVisibility(
        state.strokes,
        new Set([action.strokeId]),
        direction === "redo",
        occurredAt,
      ),
    };
  }

  if (action.type === "clear") {
    return {
      ...state,
      strokes: setRealtimeWhiteboardStrokeVisibility(
        state.strokes,
        new Set(action.strokeIds),
        direction === "undo",
        occurredAt,
      ),
      textBoxes: setRealtimeWhiteboardTextBoxVisibility(
        state.textBoxes,
        new Set(action.textBoxIds),
        direction === "undo",
        occurredAt,
      ),
    };
  }

  if (action.type === "textbox.create") {
    if (direction === "undo") {
      return {
        ...state,
        textBoxes: setRealtimeWhiteboardTextBoxVisibility(
          state.textBoxes,
          new Set([action.textBox.textBoxId]),
          false,
          occurredAt,
        ),
      };
    }

    return {
      ...state,
      textBoxes: upsertRealtimeWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  if (action.type === "textbox.update") {
    const nextTextBox = direction === "undo" ? action.before : action.after;
    return {
      ...state,
      textBoxes: upsertRealtimeWhiteboardTextBoxEntry(state.textBoxes, {
        ...nextTextBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  if (direction === "undo") {
    return {
      ...state,
      textBoxes: upsertRealtimeWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
    };
  }

  return {
    ...state,
    textBoxes: setRealtimeWhiteboardTextBoxVisibility(
      upsertRealtimeWhiteboardTextBoxEntry(state.textBoxes, {
        ...action.textBox,
        removedAt: null,
        updatedAt: occurredAt,
      }),
      new Set([action.textBox.textBoxId]),
      false,
      occurredAt,
    ),
  };
}

function setRealtimeWhiteboardStrokeVisibility(
  strokes: WhiteboardStroke[],
  strokeIds: ReadonlySet<string>,
  visible: boolean,
  occurredAt: string,
): WhiteboardStroke[] {
  return strokes.map((stroke) => {
    if (!strokeIds.has(stroke.strokeId)) {
      return stroke;
    }

    return {
      ...stroke,
      removedAt: visible ? null : occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function setRealtimeWhiteboardTextBoxVisibility(
  textBoxes: WhiteboardTextBox[],
  textBoxIds: ReadonlySet<string>,
  visible: boolean,
  occurredAt: string,
): WhiteboardTextBox[] {
  return textBoxes.map((textBox) => {
    if (!textBoxIds.has(textBox.textBoxId)) {
      return textBox;
    }

    return {
      ...textBox,
      removedAt: visible ? null : occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function pruneRealtimeWhiteboardState(state: RealtimeWhiteboardState): RealtimeWhiteboardState {
  const referencedStrokeIds = new Set<string>();
  const referencedTextBoxIds = new Set<string>();
  for (const action of [...state.undoStack, ...state.redoStack]) {
    if (action.type === "stroke") {
      referencedStrokeIds.add(action.strokeId);
      continue;
    }

    if (action.type === "clear") {
      for (const strokeId of action.strokeIds) {
        referencedStrokeIds.add(strokeId);
      }
      for (const textBoxId of action.textBoxIds) {
        referencedTextBoxIds.add(textBoxId);
      }
      continue;
    }

    if (action.type === "textbox.update") {
      referencedTextBoxIds.add(action.before.textBoxId);
      continue;
    }

    referencedTextBoxIds.add(action.textBox.textBoxId);
  }

  return {
    ...state,
    strokes: state.strokes.filter(
      (stroke) => !stroke.removedAt || referencedStrokeIds.has(stroke.strokeId),
    ),
    textBoxes: state.textBoxes.filter(
      (textBox) => !textBox.removedAt || referencedTextBoxIds.has(textBox.textBoxId),
    ),
  };
}

function upsertRealtimeWhiteboardTextBoxEntry(
  textBoxes: WhiteboardTextBox[],
  textBox: WhiteboardTextBox,
): WhiteboardTextBox[] {
  const nextTextBoxes = textBoxes.filter((entry) => entry.textBoxId !== textBox.textBoxId);
  nextTextBoxes.push(textBox);
  return nextTextBoxes;
}

function upsertParticipantState(
  participants: ParticipantState[],
  participant: ParticipantState,
): ParticipantState[] {
  const nextParticipants = participants.filter((entry) => entry.participantId !== participant.participantId);
  nextParticipants.push(participant);
  return nextParticipants;
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

function getLocalRecordingUploadedMessage(recording: CapturedRecording): string {
  const seconds = Math.max(1, Math.round(recording.durationMs / 1_000));
  return `Recording uploaded to Recordings (${seconds}s).`;
}

function getLocalRecordingStartFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Recording cancelled.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No screen source was available to record.";
  }

  return "Recording could not be started.";
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
