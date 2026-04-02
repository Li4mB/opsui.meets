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
import {
  LeaveCallIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  RefreshIcon,
  VideoCameraIcon,
  VideoCameraOffIcon,
} from "./MeetingRoomIcons";

type MediaStatus = "idle" | "connecting" | "connected" | "warning" | "error";
type MediaClient = Awaited<ReturnType<ReturnType<typeof useRealtimeKitClient>[1]>> | undefined;

interface MeetingMediaStageProps {
  activeParticipants: ParticipantState[];
  extraControls?: ReactNode;
  meetingActive: boolean;
  meetingId: string | null;
  onLeave?: () => void;
  participantDisplayName: string;
  participantId: string | null;
  participantRole: string;
  shouldConnect: boolean;
}

export function MeetingMediaStage(props: MeetingMediaStageProps) {
  const [client, initClient] = useRealtimeKitClient({ resetOnLeave: true });
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const clientRef = useRef<MediaClient>(undefined);
  const connectionKeyRef = useRef<string | null>(null);

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
          onRetry={() => {
            setRetryNonce((current) => current + 1);
          }}
          participantDisplayName={props.participantDisplayName}
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
  onMediaActionError(kind: "audio" | "video", error: unknown): void;
  onMediaActionSuccess(): void;
  onLeave?: () => void;
  onRetry(): void;
  participantDisplayName: string;
}) {
  const roomJoined = useRealtimeKitSelector((currentMeeting) => currentMeeting.self.roomJoined);
  const self = useRealtimeKitSelector((currentMeeting) => currentMeeting.self);
  const remoteParticipants = useRealtimeKitSelector((currentMeeting) => currentMeeting.participants.active.toArray());
  const participantDirectory = useMemo(
    () => new Map(props.activeParticipants.map((participant) => [participant.participantId, participant])),
    [props.activeParticipants],
  );
  const visibleRemoteParticipants = remoteParticipants
    .filter((participant) => participant.id !== self.id && participant.customParticipantId !== self.customParticipantId)
    .slice(0, 3);

  if (!roomJoined) {
    return (
      <div className="meeting-stage-runtime">
        <div className="stage-tiles">
          <article className="participant-tile participant-tile--empty">
            <div className="participant-tile__avatar participant-tile__avatar--ghost">O</div>
            <div className="participant-tile__meta">
              <strong>Joining the media room</strong>
              <span>Your camera and microphone are still being connected.</span>
            </div>
          </article>
        </div>
        <MediaToolbar
          extraControls={props.extraControls}
          mediaMessage={props.mediaMessage}
          mediaStatus={props.mediaStatus}
          onLeave={props.onLeave}
          onRetry={props.onRetry}
          onToggleAudio={null}
          onToggleVideo={null}
          self={self}
        />
      </div>
    );
  }

  return (
    <div className="meeting-stage-runtime">
      <div className="stage-tiles">
        <MediaTile
          audioEnabled={self.audioEnabled}
          displayName={props.participantDisplayName}
          isSelf
          subtitle={buildTileSubtitle(self.audioEnabled, self.videoEnabled, true)}
          videoEnabled={self.videoEnabled}
          videoTrack={self.videoTrack}
        />

        {visibleRemoteParticipants.map((participant) => (
          <MediaTile
            audioEnabled={participant.audioEnabled}
            audioTrack={participant.audioTrack}
            displayName={resolveParticipantName(participant, participantDirectory)}
            key={participant.id}
            subtitle={buildTileSubtitle(participant.audioEnabled, participant.videoEnabled, false)}
            videoEnabled={participant.videoEnabled}
            videoTrack={participant.videoTrack}
          />
        ))}

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

      <MediaToolbar
        extraControls={props.extraControls}
        mediaMessage={props.mediaMessage}
        mediaStatus={props.mediaStatus}
        onLeave={props.onLeave}
        onRetry={props.onRetry}
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
  onToggleAudio: (() => Promise<void>) | null;
  onToggleVideo: (() => Promise<void>) | null;
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
            {props.isSelf ? <span className="status-pill">You</span> : null}
            <span className="status-pill">{props.audioEnabled ? "Mic On" : "Mic Off"}</span>
            <span className="status-pill">{props.videoEnabled ? "Camera On" : "Camera Off"}</span>
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
}) {
  const visibleParticipants = props.activeParticipants.slice(0, 4);

  return (
    <div className="meeting-stage-runtime">
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

      <MediaToolbar
        extraControls={props.extraControls}
        mediaMessage={props.mediaMessage}
        mediaStatus={props.mediaStatus}
        onLeave={props.onLeave}
        onRetry={props.onRetry ?? (() => {})}
        onToggleAudio={null}
        onToggleVideo={null}
        self={null}
      />
    </div>
  );
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

function getMediaActionErrorMessage(kind: "audio" | "video", error: unknown): string {
  const fallback = kind === "audio"
    ? "Microphone could not be updated. Check browser or device permissions and try again."
    : "Camera could not be updated. Check browser or device permissions and try again.";
  const message = normaliseMediaErrorMessage(error);

  if (!message) {
    return fallback;
  }

  if (kind === "audio" && /(unmute|audio|microphone|mic)/i.test(message)) {
    return "Microphone could not be enabled. Check browser or device permissions and try again.";
  }

  if (kind === "video" && /(video|camera)/i.test(message)) {
    return "Camera could not be enabled. Check browser or device permissions and try again.";
  }

  return fallback;
}

function reportMediaException(
  error: unknown,
  context: {
    kind: "audio" | "video";
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
      /(localmediahandler|failed to unmute track|failed to get video track|could not start video source|could not start audio source|notallowederror|notreadableerror|overconstrainederror)/i
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
