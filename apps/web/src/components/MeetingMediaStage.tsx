import * as Sentry from "@sentry/react";
import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import type { RTKParticipant, RTKSelf } from "@cloudflare/realtimekit-react";
import type { ParticipantState } from "@opsui/shared-types";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createMediaSession } from "../lib/commands";
import {
  MeetingStageScene,
  StagePipStack,
  type MeetingStageParticipantTile,
} from "./MeetingStageScene";
import { MeetingControlButton } from "./MeetingControlButton";
import {
  LeaveCallIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PresentScreenIcon,
  PresentScreenOffIcon,
  VideoCameraIcon,
  VideoCameraOffIcon,
} from "./MeetingRoomIcons";
import type { ParticipantMediaIndicators } from "./MeetingParticipantsPanel";

type MediaStatus = "idle" | "connecting" | "connected" | "warning" | "error";
type MediaActionKind = "audio" | "video" | "screenshare";
export type StageViewMode = "grid" | "speaker";
type MediaClient = Awaited<ReturnType<ReturnType<typeof useRealtimeKitClient>[1]>> | undefined;
export type MediaConnectionPhase =
  | "idle"
  | "requesting-session"
  | "starting-client"
  | "joining-room"
  | "requesting-device-access"
  | "connected"
  | "warning"
  | "error";
type ScreenshareConfiguration = {
  displaySurface?: "browser" | "monitor" | "window";
  frameRate: {
    ideal: number;
    max: number;
  };
  height: {
    max: number;
  };
  selfBrowserSurface: "exclude" | "include";
  width: {
    max: number;
  };
};

interface StageScreenShare {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  videoTrack?: MediaStreamTrack | null;
}

interface MeetingMediaStageProps {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  immersiveSoloMode?: boolean;
  meetingActive: boolean;
  meetingId: string | null;
  onConnectionPhaseChange?: (phase: MediaConnectionPhase) => void;
  onLeave?: () => void;
  onLiveMediaStateChange?: (state: Record<string, ParticipantMediaIndicators>) => void;
  onLiveParticipantCountChange?: (count: number | null) => void;
  participantDisplayName: string;
  participantId: string | null;
  participantRole: string;
  screenShareDisabledReason?: string | null;
  stageMessages?: Array<{ kind: "default" | "warning"; text: string }>;
  stageViewMode?: StageViewMode;
  shouldConnect: boolean;
  syntheticParticipants?: ParticipantState[];
  toolStage?: ReactNode;
}

const BASE_SCREEN_SHARE_CONFIGURATION: ScreenshareConfiguration = {
  frameRate: {
    ideal: 60,
    max: 60,
  },
  height: {
    max: 1080,
  },
  selfBrowserSurface: "exclude",
  width: {
    max: 1920,
  },
};

const MEDIA_CLIENT_INIT_TIMEOUT_MS = 30_000;
const MEDIA_JOIN_SOFT_TIMEOUT_MS = 12_000;
const MEDIA_JOIN_HARD_TIMEOUT_MS = 45_000;
const MEDIA_RECOVERABLE_RETRY_DELAY_MS = 1_500;
const MAX_MEDIA_CONNECTION_ATTEMPTS = 3;

