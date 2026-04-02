import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessageEventPayload, RoomEvent } from "@opsui/shared-types";
import { CloseIcon } from "./MeetingRoomIcons";

interface MeetingConversationPanelProps {
  currentParticipantId: string | null;
  disabledReason: string | null;
  events: RoomEvent[];
  onClose?: () => void;
  onSendMessage(message: string): Promise<{ errorMessage?: string }>;
}

export function MeetingConversationPanel(props: MeetingConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const visibleEvents = useMemo(
    () => [...props.events].sort((left, right) => left.roomEventNumber - right.roomEventNumber),
    [props.events],
  );

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleEvents.length]);

  async function handleSubmit() {
    const nextMessage = draft.trim();
    if (!nextMessage || isSending || props.disabledReason) {
      return;
    }

    setIsSending(true);
    setSendError(null);
    const result = await props.onSendMessage(nextMessage);
    setIsSending(false);

    if (result.errorMessage) {
      setSendError(result.errorMessage);
      return;
    }

    setDraft("");
  }

  return (
    <section className="panel-card panel-card--conversation meeting-drawer-panel meeting-conversation-panel">
      <div className="panel-card__header meeting-drawer-panel__header">
        <div>
          <div className="eyebrow">Conversation</div>
          <h2 className="panel-card__title">Chat & Activity</h2>
        </div>
        {props.onClose ? (
          <button
            aria-label="Close chat"
            className="icon-button icon-button--small"
            onClick={props.onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>

      <div className="conversation-log" ref={logRef}>
        {visibleEvents.length ? (
          visibleEvents.map((event) =>
            isChatMessageEvent(event) ? (
              <article
                className={`chat-message${event.actorParticipantId === props.currentParticipantId ? " chat-message--self" : ""}`}
                key={event.eventId}
              >
                <div className="chat-message__meta">
                  <strong>{event.payload.displayName}</strong>
                  <span>{formatClockTime(event.occurredAt)}</span>
                </div>
                <div className="chat-message__bubble">{event.payload.text}</div>
              </article>
            ) : (
              <article className="conversation-divider" key={event.eventId}>
                <span className="conversation-divider__line" />
                <span className="conversation-divider__content">
                  {formatActivityLabel(event)} - {formatClockTime(event.occurredAt)}
                </span>
                <span className="conversation-divider__line" />
              </article>
            ),
          )
        ) : (
          <div className="empty-list">No conversation yet.</div>
        )}
      </div>

      <div className="conversation-composer">
        <span className="field__label">Message</span>
        <div className="conversation-composer__row">
          <button
            aria-label="Send message"
            className="conversation-send-button"
            disabled={!draft.trim() || Boolean(props.disabledReason) || isSending}
            onClick={() => {
              void handleSubmit();
            }}
            type="button"
          >
            <PaperPlaneIcon />
          </button>
          <input
            aria-label="Message"
            className="field__input conversation-composer__input"
            disabled={Boolean(props.disabledReason) || isSending}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={props.disabledReason ?? "Send a message to the room"}
            value={draft}
          />
        </div>
        <div className="conversation-composer__footer">
          {sendError ? <p className="inline-feedback inline-feedback--error">{sendError}</p> : null}
          {!sendError && props.disabledReason ? <p className="inline-feedback">{props.disabledReason}</p> : null}
        </div>
      </div>
    </section>
  );
}

function isChatMessageEvent(
  event: RoomEvent,
): event is RoomEvent<ChatMessageEventPayload> {
  if (event.type !== "chat.message_sent") {
    return false;
  }

  const payload = event.payload as Partial<ChatMessageEventPayload> | null;
  return Boolean(payload && typeof payload.displayName === "string" && typeof payload.text === "string");
}

function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatActivityLabel(event: RoomEvent): string {
  const payload = asRecord(event.payload);

  switch (event.type) {
    case "participant.join":
      return `${readDisplayName(payload, "Someone")} joined`;
    case "participant.leave":
      return `${readDisplayName(payload, "Someone")} left`;
    case "participant.admitted":
      return `${readDisplayName(payload, "Someone")} was admitted`;
    case "participant.removed":
      return `${readDisplayName(payload, "Someone")} was removed`;
    case "lobby.updated":
      return `${readDisplayName(payload, "Someone")} entered the lobby`;
    case "participants.muted_all":
      return "Everyone was muted";
    case "room.locked":
      return "Room locked";
    case "room.unlocked":
      return "Room unlocked";
    case "room.ended":
      return "Meeting ended";
    case "recording.started":
      return "Recording started";
    case "recording.stopped":
      return "Recording stopped";
    case "action_item.created":
      return "Action item created";
    case "action_item.completed":
      return "Action item completed";
    case "follow_up.dispatched":
      return "Follow-up dispatched";
    default:
      return event.type.replace(/\./g, " ");
  }
}

function readDisplayName(payload: Record<string, unknown>, fallback: string): string {
  const value = payload.displayName;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function PaperPlaneIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M21 3L10 14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M21 3L14 21L10 14L3 10L21 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
