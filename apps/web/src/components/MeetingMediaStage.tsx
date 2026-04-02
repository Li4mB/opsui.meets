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
import { MeetingControlButton } from "./MeetingControlButton";
import { type ShareSourceIntent, MeetingScreenSharePicker } from "./MeetingScreenSharePicker";
import {
  LeaveCallIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PresentScreenIcon,
  RefreshIcon,
  VideoCameraIcon,
  VideoCameraOffIcon,
} from "./MeetingRoomIcons";

type MediaStatus = "idle" | "connecting" | "connected" | "warning" | "error";
type MediaActionKind = "audio" | "video" | "screenshare";
type MediaClient = Awaited<ReturnType<ReturnType<typeof useRealtimeKitClient>[1]>> | undefined;
type ScreenShareSurface = "application" | "screen" | "browser" | "unknown";
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

interface ScreenShareSourceMeta {
  audioIncluded: boolean;
  displaySurface: ScreenShareSurface;
  label: string;
  sourceId: string;
}

interface StageScreenShare {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  source: ScreenShareSourceMeta;
  videoTrack: MediaStreamTrack;
}

interface MeetingMediaStageProps {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  meetingActive: boolean;
  meetingId: string | null;
  onLeave?: () => void;
  participantDisplayName: string;
  participantId: string | null;
  participantRole: string;
  screenShareDisabledReason?: string | null;
  shouldConnect: boolean;
}

const BASE_SCREEN_SHARE_CONFIGURATION: ScreenshareConfiguration = {
  frameRate: {
    ideal: 8,
    max: 12,
  },
  height: {
    max: 2160,
  },
  selfBrowserSurface: "exclude",
  width: {
    max: 3840,
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
      meetingActive={props.meetingActive}
      mediaMessage={mediaMessage}
      mediaStatus={mediaStatus}
      onLeave={props.onLeave}
      onRetry={
        props.shouldConnect
          ? () => {
              setRetryNonce((current) => current + 1);
            }
          : null
      }
      screenShareDisabledReason={props.screenShareDisabledReason ?? null}
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
          onPrepareScreenShareIntent={(intent) => {
            applyScreenShareIntentConfiguration(mediaConfigurationRef.current, intent);
          }}
          onRetry={() => {
            setRetryNonce((current) => current + 1);
          }}
          participantDisplayName={props.participantDisplayName}
          participantId={props.participantId}
          screenShareDisabledReason={props.screenShareDisabledReason ?? null}
        />
      </RealtimeKitProvider>
    </div>
  );
}

