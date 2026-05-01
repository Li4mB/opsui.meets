import type { MeetingDetail, ParticipantState, RecordingSummary } from "@opsui/shared-types";
import { formatMeetingCodeLabel } from "../lib/meeting-code";
import { isTestRoomDummyParticipantId } from "../lib/test-room";
import type { StageViewMode } from "./MeetingMediaStage";
import { CloseIcon, LinkIcon, RefreshIcon } from "./MeetingRoomIcons";

interface MeetingInfoPanelProps {
  actionMessage: string | null;
  activeParticipants: ParticipantState[];
  canManageMeeting: boolean;
  identityLabel: string;
  isActionBusy: boolean;
  joinMessage: string | null;
  joinState: string;
  lobbyParticipants: ParticipantState[];
  meeting: MeetingDetail | null;
  meetingCode: string;
  onAdmitParticipant(participantId: string): void;
  onClose(): void;
  onCopyLink(): void;
  onEndMeeting(): void;
  onRefresh(): void;
  onRemoveParticipant(participantId: string): void;
  onSignIn(): void;
  onStartMeetingNow(): void;
  onToggleStageView(): void;
  onToggleLock(): void;
  onToggleMuteAll(): void;
  onToggleRecording(): void;
  recording: RecordingSummary | null;
  serviceMessage: string | null;
  sessionAuthenticated: boolean;
  showStartMeetingAction: boolean;
  stageViewMode: StageViewMode;
}

export function MeetingInfoPanel(props: MeetingInfoPanelProps) {
  const totalParticipants = props.activeParticipants.length + props.lobbyParticipants.length;

  return (
    <section className="panel-card meeting-drawer-panel meeting-info-panel">
      <div className="panel-card__header meeting-drawer-panel__header">
        <div>
          <div className="eyebrow">Information</div>
          <h2 className="panel-card__title">Room details</h2>
        </div>
        <button
          aria-label="Close information"
          className="icon-button icon-button--small"
          onClick={props.onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="meeting-drawer-panel__body">
        <section className="meeting-info-panel__section">
          <div className="detail-grid detail-grid--compact">
            <Detail label="Code" value={formatMeetingCodeLabel(props.meetingCode)} />
            <Detail label="Identity" value={props.identityLabel} />
            <Detail label="Joined" value={props.joinState} />
            <Detail label="Recording" value={props.recording?.status ?? "idle"} />
            <Detail label="Participants" value={String(totalParticipants)} />
            <Detail label="Active" value={String(props.activeParticipants.length)} />
          </div>
          {props.joinMessage ? <p className="inline-feedback">{props.joinMessage}</p> : null}
          {props.actionMessage ? <p className="inline-feedback">{props.actionMessage}</p> : null}
          {props.serviceMessage ? <p className="inline-feedback inline-feedback--warning">{props.serviceMessage}</p> : null}
        </section>

        <section className="meeting-info-panel__section">
          <div className="meeting-info-panel__section-header">
            <div>
              <div className="eyebrow">Quick Actions</div>
              <h3 className="meeting-info-panel__section-title">Utilities</h3>
            </div>
          </div>
          <div className="meeting-info-panel__actions">
            <button className="button button--ghost" onClick={props.onCopyLink} type="button">
              <span className="meeting-inline-icon">
                <LinkIcon />
              </span>
              Copy Link
            </button>
            <button className="button button--ghost" onClick={props.onRefresh} type="button">
              <span className="meeting-inline-icon">
                <RefreshIcon />
              </span>
              Refresh
            </button>
            <button
              aria-pressed={props.stageViewMode === "speaker"}
              className="button button--ghost"
              onClick={props.onToggleStageView}
              type="button"
            >
              Change View
            </button>
            {!props.sessionAuthenticated ? (
              <button className="button button--ghost" onClick={props.onSignIn} type="button">
                Sign In
              </button>
            ) : null}
            {props.showStartMeetingAction ? (
              <button className="button button--primary" onClick={props.onStartMeetingNow} type="button">
                Start Meeting Now
              </button>
            ) : null}
          </div>
        </section>

        <section className="meeting-info-panel__section">
          <div className="meeting-info-panel__section-header">
            <div>
              <div className="eyebrow">People</div>
              <h3 className="meeting-info-panel__section-title">
                {props.activeParticipants.length} active / {props.lobbyParticipants.length} lobby
              </h3>
            </div>
          </div>
          <div className="people-list meeting-info-panel__people-list">
            {props.activeParticipants.map((participant) => (
              <ParticipantRow
                key={participant.participantId}
                onAdmit={null}
                onRemove={
                  props.meeting && props.canManageMeeting && !isTestRoomDummyParticipantId(participant.participantId)
                    ? () => {
                        props.onRemoveParticipant(participant.participantId);
                      }
                    : null
                }
                participant={participant}
              />
            ))}
            {props.lobbyParticipants.map((participant) => (
              <ParticipantRow
                key={participant.participantId}
                onAdmit={
                  props.meeting && props.canManageMeeting
                    ? () => {
                        props.onAdmitParticipant(participant.participantId);
                      }
                    : null
                }
                onRemove={
                  props.meeting && props.canManageMeeting
                    ? () => {
                        props.onRemoveParticipant(participant.participantId);
                      }
                    : null
                }
                participant={participant}
              />
            ))}
            {!props.activeParticipants.length && !props.lobbyParticipants.length ? (
              <div className="empty-list">No participants yet.</div>
            ) : null}
          </div>
        </section>

        {props.meeting && props.canManageMeeting ? (
          <section className="meeting-info-panel__section">
            <div className="meeting-info-panel__section-header">
              <div>
                <div className="eyebrow">Host Tools</div>
                <h3 className="meeting-info-panel__section-title">Controls</h3>
              </div>
            </div>
            <div className="host-actions meeting-info-panel__host-actions">
              <button
                className="button button--secondary"
                disabled={props.isActionBusy}
                onClick={props.onToggleMuteAll}
                type="button"
              >
                Mute All
              </button>
              <button
                className="button button--secondary"
                disabled={props.isActionBusy}
                onClick={props.onToggleLock}
                type="button"
              >
                {props.meeting.isLocked ? "Unlock" : "Lock"}
              </button>
              <button
                className="button button--secondary"
                disabled={props.isActionBusy}
                onClick={props.onToggleRecording}
                type="button"
              >
                {props.recording?.status === "recording" ? "Stop Recording" : "Start Recording"}
              </button>
              <button
                className="button button--danger"
                disabled={props.isActionBusy}
                onClick={props.onEndMeeting}
                type="button"
              >
                End Meeting
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </section>
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
          {props.participant.presence} / {props.participant.audio} audio / {props.participant.video} video
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