export function MeetingMediaStage(props: MeetingMediaStageProps) {
  const [client, initClient] = useRealtimeKitClient({ resetOnLeave: true });
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [connectionPhase, setConnectionPhase] = useState<MediaConnectionPhase>("idle");
  const [retryNonce, setRetryNonce] = useState(0);
  const clientRef = useRef<MediaClient>(undefined);
  const connectionAttemptRef = useRef(0);
  const connectionIdentityRef = useRef<string | null>(null);
  const connectionKeyRef = useRef<string | null>(null);
  const mediaConfigurationRef = useRef<{ screenshare: ScreenshareConfiguration }>({
    screenshare: {
      ...BASE_SCREEN_SHARE_CONFIGURATION,
    },
  });
  const recoverableFailureRef = useRef(false);
  const retryTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    props.onConnectionPhaseChange?.(connectionPhase);
  }, [connectionPhase, props.onConnectionPhaseChange]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
      }
      void leaveMediaClient(clientRef.current);
    };
  }, []);

  useEffect(() => {
    if (!props.shouldConnect || !props.meetingId || !props.participantId) {
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      connectionAttemptRef.current = 0;
      connectionIdentityRef.current = null;
      connectionKeyRef.current = null;
      recoverableFailureRef.current = false;
      setMediaStatus("idle");
      setMediaMessage(null);
      setConnectionPhase("idle");
      void leaveMediaClient(clientRef.current);
      return;
    }

    const connectionIdentity = [
      props.meetingId,
      props.participantId,
      props.participantDisplayName,
      props.participantRole,
    ].join(":");
    if (connectionIdentityRef.current !== connectionIdentity) {
      connectionAttemptRef.current = 0;
      connectionIdentityRef.current = connectionIdentity;
      recoverableFailureRef.current = false;
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    }

    const connectionKey = [connectionIdentity, retryNonce].join(":");
    if (connectionKeyRef.current === connectionKey) {
      return;
    }

    connectionKeyRef.current = connectionKey;
    const attemptNumber = connectionAttemptRef.current + 1;
    connectionAttemptRef.current = attemptNumber;
    let cancelled = false;

    void (async () => {
      setMediaStatus("connecting");
      setMediaMessage("Requesting live media session...");
      setConnectionPhase("requesting-session");
      await leaveMediaClient(clientRef.current);

      const session = await createMediaSession(
        props.meetingId ?? "",
        props.participantId ?? "",
        props.participantRole,
        props.participantDisplayName,
      );

      if (cancelled) {
        return;
      }

      if (!session) {
        setMediaStatus("error");
        setMediaMessage("Live media could not be started for this participant.");
        setConnectionPhase("error");
        return;
      }

      let nextClient: MediaClient;
      try {
        setConnectionPhase("starting-client");
        setMediaMessage("Starting live media client...");
        nextClient = await withTimeout(
          initClient({
            authToken: session.token,
            defaults: {
              audio: false,
              mediaConfiguration: mediaConfigurationRef.current,
              video: false,
            },
            onError: (error) => {
              Sentry.captureException(error);
            },
          }),
          MEDIA_CLIENT_INIT_TIMEOUT_MS,
          "Media client initialisation timed out.",
        );
      } catch (error) {
        reportMediaConnectionException(error, { attemptNumber, stage: "init" });
        if (!cancelled) {
          const recovery = handleMediaConnectionFailure(error, {
            attemptNumber,
            onRetry: () => {
              if (retryTimeoutRef.current) {
                return;
              }

              retryTimeoutRef.current = window.setTimeout(() => {
                retryTimeoutRef.current = null;
                if (connectionKeyRef.current !== connectionKey || !props.shouldConnect) {
                  return;
                }

                setRetryNonce((current) => current + 1);
              }, MEDIA_RECOVERABLE_RETRY_DELAY_MS);
            },
            setMediaMessage,
            setMediaStatus,
          });
          setConnectionPhase(recovery.phase);
          recoverableFailureRef.current = recovery.recoverable;
        }
        return;
      }

      if (!nextClient) {
        setMediaStatus("error");
        setMediaMessage("Live media client could not be created.");
        setConnectionPhase("error");
        return;
      }

      if (cancelled) {
        await leaveMediaClient(nextClient);
        return;
      }

      try {
        nextClient.self.setName(props.participantDisplayName);
        setConnectionPhase("joining-room");
        setMediaMessage("Joining live media room...");
        await joinMediaRoomWithProgress(nextClient, {
          hardTimeoutMs: MEDIA_JOIN_HARD_TIMEOUT_MS,
          onSlow: () => {
            if (cancelled) {
              return;
            }

            setMediaStatus("warning");
            setMediaMessage("Joining live media room is taking longer than usual. Keeping the connection attempt alive...");
            setConnectionPhase("warning");
          },
          softTimeoutMs: MEDIA_JOIN_SOFT_TIMEOUT_MS,
        });

        setMediaMessage("Enabling camera and microphone...");
        setConnectionPhase("requesting-device-access");
        const [audioResult, videoResult] = await Promise.allSettled([
          nextClient.self.enableAudio(),
          nextClient.self.enableVideo(),
        ]);

        if (cancelled) {
          await leaveMediaClient(nextClient);
          return;
        }

        connectionAttemptRef.current = 0;
        recoverableFailureRef.current = false;
        setMediaStatus("connected");
        setMediaMessage(getMediaReadyMessage(audioResult, videoResult));
        setConnectionPhase("connected");
      } catch (error) {
        await leaveMediaClient(nextClient);
        if (cancelled) {
          return;
        }

        reportMediaConnectionException(error, { attemptNumber, stage: "join" });
        const recovery = handleMediaConnectionFailure(error, {
          attemptNumber,
          onRetry: () => {
            if (retryTimeoutRef.current) {
              return;
            }

            retryTimeoutRef.current = window.setTimeout(() => {
              retryTimeoutRef.current = null;
              if (connectionKeyRef.current !== connectionKey || !props.shouldConnect) {
                return;
              }

              setRetryNonce((current) => current + 1);
            }, MEDIA_RECOVERABLE_RETRY_DELAY_MS);
          },
          setMediaMessage,
          setMediaStatus,
        });
        setConnectionPhase(recovery.phase);
        recoverableFailureRef.current = recovery.recoverable;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    initClient,
    props.meetingId,
    props.participantDisplayName,
    props.participantId,
    props.participantRole,
    props.shouldConnect,
    retryNonce,
  ]);

  useEffect(() => {
    if (!props.shouldConnect) {
      return;
    }

    const resumeRecoverableJoin = () => {
      if (document.visibilityState === "hidden" || !recoverableFailureRef.current || retryTimeoutRef.current) {
        return;
      }

      connectionAttemptRef.current = 0;
      setRetryNonce((current) => current + 1);
    };

    document.addEventListener("visibilitychange", resumeRecoverableJoin);
    window.addEventListener("focus", resumeRecoverableJoin);
    window.addEventListener("online", resumeRecoverableJoin);

    return () => {
      document.removeEventListener("visibilitychange", resumeRecoverableJoin);
      window.removeEventListener("focus", resumeRecoverableJoin);
      window.removeEventListener("online", resumeRecoverableJoin);
    };
  }, [props.shouldConnect]);

  const mediaFallback = (
    <StageFallback
      activeParticipants={props.activeParticipants}
      extraControls={props.extraControls}
      immersiveSoloMode={props.immersiveSoloMode}
      meetingActive={props.meetingActive}
      mediaMessage={mediaMessage}
      mediaStatus={mediaStatus}
      onLeave={props.onLeave}
      onLiveMediaStateChange={props.onLiveMediaStateChange}
      onLiveParticipantCountChange={props.onLiveParticipantCountChange}
      participantDisplayName={props.participantDisplayName}
      participantId={props.participantId}
      onRetry={
        props.shouldConnect
          ? () => {
              setRetryNonce((current) => current + 1);
            }
          : null
      }
      screenShareDisabledReason={props.screenShareDisabledReason ?? null}
      stageMessages={props.stageMessages ?? []}
      stageViewMode={props.stageViewMode ?? "grid"}
      syntheticParticipants={props.syntheticParticipants ?? []}
      toolStage={props.toolStage}
    />
  );

  return (
    <div className="stage-media">
      <RealtimeKitProvider fallback={mediaFallback} value={client}>
        <ConnectedMediaStage
          activeParticipants={props.activeParticipants}
          extraControls={props.extraControls}
          mediaMessage={mediaMessage}
          mediaStatus={mediaStatus}
          onMediaActionError={(kind, error) => {
            reportMediaException(error, { kind, stage: "toggle" });
            setMediaStatus("warning");
            setMediaMessage(getMediaActionErrorMessage(kind, error));
          }}
          onMediaActionSuccess={() => {
            setMediaStatus("connected");
            setMediaMessage(null);
          }}
          onLeave={props.onLeave}
          onLiveMediaStateChange={props.onLiveMediaStateChange}
          onLiveParticipantCountChange={props.onLiveParticipantCountChange}
          onRetry={() => {
            connectionAttemptRef.current = 0;
            recoverableFailureRef.current = false;
            setRetryNonce((current) => current + 1);
          }}
          immersiveSoloMode={props.immersiveSoloMode}
          participantDisplayName={props.participantDisplayName}
          participantId={props.participantId}
          screenShareDisabledReason={props.screenShareDisabledReason ?? null}
          stageMessages={props.stageMessages ?? []}
          stageViewMode={props.stageViewMode ?? "grid"}
          syntheticParticipants={props.syntheticParticipants ?? []}
          toolStage={props.toolStage}
        />
      </RealtimeKitProvider>
    </div>
  );
}

function ConnectedMediaStage(props: {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  immersiveSoloMode?: boolean;
  mediaMessage: string | null;
  mediaStatus: MediaStatus;
  onMediaActionError(kind: MediaActionKind, error: unknown): void;
  onMediaActionSuccess(): void;
  onLeave?: () => void;
  onLiveMediaStateChange?: (state: Record<string, ParticipantMediaIndicators>) => void;
  onLiveParticipantCountChange?: (count: number | null) => void;
  onRetry(): void;
  participantDisplayName: string;
  participantId: string | null;
  screenShareDisabledReason: string | null;
  stageMessages: Array<{ kind: "default" | "warning"; text: string }>;
  stageViewMode: StageViewMode;
  syntheticParticipants: ParticipantState[];
  toolStage?: ReactNode;
}) {
  const roomJoined = useRealtimeKitSelector((currentMeeting) => currentMeeting.self.roomJoined);
  const self = useRealtimeKitSelector((currentMeeting) => currentMeeting.self);
  const remoteParticipants = useRealtimeKitSelector((currentMeeting) =>
    currentMeeting.participants.active.toArray(),
  );
  const [isShareActionPending, setIsShareActionPending] = useState(false);
  const participantDirectory = useMemo(
    () => new Map(props.activeParticipants.map((participant) => [participant.participantId, participant])),
    [props.activeParticipants],
  );
  const otherRemoteParticipants = useMemo(
    () =>
      remoteParticipants.filter(
        (participant) => participant.id !== self.id && participant.customParticipantId !== self.customParticipantId,
      ),
    [remoteParticipants, self.customParticipantId, self.id],
  );
  const shareSupported = useMemo(
    () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia),
    [],
  );
  const selfScreenShareVideoTrack = getScreenShareVideoTrack(self);
  const shareDisabledReason = !shareSupported
    ? "This browser does not support screen sharing."
    : props.screenShareDisabledReason;
  const stageScreenShares = useMemo(
    () =>
      buildStageScreenShares({
        participantDirectory,
        participantDisplayName: props.participantDisplayName,
        remoteParticipants: otherRemoteParticipants,
        self,
      }),
    [otherRemoteParticipants, participantDirectory, props.participantDisplayName, self],
  );
  const primaryScreenShare = stageScreenShares[0] ?? null;
  const liveParticipantCount = roomJoined ? 1 + otherRemoteParticipants.length + props.syntheticParticipants.length : null;
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode &&
      roomJoined &&
      !primaryScreenShare &&
      otherRemoteParticipants.length === 0 &&
      props.syntheticParticipants.length === 0,
  );
  const stageParticipantTiles = useMemo<MeetingStageParticipantTile[]>(
    () => [
      {
        audioEnabled: self.audioEnabled,
        displayName: props.participantDisplayName,
        isSelf: true,
        participantId: props.participantId,
        videoEnabled: self.videoEnabled,
        videoTrack: self.videoTrack,
      },
      ...otherRemoteParticipants.map((participant) => {
        return {
          audioEnabled: participant.audioEnabled,
          audioTrack: participant.audioTrack,
          displayName: resolveParticipantName(participant, participantDirectory),
          participantId: participant.customParticipantId ?? participant.id,
          videoEnabled: participant.videoEnabled,
          videoTrack: participant.videoTrack,
        } satisfies MeetingStageParticipantTile;
      }),
      ...props.syntheticParticipants.map((participant) => ({
        audioEnabled: participant.audio === "unmuted",
        displayName: participant.displayName,
        participantId: participant.participantId,
        videoEnabled: participant.video === "on",
      })),
    ],
    [
      otherRemoteParticipants,
      participantDirectory,
      props.participantDisplayName,
      props.participantId,
      props.syntheticParticipants,
      self.audioEnabled,
      self.videoEnabled,
      self.videoTrack,
    ],
  );
  const activeSpeakerParticipantId = useActiveSpeakerParticipantId(otherRemoteParticipants);
  const selfStageTile = stageParticipantTiles.find((tile) => tile.isSelf) ?? null;
  const nonSelfStageTiles = stageParticipantTiles.filter((tile) => !tile.isSelf);
  const activeSpeakerTile =
    stageParticipantTiles.find((tile) => tile.participantId && tile.participantId === activeSpeakerParticipantId) ??
    nonSelfStageTiles[0] ??
    null;
  const liveMediaStateByParticipantId = useMemo(() => {
    const nextState: Record<string, ParticipantMediaIndicators> = {};

    if (props.participantId) {
      nextState[props.participantId] = {
        audioEnabled: self.audioEnabled,
        screenShareEnabled: Boolean(self.screenShareEnabled),
        videoEnabled: self.videoEnabled,
      };
    }

    for (const participant of otherRemoteParticipants) {
      if (!participant.customParticipantId) {
        continue;
      }

      nextState[participant.customParticipantId] = {
        audioEnabled: participant.audioEnabled,
        screenShareEnabled: Boolean(participant.screenShareEnabled),
        videoEnabled: participant.videoEnabled,
      };
    }

    for (const participant of props.syntheticParticipants) {
      nextState[participant.participantId] = {
        audioEnabled: participant.audio === "unmuted",
        screenShareEnabled: false,
        videoEnabled: participant.video === "on",
      };
    }

    return nextState;
  }, [
    otherRemoteParticipants,
    props.participantId,
    props.syntheticParticipants,
    self.audioEnabled,
    self.screenShareEnabled,
    self.videoEnabled,
  ]);

  useEffect(() => {
    props.onLiveParticipantCountChange?.(liveParticipantCount);
  }, [liveParticipantCount, props.onLiveParticipantCountChange]);

  useEffect(() => {
    props.onLiveMediaStateChange?.(liveMediaStateByParticipantId);
  }, [liveMediaStateByParticipantId, props.onLiveMediaStateChange]);

  useEffect(() => {
    if (!self.screenShareEnabled || !selfScreenShareVideoTrack) {
      setIsShareActionPending(false);
      return;
    }

    const handleEnded = () => {
      setIsShareActionPending(false);
    };

    selfScreenShareVideoTrack.addEventListener("ended", handleEnded);
    return () => {
      selfScreenShareVideoTrack.removeEventListener("ended", handleEnded);
    };
  }, [self.screenShareEnabled, selfScreenShareVideoTrack]);

  async function handleStartScreenShare() {
    if (!shareSupported || shareDisabledReason || !self || isShareActionPending) {
      return;
    }

    setIsShareActionPending(true);

    try {
      await self.enableScreenShare();
      const started = await waitForScreenShareEnabled(self);

      if (!started) {
        setIsShareActionPending(false);
        return;
      }

      await applyActiveScreenShareConstraints(self);
      setIsShareActionPending(false);
      props.onMediaActionSuccess();
    } catch (error) {
      if (isScreenShareSelectionCancelled(error)) {
        setIsShareActionPending(false);
        return;
      }

      setIsShareActionPending(false);
      props.onMediaActionError("screenshare", error);
    }
  }

  async function handleStopScreenShare() {
    if (!self || !self.screenShareEnabled || isShareActionPending) {
      return;
    }

    setIsShareActionPending(true);

    try {
      await self.disableScreenShare();
      props.onMediaActionSuccess();
    } catch (error) {
      props.onMediaActionError("screenshare", error);
    } finally {
      setIsShareActionPending(false);
    }
  }

  function handleShareButtonClick() {
    if (self.screenShareEnabled) {
      void handleStopScreenShare();
      return;
    }

    if (shareDisabledReason || isShareActionPending) {
      return;
    }

    void handleStartScreenShare();
  }

  return (
    <div
      className={`meeting-stage-runtime${primaryScreenShare ? " meeting-stage-runtime--sharing" : ""}${showImmersiveSoloStage ? " meeting-stage-runtime--solo" : ""}${props.toolStage ? " meeting-stage-runtime--tool-open" : ""}`}
    >
      {props.toolStage ? (
        <>
          <MeetingToolStageShell
            activeSpeakerTile={activeSpeakerTile}
            selfTile={selfStageTile}
            toolStage={props.toolStage}
          />
          <HiddenParticipantAudio participants={otherRemoteParticipants} />
        </>
      ) : !roomJoined ? (
        <div className="meeting-stage-canvas meeting-stage-canvas--grid">
          <div className="stage-tiles" style={{ ["--stage-columns" as string]: "1" }}>
            <div className="stage-tiles__row" data-stage-row="1" data-stage-row-size="1">
              <article className="participant-tile participant-tile--empty">
                <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
                <div className="participant-tile__meta">
                  <strong>Joining the media room</strong>
                  <span>Your camera and microphone are still being connected.</span>
                </div>
              </article>
            </div>
          </div>
        </div>
      ) : (
        <MeetingStageScene
          activeSpeakerTile={activeSpeakerTile}
          immersiveSoloMode={showImmersiveSoloStage}
          participantTiles={stageParticipantTiles}
          primaryScreenShare={primaryScreenShare}
          speakerViewEnabled={props.stageViewMode === "speaker"}
          suppressParticipantAudio={props.stageViewMode === "speaker"}
        />
      )}

      {!props.toolStage && (primaryScreenShare || props.stageViewMode === "speaker") ? (
        <HiddenParticipantAudio participants={otherRemoteParticipants} />
      ) : null}

      <MediaToolbar
        extraControls={props.extraControls}
        mediaMessage={props.mediaMessage}
        mediaStatus={props.mediaStatus}
        onLeave={props.onLeave}
        onRetry={props.onRetry}
        onShareScreen={handleShareButtonClick}
        stageMessages={props.stageMessages}
        onToggleAudio={async () => {
          try {
            if (self.audioEnabled) {
              await self.disableAudio();
            } else {
              await self.enableAudio();
            }
            props.onMediaActionSuccess();
          } catch (error) {
            props.onMediaActionError("audio", error);
          }
        }}
        onToggleVideo={async () => {
          try {
            if (self.videoEnabled) {
              await self.disableVideo();
            } else {
              await self.enableVideo();
            }
            props.onMediaActionSuccess();
          } catch (error) {
            props.onMediaActionError("video", error);
          }
        }}
        screenShareActive={Boolean(self.screenShareEnabled)}
        screenShareDisabled={Boolean(!self.screenShareEnabled && shareDisabledReason)}
        screenShareTitle={
          self.screenShareEnabled
            ? "Stop sharing your screen"
            : shareDisabledReason ?? "Share your screen"
        }
        self={self}
      />
    </div>
  );
}

