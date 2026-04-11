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
  type MeetingStageParticipantTile,
  type MeetingStageShareSourceMeta,
} from "./MeetingStageScene";
import { MeetingControlButton } from "./MeetingControlButton";
import {
  LeaveCallIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PresentScreenIcon,
  RefreshIcon,
  VideoCameraIcon,
  VideoCameraOffIcon,
} from "./MeetingRoomIcons";
import type { ParticipantMediaIndicators } from "./MeetingParticipantsPanel";

type MediaStatus = "idle" | "connecting" | "connected" | "warning" | "error";
type MediaActionKind = "audio" | "video" | "screenshare";
type MediaClient = Awaited<ReturnType<ReturnType<typeof useRealtimeKitClient>[1]>> | undefined;
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
  source: MeetingStageShareSourceMeta;
  videoTrack?: MediaStreamTrack | null;
}

interface MeetingMediaStageProps {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  immersiveSoloMode?: boolean;
  meetingActive: boolean;
  meetingId: string | null;
  onLeave?: () => void;
  onLiveMediaStateChange?: (state: Record<string, ParticipantMediaIndicators>) => void;
  onLiveParticipantCountChange?: (count: number | null) => void;
  participantDisplayName: string;
  participantId: string | null;
  participantRole: string;
  screenShareDisabledReason?: string | null;
  stageMessages?: Array<{ kind: "default" | "warning"; text: string }>;
  shouldConnect: boolean;
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

export function MeetingMediaStage(props: MeetingMediaStageProps) {
  const [client, initClient] = useRealtimeKitClient({ resetOnLeave: true });
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const clientRef = useRef<MediaClient>(undefined);
  const connectionKeyRef = useRef<string | null>(null);
  const mediaConfigurationRef = useRef<{ screenshare: ScreenshareConfiguration }>({
    screenshare: {
      ...BASE_SCREEN_SHARE_CONFIGURATION,
    },
  });

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    return () => {
      void leaveMediaClient(clientRef.current);
    };
  }, []);

  useEffect(() => {
    if (!props.shouldConnect || !props.meetingId || !props.participantId) {
      connectionKeyRef.current = null;
      setMediaStatus("idle");
      setMediaMessage(null);
      void leaveMediaClient(clientRef.current);
      return;
    }

    const connectionKey = [
      props.meetingId,
      props.participantId,
      props.participantDisplayName,
      props.participantRole,
      retryNonce,
    ].join(":");
    if (connectionKeyRef.current === connectionKey) {
      return;
    }

    connectionKeyRef.current = connectionKey;
    let cancelled = false;

    void (async () => {
      setMediaStatus("connecting");
      setMediaMessage("Requesting live media session...");
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
        return;
      }

      let nextClient: MediaClient;
      try {
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
          15_000,
          "Media client initialisation timed out.",
        );
      } catch (error) {
        Sentry.captureException(error);
        setMediaStatus("error");
        setMediaMessage(toMediaErrorMessage(error));
        return;
      }

      if (!nextClient) {
        setMediaStatus("error");
        setMediaMessage("Live media client could not be created.");
        return;
      }

      if (cancelled) {
        await leaveMediaClient(nextClient);
        return;
      }

      try {
        nextClient.self.setName(props.participantDisplayName);
        setMediaMessage("Joining live media room...");
        await withTimeout(nextClient.joinRoom(), 15_000, "Joining the media room timed out.");

        setMediaMessage("Enabling camera and microphone...");
        const [audioResult, videoResult] = await Promise.allSettled([
          nextClient.self.enableAudio(),
          nextClient.self.enableVideo(),
        ]);

        if (cancelled) {
          await leaveMediaClient(nextClient);
          return;
        }

        setMediaStatus("connected");
        setMediaMessage(getMediaReadyMessage(audioResult, videoResult));
      } catch (error) {
        Sentry.captureException(error);
        setMediaStatus("error");
        setMediaMessage(toMediaErrorMessage(error));
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
      onRetry={
        props.shouldConnect
          ? () => {
              setRetryNonce((current) => current + 1);
            }
          : null
      }
      screenShareDisabledReason={props.screenShareDisabledReason ?? null}
      stageMessages={props.stageMessages ?? []}
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
            setRetryNonce((current) => current + 1);
          }}
          immersiveSoloMode={props.immersiveSoloMode}
          participantDisplayName={props.participantDisplayName}
          participantId={props.participantId}
          screenShareDisabledReason={props.screenShareDisabledReason ?? null}
          stageMessages={props.stageMessages ?? []}
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
}) {
  const roomJoined = useRealtimeKitSelector((currentMeeting) => currentMeeting.self.roomJoined);
  const self = useRealtimeKitSelector((currentMeeting) => currentMeeting.self);
  const remoteParticipants = useRealtimeKitSelector((currentMeeting) =>
    currentMeeting.participants.active.toArray(),
  );
  const [isShareActionPending, setIsShareActionPending] = useState(false);
  const [selfShareSource, setSelfShareSource] = useState<MeetingStageShareSourceMeta | null>(null);
  const participantDirectory = useMemo(
    () => new Map(props.activeParticipants.map((participant) => [participant.participantId, participant])),
    [props.activeParticipants],
  );
  const otherRemoteParticipants = remoteParticipants.filter(
    (participant) => participant.id !== self.id && participant.customParticipantId !== self.customParticipantId,
  );
  const shareSupported = useMemo(
    () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia),
    [],
  );
  const selfScreenShareVideoTrack = getScreenShareVideoTrack(self);
  const selfScreenShareAudioTrack = getScreenShareAudioTrack(self);
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
        selfShareSource,
      }),
    [otherRemoteParticipants, participantDirectory, props.participantDisplayName, self, selfShareSource],
  );
  const primaryScreenShare = stageScreenShares[0] ?? null;
  const additionalShareCount = Math.max(stageScreenShares.length - 1, 0);
  const liveParticipantCount = roomJoined ? 1 + otherRemoteParticipants.length : null;
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode &&
      roomJoined &&
      !primaryScreenShare &&
      otherRemoteParticipants.length === 0,
  );
  const stageParticipantTiles = useMemo<MeetingStageParticipantTile[]>(
    () => [
      {
        audioEnabled: self.audioEnabled,
        displayName: props.participantDisplayName,
        isSelf: true,
        shareBadgeLabel:
          self.screenShareEnabled && selfShareSource ? getShareBadgeLabel(selfShareSource) : null,
        subtitle: buildTileSubtitle(self.audioEnabled, self.videoEnabled, true),
        videoEnabled: self.videoEnabled,
        videoTrack: self.videoTrack,
      },
      ...otherRemoteParticipants.map((participant) => {
        const remoteShareTrack = participant.screenShareEnabled ? getScreenShareVideoTrack(participant) : null;
        const remoteShareSource = remoteShareTrack
          ? describeScreenShareSource(remoteShareTrack, getScreenShareAudioTrack(participant))
          : null;

        return {
          audioEnabled: participant.audioEnabled,
          audioTrack: participant.audioTrack,
          displayName: resolveParticipantName(participant, participantDirectory),
          shareBadgeLabel: remoteShareSource ? getShareBadgeLabel(remoteShareSource) : null,
          subtitle: buildTileSubtitle(participant.audioEnabled, participant.videoEnabled, false),
          videoEnabled: participant.videoEnabled,
          videoTrack: participant.videoTrack,
        } satisfies MeetingStageParticipantTile;
      }),
    ],
    [
      otherRemoteParticipants,
      participantDirectory,
      props.participantDisplayName,
      self.audioEnabled,
      self.screenShareEnabled,
      self.videoEnabled,
      self.videoTrack,
      selfShareSource,
    ],
  );
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

    return nextState;
  }, [
    otherRemoteParticipants,
    props.participantId,
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
      setSelfShareSource(null);
      return;
    }

    setSelfShareSource(describeScreenShareSource(
      selfScreenShareVideoTrack,
      selfScreenShareAudioTrack,
    ));
  }, [self.screenShareEnabled, selfScreenShareAudioTrack, selfScreenShareVideoTrack]);

  useEffect(() => {
    if (!self.screenShareEnabled || !selfScreenShareVideoTrack) {
      setIsShareActionPending(false);
      return;
    }

    const handleEnded = () => {
      setIsShareActionPending(false);
      setSelfShareSource(null);
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
        setSelfShareSource(null);
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
      setSelfShareSource(null);
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
      className={`meeting-stage-runtime${primaryScreenShare ? " meeting-stage-runtime--sharing" : ""}${showImmersiveSoloStage ? " meeting-stage-runtime--solo" : ""}`}
    >
      {!roomJoined ? (
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
          immersiveSoloMode={showImmersiveSoloStage}
          participantTiles={stageParticipantTiles}
          primaryScreenShare={
            primaryScreenShare
              ? {
                  ...primaryScreenShare,
                  extraShareCount: additionalShareCount,
                }
              : null
          }
        />
      )}

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
        <div className="meeting-control-dock__cluster">
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
            icon={<PresentScreenIcon />}
            label={props.screenShareActive ? "Sharing" : "Share Screen"}
            onClick={() => {
              props.onShareScreen?.();
            }}
            title={props.screenShareTitle}
          />
          {props.mediaStatus === "error" ? (
            <MeetingControlButton
              icon={<RefreshIcon />}
              label="Retry"
              onClick={props.onRetry}
            />
          ) : null}
        </div>
        <div className="meeting-control-dock__cluster meeting-control-dock__cluster--secondary">
          {props.extraControls}
          {props.onLeave ? (
            <MeetingControlButton
              danger
              icon={<LeaveCallIcon />}
              label="Leave"
              onClick={props.onLeave}
            />
          ) : null}
        </div>
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
  onRetry: (() => void) | null;
  screenShareDisabledReason: string | null;
  stageMessages: Array<{ kind: "default" | "warning"; text: string }>;
}) {
  const showImmersiveSoloStage = Boolean(
    props.immersiveSoloMode && props.activeParticipants.length === 1,
  );
  const fallbackStageTiles = useMemo<MeetingStageParticipantTile[]>(
    () =>
      props.activeParticipants.map((participant) => ({
        audioEnabled: participant.audio === "unmuted",
        displayName: participant.displayName,
        subtitle: `${participant.audio} audio / ${participant.video} video`,
        videoEnabled: participant.video === "on",
      })),
    [props.activeParticipants],
  );

  useEffect(() => {
    props.onLiveParticipantCountChange?.(
      props.meetingActive ? props.activeParticipants.length : null,
    );
  }, [props.activeParticipants.length, props.meetingActive, props.onLiveParticipantCountChange]);

  useEffect(() => {
    const nextState = Object.fromEntries(
      props.activeParticipants.map((participant) => [
        participant.participantId,
        {
          audioEnabled: participant.audio === "unmuted",
          screenShareEnabled: false,
          videoEnabled: participant.video === "on",
        } satisfies ParticipantMediaIndicators,
      ]),
    );

    props.onLiveMediaStateChange?.(nextState);
  }, [props.activeParticipants, props.onLiveMediaStateChange]);

  return (
    <div className={`meeting-stage-runtime${showImmersiveSoloStage ? " meeting-stage-runtime--solo" : ""}`}>
      {fallbackStageTiles.length > 0 ? (
        <MeetingStageScene
          immersiveSoloMode={showImmersiveSoloStage}
          participantTiles={fallbackStageTiles}
          primaryScreenShare={null}
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

function buildStageScreenShares(input: {
  participantDirectory: Map<string, ParticipantState>;
  participantDisplayName: string;
  remoteParticipants: RTKParticipant[];
  self: RTKSelf;
  selfShareSource: MeetingStageShareSourceMeta | null;
}): StageScreenShare[] {
  const stageShares: StageScreenShare[] = [];

  const selfShareTrack = getScreenShareVideoTrack(input.self);
  if (input.self.screenShareEnabled && selfShareTrack) {
    stageShares.push({
      audioTrack: getScreenShareAudioTrack(input.self),
      displayName: input.participantDisplayName,
      isSelf: true,
      source: input.selfShareSource ?? describeScreenShareSource(selfShareTrack, getScreenShareAudioTrack(input.self)),
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
      source: describeScreenShareSource(remoteShareTrack, getScreenShareAudioTrack(participant)),
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

function buildTileSubtitle(audioEnabled: boolean, videoEnabled: boolean, isSelf: boolean): string {
  const prefix = isSelf ? "Live preview" : "Live";
  return `${prefix} / ${audioEnabled ? "mic on" : "mic off"} / ${videoEnabled ? "camera on" : "camera off"}`;
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
): string {
  const audioReady = audioResult.status === "fulfilled";
  const videoReady = videoResult.status === "fulfilled";

  if (audioReady && videoReady) {
    return "Camera and microphone are live.";
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

function describeScreenShareSource(
  videoTrack: MediaStreamTrack,
  audioTrack?: MediaStreamTrack | null,
): MeetingStageShareSourceMeta {
  const settings = typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : {};
  const surface = normaliseDisplaySurface(settings.displaySurface);
  const defaultLabel = getDefaultShareLabel(surface);
  const nextLabel = videoTrack.label?.trim() || defaultLabel;

  return {
    audioIncluded: Boolean(audioTrack),
    displaySurface: surface,
    label: nextLabel,
    sourceId: videoTrack.id,
  };
}

function normaliseDisplaySurface(
  displaySurface: string | undefined,
): MeetingStageShareSourceMeta["displaySurface"] {
  if (displaySurface === "window") {
    return "application";
  }

  if (displaySurface === "monitor") {
    return "screen";
  }

  if (displaySurface === "browser") {
    return "browser";
  }

  return "unknown";
}

function getDefaultShareLabel(surface: MeetingStageShareSourceMeta["displaySurface"]): string {
  if (surface === "application") {
    return "Application window";
  }

  if (surface === "screen") {
    return "Entire screen";
  }

  if (surface === "browser") {
    return "Browser tab";
  }

  return "Shared surface";
}

function getShareBadgeLabel(source: MeetingStageShareSourceMeta): string {
  if (source.displaySurface === "application") {
    return "Sharing Application";
  }

  if (source.displaySurface === "screen") {
    return "Sharing Screen";
  }

  if (source.displaySurface === "browser") {
    return "Sharing Tab";
  }

  return "Sharing";
}
