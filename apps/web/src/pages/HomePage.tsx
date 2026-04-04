import { useState } from "react";
import { Modal } from "../components/Modal";
import { createInstantMeeting, createRoom } from "../lib/commands";
import { formatMeetingCodeLabel, generateMeetingCode, normalizeMeetingCode } from "../lib/meeting-code";

interface HomePageProps {
  onNavigate(pathname: string): void;
}

export function HomePage(props: HomePageProps) {
  const [joinPromptOpen, setJoinPromptOpen] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleStartMeeting() {
    setIsBusy(true);
    setStatusMessage(null);

    const room = await createRoomWithRetry();

    if (!room) {
      setIsBusy(false);
      setStatusMessage("We could not create a room right now.");
      return;
    }

    const meeting = await createInstantMeeting({
      roomId: room.id,
      startsAt: new Date().toISOString(),
      title: `Meeting ${formatMeetingCodeLabel(room.slug)}`,
    });

    setIsBusy(false);

    if (!meeting) {
      setStatusMessage("The room exists, but the meeting could not be started.");
      return;
    }

    props.onNavigate(`/${room.slug}`);
  }

  async function createRoomWithRetry() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const proposedCode = generateMeetingCode();
      const room = await createRoom({
        isPersistent: false,
        name: proposedCode,
        roomType: "instant",
      });

      if (room) {
        return room;
      }
    }

    return null;
  }

  function handleJoin() {
    const nextCode = normalizeMeetingCode(joinInput);
    if (!nextCode) {
      setJoinError("Enter a valid meeting code or invite link.");
      return;
    }

    setJoinError(null);
    setJoinPromptOpen(false);
    props.onNavigate(`/${nextCode}`);
  }

  return (
    <>
      <section className="page page--centered">
        <div className="hero-card hero-card--compact">
          <div className="eyebrow">Opsuimeets</div>
          <h1 className="hero-title">Meetings without the clutter.</h1>
          <p className="hero-copy">
            Start a room instantly or join with a code or link. Everything else stays out of the way.
          </p>
          <div className="hero-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setJoinPromptOpen(true);
              }}
              type="button"
            >
              Join Meeting
            </button>
            <button
              className="button button--primary"
              disabled={isBusy}
              onClick={() => {
                void handleStartMeeting();
              }}
              type="button"
            >
              {isBusy ? "Starting..." : "Start Meeting"}
            </button>
          </div>
          {statusMessage ? <p className="inline-feedback">{statusMessage}</p> : null}
        </div>
      </section>

      <Modal
        actions={
          <button
            className="button button--primary"
            onClick={handleJoin}
            type="button"
          >
            Join Meeting
          </button>
        }
        description="Paste an invite link or enter the room code to open the meeting."
        onClose={() => {
          setJoinPromptOpen(false);
          setJoinError(null);
        }}
        open={joinPromptOpen}
        title="Join Meeting"
      >
        <label className="field">
          <span className="field__label">Meeting code or link</span>
          <input
            autoFocus
            className="field__input"
            onChange={(event) => {
              setJoinInput(event.target.value);
              setJoinError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleJoin();
              }
            }}
            placeholder="ops-a1b2c3d4 or https://opsuimeets.com/ops-a1b2c3d4"
            value={joinInput}
          />
        </label>
        {joinError ? <p className="inline-feedback inline-feedback--error">{joinError}</p> : null}
      </Modal>
    </>
  );
}
