import type { MeetingDetail, MeetingPostSummary, MeetingSummary, RoomSummary } from "@opsui/shared-types";

export interface RoomRecord extends RoomSummary {
  templateId: string | null;
  isPersistent: boolean;
  createdBy: string;
  createdAt: string;
}

export interface MeetingRecord extends MeetingDetail {
  createdBy: string;
}

export interface MeetingSummaryRecord extends MeetingPostSummary {
  meetingInstanceId: string;
}