function MediaToolbar(props: {
  extraControls?: ReactNode;
  mediaMessage: string | null;
  mediaStatus: MediaStatus;
  onLeave?: () => void;
  onRetry(): void;
  onShareScreen: (() => void) | null;
  onToggleAudio: (() => Promise<void>) | null;
  onToggleVideo: (() => Promise<void>) | null;
  screenShareActive: boolean;
  screenShareDisabled: boolean;
  screenShareTitle: string;
  self: RTKSelf | null;
  stageMessages: Array<{ kind: "default" | "warning"; text: string }>;
}) {
  const visibleMessages = [
    ...props.stageMessages,
    ...(props.mediaMessage
      ? [
          {
            kind:
              props.mediaStatus === "error" || props.mediaStatus === "warning"
                ? ("warning" as const)
                : ("default" as const),
            text: props.mediaMessage,
          },
        ]
      : []),
  ];

  return (
    <div className="meeting-control-surface">
      {visibleMessages.map((message) => (
        <p
          className={`meeting-control-surface__message${message.kind === "warning" ? " meeting-control-surface__message--warning" : ""}`}
          key={`${message.kind}:${message.text}`}
        >
          {message.text}
        </p>
      ))}
      <div className="meeting-control-dock">
        <div className="meeting-control-dock__row meeting-control-dock__row--media">
          <MeetingControlButton
            active={Boolean(props.self?.audioEnabled)}
            disabled={!props.onToggleAudio}
            icon={props.self?.audioEnabled ? <MicrophoneIcon /> : <MicrophoneOffIcon />}
            label={props.self?.audioEnabled ? "Mic" : "Mic Off"}
            onClick={() => {
              void props.onToggleAudio?.();
            }}
          />
          <MeetingControlButton
            active={Boolean(props.self?.videoEnabled)}
            disabled={!props.onToggleVideo}
            icon={props.self?.videoEnabled ? <VideoCameraIcon /> : <VideoCameraOffIcon />}
            label={props.self?.videoEnabled ? "Camera" : "Camera Off"}
            onClick={() => {
              void props.onToggleVideo?.();
            }}
          />
          <MeetingControlButton
            active={props.screenShareActive}
            disabled={props.screenShareDisabled}
            icon={props.screenShareActive ? <PresentScreenIcon /> : <PresentScreenOffIcon />}
            label={props.screenShareActive ? "Sharing" : "Share Screen"}
            onClick={() => {
              props.onShareScreen?.();
            }}
            title={props.screenShareTitle}
          />
        </div>
        {props.extraControls || props.onLeave ? (
          <span aria-hidden="true" className="meeting-control-dock__separator meeting-control-dock__separator--group" />
        ) : null}
        {props.extraControls || props.onLeave ? (
          <div className="meeting-control-dock__row meeting-control-dock__row--secondary">
            {props.extraControls}
            {props.onLeave && props.extraControls ? (
              <span aria-hidden="true" className="meeting-control-dock__separator meeting-control-dock__separator--inline" />
            ) : null}
            {props.onLeave ? (
              <MeetingControlButton
                danger
                icon={<LeaveCallIcon />}
                label="Leave"
                onClick={props.onLeave}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StageFallback(props: {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  immersiveSoloMode?: boolean;
  meetingActive: boolean;
  mediaMessage: string | null;
  mediaStatus: MediaStatus;
  onLeave?: () => void;
  onLiveMediaStateChange?: (state: Record<string, ParticipantMediaIndicators>) => void;
  onLiveParticipantCountChange?: (count: number | null) => void;
  participantDisplayName: string;
  participantId: string | null;
  onRetry: (() => void) | null;
  screenShareDisabledReason: string | null;
  stageMessages: Array<{ kind: "default" | "warning"; text: string }>;
  stageViewMode: StageViewMode;
  syntheticParticipants: ParticipantState[];
  toolStage?: ReactNode;
}) {
  const visibleParticipants = useMemo(
    () => [...props.activeParticipants, ...props.syntheticParticipants],
    [props.activeParticipants, props.syntheticParticipants],
  );
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode && visibleParticipants.length === 1,
  );
  const fallbackStageTiles = useMemo<MeetingStageParticipantTile[]>(
    () =>
      visibleParticipants.map((participant) => ({
        audioEnabled: participant.audio === "unmuted",
        displayName: participant.displayName,
        isSelf: participant.participantId === props.participantId,
        participantId: participant.participantId,
        videoEnabled: participant.video === "on",
      })),
    [props.participantId, visibleParticipants],
  );
  const selfTile =
    fallbackStageTiles.find((tile) => tile.isSelf) ??
    {
      audioEnabled: false,
      displayName: props.participantDisplayName,
      isSelf: true,
      participantId: props.participantId,
      videoEnabled: false,
    };
  const activeSpeakerTile = fallbackStageTiles.find((tile) => !tile.isSelf) ?? null;

  useEffect(() => {
    props.onLiveParticipantCountChange?.(
      props.meetingActive ? visibleParticipants.length : null,
    );
  }, [props.meetingActive, props.onLiveParticipantCountChange, visibleParticipants.length]);

  useEffect(() => {
    const nextState = Object.fromEntries(
      visibleParticipants.map((participant) => [
        participant.participantId,
        {
          audioEnabled: participant.audio === "unmuted",
          screenShareEnabled: false,
          videoEnabled: participant.video === "on",
        } satisfies ParticipantMediaIndicators,
      ]),
    );

    props.onLiveMediaStateChange?.(nextState);
  }, [props.onLiveMediaStateChange, visibleParticipants]);

  return (
    <div className={`meeting-stage-runtime${showImmersiveSoloStage ? " meeting-stage-runtime--solo" : ""}${props.toolStage ? " meeting-stage-runtime--tool-open" : ""}`}>
      {props.toolStage ? (
        <MeetingToolStageShell activeSpeakerTile={activeSpeakerTile} selfTile={selfTile} toolStage={props.toolStage} />
      ) : fallbackStageTiles.length > 0 ? (
        <MeetingStageScene
          activeSpeakerTile={activeSpeakerTile}
          immersiveSoloMode={showImmersiveSoloStage}
          participantTiles={fallbackStageTiles}
          primaryScreenShare={null}
          speakerViewEnabled={props.stageViewMode === "speaker"}
        />
      ) : (
        <div className="meeting-stage-canvas meeting-stage-canvas--grid">
          <div className={`stage-tiles${showImmersiveSoloStage ? " stage-tiles--solo" : ""}`}>
            <div className="stage-tiles__row" data-stage-row="1" data-stage-row-size="1">
              <article className="participant-tile participant-tile--empty">
                <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
                <div className="participant-tile__meta">
                  <strong>{props.meetingActive ? "Waiting for people" : "Meeting not started"}</strong>
                  <span>
                    {props.meetingActive
                      ? "Joined participants will appear here as soon as they enter."
                      : "This room code exists, but no active meeting instance is attached yet."}
                  </span>
                </div>
              </article>
            </div>
          </div>
        </div>
      )}

      <MediaToolbar
        extraControls={props.extraControls}
        mediaMessage={props.mediaMessage}
        mediaStatus={props.mediaStatus}
        onLeave={props.onLeave}
        onRetry={props.onRetry ?? (() => {})}
        onShareScreen={null}
        onToggleAudio={null}
        onToggleVideo={null}
        screenShareActive={false}
        screenShareDisabled
        screenShareTitle={props.screenShareDisabledReason ?? "Join the room to share your screen."}
        self={null}
        stageMessages={props.stageMessages}
      />
    </div>
  );
}

export function MeetingToolStageShell(props: {
  activeSpeakerTile: MeetingStageParticipantTile | null;
  selfTile: MeetingStageParticipantTile | null;
  toolStage: ReactNode;
}) {
  return (
    <div className="meeting-tool-stage">
      <div className="meeting-tool-stage__surface">{props.toolStage}</div>
      <StagePipStack
        activeSpeakerTile={props.activeSpeakerTile}
        placement="bottom-right"
        selfTile={props.selfTile}
        showSelf={Boolean(props.selfTile)}
      />
    </div>
  );
}

function HiddenParticipantAudio(props: { participants: RTKParticipant[] }) {
  return (
    <>
      {props.participants.map((participant) =>
        participant.audioTrack ? (
          <RemoteAudioSink
            audioEnabled={participant.audioEnabled}
            audioTrack={participant.audioTrack}
            key={participant.customParticipantId ?? participant.id}
          />
        ) : null,
      )}
    </>
  );
}

function RemoteAudioSink(props: { audioEnabled: boolean; audioTrack: MediaStreamTrack }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    if (props.audioEnabled) {
      audioRef.current.srcObject = new MediaStream([props.audioTrack]);
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioEnabled, props.audioTrack]);

  return <audio autoPlay className="sr-only" ref={audioRef} />;
}

function useActiveSpeakerParticipantId(participants: RTKParticipant[]): string | null {
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(null);
  const activeParticipantIdRef = useRef<string | null>(null);

  useEffect(() => {
    const audioParticipants = participants.filter((participant) => participant.audioEnabled && participant.audioTrack);
    if (!audioParticipants.length) {
      activeParticipantIdRef.current = null;
      setActiveParticipantId(null);
      return;
    }

    const currentIds = new Set(audioParticipants.map((participant) => participant.customParticipantId ?? participant.id));
    if (activeParticipantIdRef.current && !currentIds.has(activeParticipantIdRef.current)) {
      activeParticipantIdRef.current = null;
      setActiveParticipantId(null);
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      const nextId = audioParticipants[0].customParticipantId ?? audioParticipants[0].id;
      activeParticipantIdRef.current = nextId;
      setActiveParticipantId(nextId);
      return;
    }

    const context = new AudioContextConstructor();
    const analysers = audioParticipants.map((participant) => {
      const source = context.createMediaStreamSource(new MediaStream([participant.audioTrack as MediaStreamTrack]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      return {
        analyser,
        data: new Uint8Array(analyser.fftSize),
        id: participant.customParticipantId ?? participant.id,
        source,
      };
    });

    void context.resume().catch(() => {});
    const intervalId = window.setInterval(() => {
      let best: { id: string; level: number } | null = null;

      for (const entry of analysers) {
        entry.analyser.getByteTimeDomainData(entry.data);
        const level = getAudioLevel(entry.data);
        if (!best || level > best.level) {
          best = { id: entry.id, level };
        }
      }

      if (best && best.level > 5) {
        activeParticipantIdRef.current = best.id;
        setActiveParticipantId(best.id);
      }
    }, 120);

    return () => {
      window.clearInterval(intervalId);
      for (const entry of analysers) {
        entry.source.disconnect();
      }
      void context.close().catch(() => {});
    };
  }, [participants]);

  return activeParticipantId;
}

function getAudioLevel(data: Uint8Array): number {
  let sum = 0;
  for (const value of data) {
    const centered = value - 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

function buildStageScreenShares(input: {
  participantDirectory: Map<string, ParticipantState>;
  participantDisplayName: string;
  remoteParticipants: RTKParticipant[];
  self: RTKSelf;
}): StageScreenShare[] {
  const stageShares: StageScreenShare[] = [];

  const selfShareTrack = getScreenShareVideoTrack(input.self);
  if (input.self.screenShareEnabled && selfShareTrack) {
    stageShares.push({
      audioTrack: getScreenShareAudioTrack(input.self),
      displayName: input.participantDisplayName,
      isSelf: true,
      videoTrack: selfShareTrack,
    });
  }

  for (const participant of input.remoteParticipants) {
    const remoteShareTrack = getScreenShareVideoTrack(participant);
    if (!participant.screenShareEnabled || !remoteShareTrack) {
      continue;
    }

    stageShares.push({
      audioTrack: getScreenShareAudioTrack(participant),
      displayName: resolveParticipantName(participant, input.participantDirectory),
      videoTrack: remoteShareTrack,
    });
  }

  return stageShares;
}

function resolveParticipantName(
  participant: RTKParticipant,
  directory: Map<string, ParticipantState>,
): string {
  if (participant.customParticipantId) {
    return directory.get(participant.customParticipantId)?.displayName ?? participant.name;
  }

  return participant.name;
}

async function leaveMediaClient(client: MediaClient): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.leaveRoom();
  } catch {}
}

function getMediaReadyMessage(
  audioResult: PromiseSettledResult<void>,
  videoResult: PromiseSettledResult<void>,
): string | null {
  const audioReady = audioResult.status === "fulfilled";
  const videoReady = videoResult.status === "fulfilled";

  if (audioReady && videoReady) {
    return null;
  }

  if (audioReady) {
    return "Joined live media. Camera access is still off.";
  }

  if (videoReady) {
    return "Joined live media. Microphone access is still off.";
  }

  return "Joined the room without camera or microphone access. You can retry media at any time.";
}

function toMediaErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `Live media failed: ${error.message}`;
  }

  return "Live media failed to connect.";
}

function getMediaActionErrorMessage(kind: MediaActionKind, error: unknown): string {
  const message = normaliseMediaErrorMessage(error);

  if (kind === "audio") {
    if (message && /(unmute|audio|microphone|mic)/i.test(message)) {
      return "Microphone could not be enabled. Check browser or device permissions and try again.";
    }

    return "Microphone could not be updated. Check browser or device permissions and try again.";
  }

  if (kind === "video") {
    if (message && /(video|camera)/i.test(message)) {
      return "Camera could not be enabled. Check browser or device permissions and try again.";
    }

    return "Camera could not be updated. Check browser or device permissions and try again.";
  }

  if (message && /(screen|window|display|screenshare|share)/i.test(message)) {
    return "Screen sharing could not be started. Check browser permissions and choose a source again.";
  }

  return "Screen sharing could not be updated. Try again in a moment.";
}

function reportMediaException(
  error: unknown,
  context: {
    kind: MediaActionKind;
    stage: "toggle";
  },
) {
  if (isExpectedLocalMediaIssue(error)) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag("media_action_kind", context.kind);
    scope.setTag("media_action_stage", context.stage);
    Sentry.captureException(error);
  });
}

function reportMediaConnectionException(
  error: unknown,
  context: {
    attemptNumber: number;
    stage: "init" | "join";
  },
) {
  const message = normaliseMediaErrorMessage(error);
  if (message && /internet_disconnected/i.test(message)) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag("media_connection_attempt", String(context.attemptNumber));
    scope.setTag("media_connection_recoverable", String(isRecoverableMediaConnectionError(error)));
    scope.setTag("media_connection_stage", context.stage);
    Sentry.captureException(error);
  });
}

