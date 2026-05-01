import type { ParticipantState } from "@opsui/shared-types";
import type { ReactNode } from "react";
import { isTestRoomDummyParticipantId } from "../lib/test-room";
import {
  CloseIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PresentScreenIcon,
  VideoCameraIcon,
  VideoCameraOffIcon,
} from "./MeetingRoomIcons";

export interface ParticipantMediaIndicators {
  audioEnabled: boolean;
  screenShareEnabled: boolean;
  videoEnabled: boolean;
}

interface MeetingParticipantsPanelProps {
  activeParticipants: ParticipantState[];
  canManageMeeting: boolean;
  currentParticipantId: string | null;
  lobbyParticipants: ParticipantState[];
  mediaByParticipantId: Record<string, ParticipantMediaIndicators>;
  onAdmitParticipant(participantId: string): void;
  onClose(): void;
  onRemoveParticipant(participantId: string): void;
}

const HOST_ROLES = new Set(["owner", "host", "co_host", "moderator"]);

export function MeetingParticipantsPanel(props: MeetingParticipantsPanelProps) {
  const orderedActiveParticipants = orderActiveParticipants(
    props.activeParticipants,
    props.currentParticipantId,
  );

  return (
    <section className="panel-card meeting-drawer-panel meeting-participants-panel">
      <div className="panel-card__header meeting-drawer-panel__header">
        <div>
          <div className="eyebrow">People</div>
          <h2 className="panel-card__title">Participants</h2>
        </div>
        <button
          aria-label="Close participants"
          className="icon-button icon-button--small"
          onClick={props.onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="meeting-drawer-panel__body">
        <section className="meeting-participants-panel__section">
          <div className="meeting-participants-panel__summary">
            <span>{orderedActiveParticipants.length} in meeting</span>
            <span>{props.lobbyParticipants.length} in lobby</span>
          </div>

          <div className="meeting-participants-panel__list">
            {orderedActiveParticipants.map((participant) => (
              <ParticipantListRow
                indicators={props.mediaByParticipantId[participant.participantId]}
                key={participant.participantId}
                participant={participant}
                showHostLabel={isHostRole(participant.role)}
                showRemoveAction={props.canManageMeeting && !isTestRoomDummyParticipantId(participant.participantId)}
                showYouLabel={participant.participantId === props.currentParticipantId}
                onRemove={
                  props.canManageMeeting && !isTestRoomDummyParticipantId(participant.participantId)
                    ? () => {
                        props.onRemoveParticipant(participant.participantId);
                      }
                    : null
                }
              />
            ))}

            {props.lobbyParticipants.length ? (
              <article className="conversation-divider meeting-participants-panel__divider">
                <span className="conversation-divider__line" />
                <span className="conversation-divider__content">Lobby</span>
                <span className="conversation-divider__line" />
              </article>
            ) : null}

            {props.lobbyParticipants.map((participant) => (
              <ParticipantListRow
                key={participant.participantId}
                participant={participant}
                showAdmitAction={props.canManageMeeting}
                showHostLabel={isHostRole(participant.role)}
                showYouLabel={participant.participantId === props.currentParticipantId}
                onAdmit={
                  props.canManageMeeting
                    ? () => {
                        props.onAdmitParticipant(participant.participantId);
                      }
                    : null
                }
                onRemove={
                  props.canManageMeeting
                    ? () => {
                        props.onRemoveParticipant(participant.participantId);
                      }
                    : null
                }
              />
            ))}

            {!orderedActiveParticipants.length && !props.lobbyParticipants.length ? (
              <div className="empty-list">No participants yet.</div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function ParticipantListRow(props: {
  indicators?: ParticipantMediaIndicators;
  onAdmit?: (() => void) | null;
  onRemove?: (() => void) | null;
  participant: ParticipantState;
  showAdmitAction?: boolean;
  showHostLabel?: boolean;
  showRemoveAction?: boolean;
  showYouLabel?: boolean;
}) {
  const indicators = props.indicators ?? {
    audioEnabled: props.participant.audio === "unmuted",
    screenShareEnabled: false,
    videoEnabled: props.participant.video === "on",
  };
  const inMeeting = props.participant.presence === "active" || props.participant.presence === "reconnecting";
  const participantStatusLabel =
    props.participant.presence === "reconnecting"
      ? "Reconnecting"
      : inMeeting
        ? "In meeting"
        : "Waiting in lobby";

  return (
    <article className="meeting-participants-panel__row">
      <div className="meeting-participants-panel__identity">
        <div className="meeting-participants-panel__avatar">{getInitials(props.participant.displayName)}</div>
        <div className="meeting-participants-panel__copy">
          <div className="meeting-participants-panel__name-row">
            <strong>{props.participant.displayName}</strong>
            {props.showYouLabel ? <span className="status-pill">You</span> : null}
            {props.showHostLabel ? <span className="status-pill status-pill--accent">Host</span> : null}
          </div>
          <span className="meeting-participants-panel__meta">
            {participantStatusLabel}
          </span>
        </div>
      </div>

      <div className="meeting-participants-panel__controls">
        {inMeeting ? (
          <div className="meeting-participants-panel__status-set">
            <StatusIcon
              active={indicators.audioEnabled}
              icon={indicators.audioEnabled ? <MicrophoneIcon /> : <MicrophoneOffIcon />}
              label={indicators.audioEnabled ? "Microphone on" : "Microphone off"}
            />
            <StatusIcon
              active={indicators.videoEnabled}
              icon={indicators.videoEnabled ? <VideoCameraIcon /> : <VideoCameraOffIcon />}
              label={indicators.videoEnabled ? "Camera on" : "Camera off"}
            />
            <StatusIcon
              active={indicators.screenShareEnabled}
              icon={<PresentScreenIcon />}
              label={indicators.screenShareEnabled ? "Screen sharing on" : "Screen sharing off"}
            />
          </div>
        ) : null}

        <div className="people-row__actions">
          {props.showAdmitAction && props.onAdmit ? (
            <button className="chip-button" onClick={props.onAdmit} type="button">
              Admit
            </button>
          ) : null}
          {(props.showRemoveAction || !inMeeting) && props.onRemove ? (
            <button className="chip-button chip-button--danger" onClick={props.onRemove} type="button">
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StatusIcon(props: { active: boolean; icon: ReactNode; label: string }) {
  return (
    <span
      aria-label={props.label}
      className={`meeting-participants-panel__status-icon${props.active ? " is-active" : ""}`}
      role="img"
      title={props.label}
    >
      {props.icon}
    </span>
  );
}

function orderActiveParticipants(
  participants: ParticipantState[],
  currentParticipantId: string | null,
): ParticipantState[] {
  const remaining = [...participants];
  const ordered: ParticipantState[] = [];

  if (currentParticipantId) {
    const currentIndex = remaining.findIndex((participant) => participant.participantId === currentParticipantId);
    if (currentIndex >= 0) {
      ordered.push(remaining.splice(currentIndex, 1)[0]);
    }
  }

  if (!ordered[0] || !isHostRole(ordered[0].role)) {
    const hostIndex = remaining.findIndex((participant) => isHostRole(participant.role));
    if (hostIndex >= 0) {
      ordered.push(remaining.splice(hostIndex, 1)[0]);
    }
  }

  remaining.sort((left, right) => {
    const roleDelta = getRoleRank(left.role) - getRoleRank(right.role);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    const joinedLeft = left.joinedAt ? Date.parse(left.joinedAt) : Number.POSITIVE_INFINITY;
    const joinedRight = right.joinedAt ? Date.parse(right.joinedAt) : Number.POSITIVE_INFINITY;
    if (joinedLeft !== joinedRight) {
      return joinedLeft - joinedRight;
    }

    return left.displayName.localeCompare(right.displayName);
  });

  return [...ordered, ...remaining];
}

function isHostRole(role: ParticipantState["role"]): boolean {
  return HOST_ROLES.has(role);
}

function getRoleRank(role: ParticipantState["role"]): number {
  switch (role) {
    case "owner":
      return 0;
    case "host":
      return 1;
    case "co_host":
      return 2;
    case "moderator":
      return 3;
    default:
      return 4;
  }
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
