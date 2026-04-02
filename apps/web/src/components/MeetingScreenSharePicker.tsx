import type { ReactNode } from "react";
import {
  ApplicationWindowIcon,
  CloseIcon,
  DisplayScreenIcon,
} from "./MeetingRoomIcons";

export type ShareSourceIntent = "application" | "screen";

interface MeetingScreenSharePickerProps {
  busy: boolean;
  disabledReason: string | null;
  onChooseIntent(intent: ShareSourceIntent): void;
  onClose(): void;
  open: boolean;
}

export function MeetingScreenSharePicker(props: MeetingScreenSharePickerProps) {
  return (
    <div className={`meeting-share-picker-layer${props.open ? " is-open" : ""}`}>
      <button
        aria-hidden={!props.open}
        className="meeting-share-picker-layer__scrim"
        onClick={props.onClose}
        tabIndex={props.open ? 0 : -1}
        type="button"
      />
      <section
        aria-hidden={!props.open}
        className="meeting-share-picker"
      >
        <div className="meeting-share-picker__header">
          <div className="meeting-share-picker__header-copy">
            <div className="eyebrow">Screen Share</div>
            <h2 className="meeting-share-picker__title">Choose what to share</h2>
            <p className="meeting-share-picker__description">
              Pick a source type first, then confirm the exact application or display in your browser&apos;s native share picker.
            </p>
          </div>
          <button
            aria-label="Close screen share picker"
            className="icon-button icon-button--small"
            onClick={props.onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="meeting-share-picker__grid">
          <ShareIntentCard
            actionLabel="Choose Application"
            busy={props.busy}
            description="Share one app window or browser tab. Once you choose a source, the browser keeps that exact source locked for this share session."
            disabledReason={props.disabledReason}
            icon={<ApplicationWindowIcon />}
            intent="application"
            onChooseIntent={props.onChooseIntent}
            title="Applications"
          />
          <ShareIntentCard
            actionLabel="Choose Screen"
            busy={props.busy}
            description="Share an entire display. If your browser supports system audio for that source, it will offer the option inside the native picker."
            disabledReason={props.disabledReason}
            icon={<DisplayScreenIcon />}
            intent="screen"
            onChooseIntent={props.onChooseIntent}
            title="Screens"
          />
        </div>

        <p className="meeting-share-picker__note">
          Browsers do not expose a safe pre-rendered list of apps or screens here. The native picker remains the source of truth for the final selection.
        </p>

        {props.disabledReason ? (
          <p className="inline-feedback inline-feedback--warning">
            {props.disabledReason}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ShareIntentCard(props: {
  actionLabel: string;
  busy: boolean;
  description: string;
  disabledReason: string | null;
  icon: ReactNode;
  intent: ShareSourceIntent;
  onChooseIntent(intent: ShareSourceIntent): void;
  title: string;
}) {
  const disabled = props.busy || Boolean(props.disabledReason);

  return (
    <section className="meeting-share-picker__card">
      <div className="meeting-share-picker__card-icon">{props.icon}</div>
      <div className="meeting-share-picker__card-copy">
        <h3 className="meeting-share-picker__card-title">{props.title}</h3>
        <p className="meeting-share-picker__card-description">{props.description}</p>
      </div>
      <button
        autoFocus={props.intent === "application"}
        className="button button--secondary meeting-share-picker__card-action"
        disabled={disabled}
        onClick={() => {
          props.onChooseIntent(props.intent);
        }}
        type="button"
      >
        {props.busy ? "Opening..." : props.actionLabel}
      </button>
    </section>
  );
}