function isExpectedLocalMediaIssue(error: unknown): boolean {
  const message = normaliseMediaErrorMessage(error);
  return Boolean(
    message &&
      /(localmediahandler|failed to unmute track|failed to get video track|failed to get screenshare tracks|could not start video source|could not start audio source|notallowederror|notreadableerror|overconstrainederror|canceled|denied)/i
        .test(message),
  );
}

function isScreenShareSelectionCancelled(error: unknown): boolean {
  const message = normaliseMediaErrorMessage(error);
  return Boolean(message && /(aborterror|notallowederror|canceled|cancelled|denied)/i.test(message));
}

function normaliseMediaErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "string") {
    return error.trim();
  }

  return "";
}

function isRecoverableMediaConnectionError(error: unknown): boolean {
  const message = normaliseMediaErrorMessage(error);
  return Boolean(
    message &&
      /(joining the media room timed out|media client initialisation timed out|internet_disconnected|networkerror|failed to initialize|could not connect to media servers|socket|reconnect|temporarily unavailable|\[err0001\]|\[err0002\])/i.test(
        message,
      ),
  );
}

function handleMediaConnectionFailure(
  error: unknown,
  input: {
    attemptNumber: number;
    onRetry(): void;
    setMediaMessage(message: string): void;
    setMediaStatus(status: MediaStatus): void;
  },
): { phase: MediaConnectionPhase; recoverable: boolean } {
  const recoverable = isRecoverableMediaConnectionError(error);

  if (recoverable && input.attemptNumber < MAX_MEDIA_CONNECTION_ATTEMPTS) {
    input.setMediaStatus("warning");
    input.setMediaMessage("Live media connection was interrupted. Retrying...");
    input.onRetry();
    return { phase: "warning", recoverable };
  }

  input.setMediaStatus("error");
  input.setMediaMessage(toMediaErrorMessage(error));
  return { phase: "error", recoverable };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]);
}