function ConnectedMediaStage(props: {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  mediaMessage: string | null;
  mediaStatus: MediaStatus;
  onMediaActionError(kind: MediaActionKind, error: unknown): void;
  onMediaActionSuccess(): void;
  onLeave?: () => void;
  onPrepareScreenShareIntent(intent: ShareSourceIntent): void;
  onRetry(): void;
  participantDisplayName: string;
  participantId: string | null;
  screenShareDisabledReason: string | null;
}) {
  const roomJoined = useRealtimeKitSelector((currentMeeting) => currentMeeting.self.roomJoined);
  const self = useRealtimeKitSelector((currentMeeting) => currentMeeting.self);
  const remoteParticipants = useRealtimeKitSelector((currentMeeting) =>
    currentMeeting.participants.active.toArray(),
  );
  const [isSharePickerOpen, setIsSharePickerOpen] = useState(false);
  const [isShareActionPending, setIsShareActionPending] = useState(false);
  const [pendingShareIntent, setPendingShareIntent] = useState<ShareSourceIntent | null>(null);
  const [selfShareSource, setSelfShareSource] = useState<ScreenShareSourceMeta | null>(null);
  const participantDirectory = useMemo(
    () => new Map(props.activeParticipants.map((participant) => [participant.participantId, participant])),
    [props.activeParticipants],
  );
  const visibleRemoteParticipants = remoteParticipants
    .filter((participant) => participant.id !== self.id && participant.customParticipantId !== self.customParticipantId)
    .slice(0, 3);
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
        remoteParticipants: visibleRemoteParticipants,
        self,
        selfShareSource,
      }),
    [participantDirectory, props.participantDisplayName, self, selfShareSource, visibleRemoteParticipants],
  );
  const primaryScreenShare = stageScreenShares[0] ?? null;
  const additionalShareCount = Math.max(stageScreenShares.length - 1, 0);

  useEffect(() => {
    if (!isSharePickerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isShareActionPending) {
        setIsSharePickerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShareActionPending, isSharePickerOpen]);

  useEffect(() => {
    if (!self.screenShareEnabled || !selfScreenShareVideoTrack) {
      setSelfShareSource(null);
      return;
    }

    setSelfShareSource(describeScreenShareSource(
      selfScreenShareVideoTrack,
      selfScreenShareAudioTrack,
      pendingShareIntent,
    ));
  }, [pendingShareIntent, self.screenShareEnabled, selfScreenShareAudioTrack, selfScreenShareVideoTrack]);

  useEffect(() => {
    if (!self.screenShareEnabled || !selfScreenShareVideoTrack) {
      setIsShareActionPending(false);
      setIsSharePickerOpen(false);
      if (!self.screenShareEnabled) {
        setPendingShareIntent(null);
      }
      return;
    }

    const handleEnded = () => {
      setIsShareActionPending(false);
      setIsSharePickerOpen(false);
      setPendingShareIntent(null);
      setSelfShareSource(null);
    };

    selfScreenShareVideoTrack.addEventListener("ended", handleEnded);
    return () => {
      selfScreenShareVideoTrack.removeEventListener("ended", handleEnded);
    };
  }, [self.screenShareEnabled, selfScreenShareVideoTrack]);

  async function handleStartScreenShare(intent: ShareSourceIntent) {
    if (!shareSupported || shareDisabledReason || !self || isShareActionPending) {
      return;
    }

    // Browsers keep the real source list inside the native picker. We only
    // store the user's intent here so the browser can present the closest source set.
    props.onPrepareScreenShareIntent(intent);
    setPendingShareIntent(intent);
    setIsShareActionPending(true);

    try {
      await self.enableScreenShare();
      const started = await waitForScreenShareEnabled(self);

      if (!started) {
        setIsShareActionPending(false);
        setIsSharePickerOpen(false);
        setPendingShareIntent(null);
        return;
      }

      setIsShareActionPending(false);
      setIsSharePickerOpen(false);
      props.onMediaActionSuccess();
    } catch (error) {
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
      setIsSharePickerOpen(false);
      setPendingShareIntent(null);
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

    setIsSharePickerOpen((current) => !current);
  }

  const stageTiles = (
    <div className={`stage-tiles${primaryScreenShare ? " stage-tiles--supporting" : ""}`}>
      <MediaTile
        audioEnabled={self.audioEnabled}
        displayName={props.participantDisplayName}
        isSelf
        shareBadgeLabel={self.screenShareEnabled && selfShareSource ? getShareBadgeLabel(selfShareSource) : null}
        subtitle={buildTileSubtitle(self.audioEnabled, self.videoEnabled, true)}
        videoEnabled={self.videoEnabled}
        videoTrack={self.videoTrack}
      />

      {visibleRemoteParticipants.map((participant) => {
        const remoteShareTrack = participant.screenShareEnabled ? getScreenShareVideoTrack(participant) : null;
        const remoteShareSource = remoteShareTrack
          ? describeScreenShareSource(remoteShareTrack, getScreenShareAudioTrack(participant))
          : null;

        return (
          <MediaTile
            audioEnabled={participant.audioEnabled}
            audioTrack={participant.audioTrack}
            displayName={resolveParticipantName(participant, participantDirectory)}
            key={participant.id}
            shareBadgeLabel={remoteShareSource ? getShareBadgeLabel(remoteShareSource) : null}
            subtitle={buildTileSubtitle(participant.audioEnabled, participant.videoEnabled, false)}
            videoEnabled={participant.videoEnabled}
            videoTrack={participant.videoTrack}
          />
        );
      })}

      {!visibleRemoteParticipants.length ? (
        <article className="participant-tile participant-tile--empty">
          <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
          <div className="participant-tile__meta">
            <strong>Waiting for more people</strong>
            <span>Live participants will appear here as soon as they connect media.</span>
          </div>
        </article>
      ) : null}
    </div>
  );

  return (
    <div className={`meeting-stage-runtime${primaryScreenShare ? " meeting-stage-runtime--sharing" : ""}`}>
      <MeetingScreenSharePicker
        busy={isShareActionPending}
        disabledReason={shareDisabledReason}
        onChooseIntent={(intent) => {
          void handleStartScreenShare(intent);
        }}
        onClose={() => {
          if (!isShareActionPending) {
            setIsSharePickerOpen(false);
          }
        }}
        open={isSharePickerOpen}
      />

      {!roomJoined ? (
        <div className="meeting-stage-canvas">
          <div className="stage-tiles">
            <article className="participant-tile participant-tile--empty">
              <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
              <div className="participant-tile__meta">
                <strong>Joining the media room</strong>
                <span>Your camera and microphone are still being connected.</span>
              </div>
            </article>
          </div>
        </div>
      ) : (
        <div className={`meeting-stage-canvas${primaryScreenShare ? " meeting-stage-canvas--sharing" : ""}`}>
          {primaryScreenShare ? (
            <ScreenShareTile
              audioTrack={primaryScreenShare.audioTrack}
              displayName={primaryScreenShare.displayName}
              extraShareCount={additionalShareCount}
              isSelf={primaryScreenShare.isSelf}
              source={primaryScreenShare.source}
              videoTrack={primaryScreenShare.videoTrack}
            />
          ) : null}

          {stageTiles}
        </div>
      )}

      <MediaToolbar
        extraControls={props.extraControls}
        mediaMessage={props.mediaMessage}
        mediaStatus={props.mediaStatus}
        onLeave={props.onLeave}
        onRetry={props.onRetry}
        onShareScreen={handleShareButtonClick}
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
}) {
  return (
    <div className="meeting-control-surface">
      {props.mediaMessage ? (
        <p className={`meeting-control-surface__message${props.mediaStatus === "error" || props.mediaStatus === "warning" ? " meeting-control-surface__message--warning" : ""}`}>
          {props.mediaMessage}
        </p>
      ) : null}
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

function MediaTile(props: {
  audioEnabled: boolean;
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  isSelf?: boolean;
  shareBadgeLabel?: string | null;
  subtitle: string;
  videoEnabled: boolean;
  videoTrack?: MediaStreamTrack | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (props.videoEnabled && props.videoTrack) {
      const stream = new MediaStream([props.videoTrack]);
      videoRef.current.srcObject = stream;
      return;
    }

    videoRef.current.srcObject = null;
  }, [props.videoEnabled, props.videoTrack]);

  useEffect(() => {
    if (!audioRef.current || props.isSelf) {
      return;
    }

    if (props.audioEnabled && props.audioTrack) {
      const stream = new MediaStream([props.audioTrack]);
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioEnabled, props.audioTrack, props.isSelf]);

  return (
    <article className={`participant-tile participant-tile--media${props.videoEnabled ? "" : " participant-tile--muted"}`}>
      <div className="participant-tile__media-shell">
        <video
          autoPlay
          className="participant-tile__video"
          muted={Boolean(props.isSelf)}
          playsInline
          ref={videoRef}
        />
        {!props.isSelf ? <audio autoPlay className="sr-only" ref={audioRef} /> : null}
        {!props.videoEnabled ? (
          <div className="participant-tile__placeholder">
            <div className="participant-tile__avatar">{getInitials(props.displayName)}</div>
          </div>
        ) : null}
        <div className="participant-tile__overlay">
          <div className="participant-tile__nameplate">
            <strong>{props.displayName}</strong>
            <span>{props.subtitle}</span>
          </div>
          <div className="participant-tile__badges">
            {props.shareBadgeLabel ? <span className="status-pill status-pill--accent">{props.shareBadgeLabel}</span> : null}
            {props.isSelf ? <span className="status-pill">You</span> : null}
            <span className="status-pill">{props.audioEnabled ? "Mic On" : "Mic Off"}</span>
            <span className="status-pill">{props.videoEnabled ? "Camera On" : "Camera Off"}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ScreenShareTile(props: {
  audioTrack?: MediaStreamTrack | null;
  displayName: string;
  extraShareCount: number;
  isSelf?: boolean;
  source: ScreenShareSourceMeta;
  videoTrack: MediaStreamTrack;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = new MediaStream([props.videoTrack]);
  }, [props.videoTrack]);

  useEffect(() => {
    if (!audioRef.current || props.isSelf) {
      return;
    }

    if (props.audioTrack) {
      audioRef.current.srcObject = new MediaStream([props.audioTrack]);
      void audioRef.current.play().catch(() => {});
      return;
    }

    audioRef.current.srcObject = null;
  }, [props.audioTrack, props.isSelf]);

  return (
    <article className="screen-share-stage">
      <div className="screen-share-stage__media-shell">
        <video
          autoPlay
          className="screen-share-stage__video"
          muted={Boolean(props.isSelf)}
          playsInline
          ref={videoRef}
        />
        {!props.isSelf ? <audio autoPlay className="sr-only" ref={audioRef} /> : null}
        <div className="screen-share-stage__overlay">
          <div className="screen-share-stage__badges">
            <span className="status-pill status-pill--accent">{getShareBadgeLabel(props.source)}</span>
            {props.source.audioIncluded ? <span className="status-pill">Audio Included</span> : null}
            {props.extraShareCount ? <span className="status-pill">+{props.extraShareCount} more share{props.extraShareCount > 1 ? "s" : ""}</span> : null}
          </div>
          <div className="screen-share-stage__nameplate participant-tile__nameplate">
            <strong>{props.isSelf ? "You are sharing" : `${props.displayName} is sharing`}</strong>
            <span>{props.source.label}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function StageFallback(props: {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  meetingActive: boolean;
  mediaMessage: string | null;
  mediaStatus: MediaStatus;
  onLeave?: () => void;
  onRetry: (() => void) | null;
  screenShareDisabledReason: string | null;
}) {
  const visibleParticipants = props.activeParticipants.slice(0, 4);

  return (
    <div className="meeting-stage-runtime">
      <div className="meeting-stage-canvas">
        <div className="stage-tiles">
          {visibleParticipants.length > 0 ? (
            visibleParticipants.map((participant) => (
              <article className="participant-tile" key={participant.participantId}>
                <div className="participant-tile__avatar">
                  {getInitials(participant.displayName)}
                </div>
                <div className="participant-tile__meta">
                  <strong>{participant.displayName}</strong>
                  <span>
                    {participant.audio} audio / {participant.video} video
                  </span>
                </div>
              </article>
            ))
          ) : (
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
          )}
        </div>
      </div>

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
      />
    </div>
  );
}

function buildStageScreenShares(input: {
  participantDirectory: Map<string, ParticipantState>;
  participantDisplayName: string;
  remoteParticipants: RTKParticipant[];
  self: RTKSelf;
  selfShareSource: ScreenShareSourceMeta | null;
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

function applyScreenShareIntentConfiguration(
  mediaConfiguration: { screenshare: ScreenshareConfiguration },
  intent: ShareSourceIntent,
) {
  mediaConfiguration.screenshare = {
    ...BASE_SCREEN_SHARE_CONFIGURATION,
    displaySurface: intent === "application" ? "window" : "monitor",
    selfBrowserSurface: "exclude",
  };
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
  intentHint?: ShareSourceIntent | null,
): ScreenShareSourceMeta {
  const settings = typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : {};
  const surface = normaliseDisplaySurface(settings.displaySurface, intentHint);
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
  intentHint?: ShareSourceIntent | null,
): ScreenShareSurface {
  if (displaySurface === "window") {
    return "application";
  }

  if (displaySurface === "monitor") {
    return "screen";
  }

  if (displaySurface === "browser") {
    return "browser";
  }

  if (intentHint === "application") {
    return "application";
  }

  if (intentHint === "screen") {
    return "screen";
  }

  return "unknown";
}

function getDefaultShareLabel(surface: ScreenShareSurface): string {
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

function getShareBadgeLabel(source: ScreenShareSourceMeta): string {
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

function getInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "OM";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
