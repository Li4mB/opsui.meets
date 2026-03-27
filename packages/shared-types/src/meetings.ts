export type MeetingStatus = "scheduled" | "prejoin" | "live" | "ending" | "ended";

export interface MeetingSummary {
  id: string;
  roomId: string;
  workspaceId: string;
  title: string;
  status: MeetingStatus;
  startsAt: string;
  createdAt: string;
}

export interface CreateMeetingInput {
  roomId: string;
  title: string;
  startsAt: string;
}

export interface MeetingDetail extends MeetingSummary {
  hostUserId: string | null;
  joinUrl: string;
  isLocked: boolean;
}

export interface MeetingPostSummary {
  headline: string;
  attendanceCount: number;
  actionItemCount: number;
  recordingStatus: "idle" | "starting" | "recording" | "stopped" | "failed";
  followUps: string[];
}

export interface JoinMeetingResult {
  meetingInstanceId: string;
  roomId: string;
  joinState: "direct" | "lobby" | "blocked";
  displayName: string;
  participantId?: string;
  reason?: "room_locked" | "guest_join_disabled";
}
