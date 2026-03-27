import type { ActionItem } from "./action-items";
import type { MeetingDetail, MeetingPostSummary } from "./meetings";
import type { ParticipantState } from "./participants";
import type { RecordingSummary } from "./recordings";

export interface MeetingFollowUpPackage {
  generatedAt: string;
  meeting: MeetingDetail;
  summary: MeetingPostSummary;
  recording: RecordingSummary | null;
  participants: ParticipantState[];
  actionItems: ActionItem[];
  attendance: {
    joined: number;
    active: number;
    lobby: number;
    left: number;
  };
}
