import type { RoomEvent } from "./events";
import type { MeetingStatus } from "./meetings";
import type { PresenceState } from "./participants";
import type { LiveRole } from "./permissions";

export interface RealtimeConnectionState {
  participantId: string;
  meetingInstanceId: string;
  displayName: string;
  role: LiveRole;
  presence: PresenceState;
  lastSeenAt: string;
}

export interface RealtimeRoomSnapshot {
  meetingInstanceId: string | null;
  meetingStatus: MeetingStatus | null;
  lockState: "locked" | "unlocked";
  recordingState: "idle" | "starting" | "recording" | "stopping" | "stopped";
  participants: Record<string, RealtimeConnectionState>;
  lobby: string[];
  handsRaised: string[];
  mutedAllAt: string | null;
  endedAt: string | null;
  lastEventNumber: number;
}

export interface RealtimeParticipantPatch {
  participantId: string;
  displayName?: string;
  role?: LiveRole;
  presence?: PresenceState | "removed";
}

export interface RealtimeRoomStatePatch {
  meetingInstanceId: string;
  meetingStatus?: MeetingStatus;
  lockState?: RealtimeRoomSnapshot["lockState"];
  recordingState?: RealtimeRoomSnapshot["recordingState"];
  handsRaised?: string[];
  mutedAllAt?: string | null;
  endedAt?: string | null;
  participants?: RealtimeParticipantPatch[];
  event?: Omit<RoomEvent, "eventId" | "roomEventNumber" | "meetingInstanceId" | "occurredAt">;
}
