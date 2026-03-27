import type { LiveRole } from "./permissions";

export type PresenceState = "lobby" | "active" | "breakout" | "reconnecting" | "left";

export interface ParticipantState {
  participantId: string;
  meetingInstanceId: string;
  displayName: string;
  role: LiveRole;
  presence: PresenceState;
  audio: "muted" | "unmuted" | "blocked";
  video: "off" | "on" | "blocked";
  handRaised: boolean;
  joinedAt?: string;
}