async function joinMediaRoomWithProgress(
  client: NonNullable<MediaClient>,
  options: {
    hardTimeoutMs: number;
    onSlow?(): void;
    softTimeoutMs: number;
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const complete = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      if (slowTimeoutId) {
        window.clearTimeout(slowTimeoutId);
      }
      if (hardTimeoutId) {
        window.clearTimeout(hardTimeoutId);
      }
      client.self.off("roomJoined", handleRoomJoined);
      callback();
    };
    const handleRoomJoined = () => {
      complete(resolve);
    };
    const slowTimeoutId = window.setTimeout(() => {
      options.onSlow?.();
    }, options.softTimeoutMs);
    const hardTimeoutId = window.setTimeout(() => {
      complete(() => {
        reject(new Error("Joining the media room timed out."));
      });
    }, options.hardTimeoutMs);

    client.self.on("roomJoined", handleRoomJoined);
    void client.joinRoom().then(
      () => {
        complete(resolve);
      },
      (error) => {
        complete(() => {
          reject(error);
        });
      },
    );
  });
}

async function waitForScreenShareEnabled(self: RTKSelf, timeoutMs = 900): Promise<boolean> {
  const deadline = window.performance.now() + timeoutMs;

  while (window.performance.now() < deadline) {
    if (self.screenShareEnabled && Boolean(getScreenShareVideoTrack(self))) {
      return true;
    }

    await waitFor(50);
  }

  return self.screenShareEnabled && Boolean(getScreenShareVideoTrack(self));
}

async function applyActiveScreenShareConstraints(self: RTKSelf): Promise<void> {
  try {
    await self.updateScreenshareConstraints({
      frameRate: {
        ideal: BASE_SCREEN_SHARE_CONFIGURATION.frameRate.ideal,
      },
      height: {
        ideal: BASE_SCREEN_SHARE_CONFIGURATION.height.max,
      },
      width: {
        ideal: BASE_SCREEN_SHARE_CONFIGURATION.width.max,
      },
    });
  } catch {
    // Browsers may ignore or partially support runtime constraint updates.
  }
}

async function waitFor(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function getScreenShareVideoTrack(
  participant: Pick<RTKSelf, "screenShareTracks"> | Pick<RTKParticipant, "screenShareTracks">,
): MediaStreamTrack | null {
  return participant.screenShareTracks?.video ?? null;
}

function getScreenShareAudioTrack(
  participant: Pick<RTKSelf, "screenShareTracks"> | Pick<RTKParticipant, "screenShareTracks">,
): MediaStreamTrack | null {
  return participant.screenShareTracks?.audio ?? null;
}
