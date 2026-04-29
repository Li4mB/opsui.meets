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

export interface WhiteboardPoint {
  x: number;
  y: number;
}

export type WhiteboardStrokeMode = "direct" | "smooth";

export interface WhiteboardStroke {
  strokeId: string;
  participantId: string;
  color: string;
  thickness: number;
  mode?: WhiteboardStrokeMode;
  points: WhiteboardPoint[];
  updatedAt: string;
  completedAt?: string | null;
  removedAt?: string | null;
}

export interface WhiteboardTextBox {
  textBoxId: string;
  participantId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  color: string;
  updatedAt: string;
  removedAt?: string | null;
}

export type WhiteboardTextBoxHistoryAction =
  | {
      type: "textbox.create";
      occurredAt: string;
      participantId: string;
      textBox: WhiteboardTextBox;
    }
  | {
      type: "textbox.update";
      occurredAt: string;
      participantId: string;
      before: WhiteboardTextBox;
      after: WhiteboardTextBox;
    }
  | {
      type: "textbox.delete";
      occurredAt: string;
      participantId: string;
      textBox: WhiteboardTextBox;
    };

export type WhiteboardHistoryAction =
  | {
      type: "stroke";
      occurredAt: string;
      participantId: string;
      strokeId: string;
    }
  | {
      type: "clear";
      occurredAt: string;
      participantId: string;
      strokeIds: string[];
      textBoxIds: string[];
    }
  | WhiteboardTextBoxHistoryAction;

export interface RealtimeWhiteboardState {
  strokes: WhiteboardStroke[];
  textBoxes: WhiteboardTextBox[];
  undoStack: WhiteboardHistoryAction[];
  redoStack: WhiteboardHistoryAction[];
  updatedAt: string | null;
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
  whiteboard: RealtimeWhiteboardState;
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
