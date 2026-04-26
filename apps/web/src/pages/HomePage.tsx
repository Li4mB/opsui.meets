import { useEffect, useState } from "react";
import { normalizeMeetingCode } from "../lib/meeting-code";

interface HomePageProps {
  onNavigate(pathname: string): void;
  onStartMeeting(): void;
  startMeetingError?: string | null;
  startMeetingPending?: boolean;
}

export function HomePage(props: HomePageProps) {
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.startMeetingPending) {
      return;
    }

    setJoinError(null);
  }, [props.startMeetingPending]);

  function handleJoin() {
    const nextCode = normalizeMeetingCode(joinInput);
    if (!nextCode) {
      setJoinError("Enter a valid meeting code or invite link.");
      return;
    }

    setJoinError(null);
    props.onNavigate(`/${nextCode}`);
  }

  return (
    <section className="home-page">
      {/* Hero Content */}
      <div className="home-hero">
        {/* Headline */}
        <h1 className="home-hero__title">
          <span>Meetings without</span>
          <br />
          <span className="home-hero__title--subtle">the clutter.</span>
        </h1>

        {/* Subheading */}
        <p className="home-hero__copy">
          Start a room instantly or join with a code.
          <br />
          Everything else stays out of the way.
        </p>

        {/* Action area */}
        <div className="home-hero__actions">
          {/* Start Meeting Button with Scribble */}
          <button
            className="home-button home-button--start"
            disabled={props.startMeetingPending}
            onClick={() => {
              props.onStartMeeting();
            }}
            type="button"
          >
            <img
              src="/Create-Meet-Scribble.png"
              alt=""
              className="home-button__scribble"
              draggable={false}
            />
            <span>{props.startMeetingPending ? "Starting..." : "Start Meeting"}</span>
          </button>

          {/* Divider line */}
          <div className="home-hero__divider" />

          {/* Join Meeting - Inline Text Input */}
          <div className="home-hero__join">
            <div className="home-hero__join-input-wrap">
              <input
                className="home-input"
                onChange={(event) => {
                  setJoinInput(event.target.value);
                  setJoinError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleJoin();
                  }
                }}
                placeholder="Enter meeting code"
                type="text"
                value={joinInput}
              />
            </div>
            <button
              className="home-button home-button--join"
              onClick={handleJoin}
              type="button"
            >
              Join
            </button>
          </div>
        </div>

        {/* Error / status messages */}
        {joinError ? <p className="home-feedback home-feedback--error">{joinError}</p> : null}
        {props.startMeetingError ? <p className="home-feedback">{props.startMeetingError}</p> : null}

        {/* Subtle decorative elements */}
        <div className="home-hero__decoration">
          <div className="home-hero__decoration-line home-hero__decoration-line--left" />
          <div className="home-hero__decoration-dot" />
          <div className="home-hero__decoration-line home-hero__decoration-line--right" />
        </div>
      </div>

      {/* Footer hint */}
      <footer className="home-footer">
        <p className="home-footer__text">No account needed · Just start</p>
      </footer>
    </section>
  );
}
