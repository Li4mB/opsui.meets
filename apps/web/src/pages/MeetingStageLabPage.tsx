import { useMemo, useState } from "react";
import {
  MeetingStageScene,
  type MeetingStageParticipantTile,
  type MeetingStageShareTile,
} from "../components/MeetingStageScene";

interface MeetingStageLabPageProps {
  search: string;
}

export function MeetingStageLabPage(props: MeetingStageLabPageProps) {
  const initialState = useMemo(() => parseInitialLabState(props.search), [props.search]);
  const [participantCount, setParticipantCount] = useState(initialState.participantCount);
  const [shareActive, setShareActive] = useState(initialState.shareActive);
  const [shareOwner, setShareOwner] = useState<"self" | "remote">(initialState.shareOwner);

  const participantTiles = useMemo(
    () => buildLabParticipants(participantCount),
    [participantCount],
  );
  const primaryScreenShare = useMemo<MeetingStageShareTile | null>(() => {
    if (!shareActive) {
      return null;
    }

    const ownerName =
      shareOwner === "self" ? participantTiles[0]?.displayName ?? "You" : participantTiles[1]?.displayName ?? "Remote presenter";

    return {
      displayName: ownerName,
      isSelf: shareOwner === "self",
    };
  }, [participantTiles, shareActive, shareOwner]);

  return (
    <section className="stage-lab" data-stage-lab-root="">
      <header className="stage-lab__controls">
        <div className="stage-lab__copy">
          <div className="eyebrow">Stage Lab</div>
          <h1 className="stage-lab__title">Meeting layout harness</h1>
          <p className="stage-lab__description">
            Drive participant count and sharing state through the same stage layout engine used by the live meeting room.
          </p>
        </div>

        <div className="stage-lab__actions">
          <button
            className="chip-button"
            onClick={() => {
              setParticipantCount((current) => Math.max(1, current - 1));
            }}
            type="button"
          >
            Remove participant
          </button>
          <button
            className="chip-button"
            onClick={() => {
              setParticipantCount((current) => Math.min(12, current + 1));
            }}
            type="button"
          >
            Add participant
          </button>
          <button
            className={`chip-button${shareActive ? "" : " chip-button--muted"}`}
            onClick={() => {
              setShareActive((current) => !current);
            }}
            type="button"
          >
            {shareActive ? "Stop share" : "Start share"}
          </button>
          <button
            className={`chip-button${shareOwner === "self" ? "" : " chip-button--muted"}`}
            onClick={() => {
              setShareOwner("self");
            }}
            type="button"
          >
            Self sharing
          </button>
          <button
            className={`chip-button${shareOwner === "remote" ? "" : " chip-button--muted"}`}
            onClick={() => {
              setShareOwner("remote");
            }}
            type="button"
          >
            Remote sharing
          </button>
        </div>
      </header>

      <div className="stage-lab__summary" role="status">
        <span>{participantCount} participants</span>
        <span>{shareActive ? `${shareOwner === "self" ? "Self" : "Remote"} share active` : "No active share"}</span>
      </div>

      <div className="stage-lab__surface">
        <MeetingStageScene
          immersiveSoloMode
          participantTiles={participantTiles}
          primaryScreenShare={primaryScreenShare}
        />
      </div>
    </section>
  );
}

function buildLabParticipants(participantCount: number): MeetingStageParticipantTile[] {
  return Array.from({ length: participantCount }, (_, index) => {
    const displayName = index === 0 ? "Liam" : `Participant ${index + 1}`;
    const audioEnabled = index % 3 !== 0;
    const videoEnabled = index % 4 !== 0;

    return {
      audioEnabled,
      displayName,
      isSelf: index === 0,
      videoEnabled,
    };
  });
}

function parseInitialLabState(search: string) {
  const params = new URLSearchParams(search);
  const rawParticipants = Number.parseInt(params.get("participants") ?? "4", 10);
  const participantCount = Number.isFinite(rawParticipants)
    ? Math.min(12, Math.max(1, rawParticipants))
    : 4;

  return {
    participantCount,
    shareActive: params.get("share") === "1",
    shareOwner: params.get("shareOwner") === "self" ? "self" : "remote",
  } as const;
}
