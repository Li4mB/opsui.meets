export type RecordingStatus = "idle" | "starting" | "recording" | "stopped" | "failed";

export interface RecordingSummary {
  id: string;
  meetingInstanceId: string;
  provider: string;
  status: RecordingStatus;
  startedAt?: string;
  stoppedAt?: string;
}
