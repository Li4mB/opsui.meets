export type RecordingStatus = "idle" | "starting" | "recording" | "stopped" | "failed";

export interface RecordingSummary {
  id: string;
  meetingInstanceId: string;
  provider: string;
  status: RecordingStatus;
  contentType?: string;
  contentUrl?: string;
  createdAt?: string;
  downloadUrl?: string;
  durationMs?: number;
  expiresAt?: string | null;
  filename?: string;
  ownerUserId?: string;
  saved?: boolean;
  sizeBytes?: number;
  startedAt?: string;
  stoppedAt?: string;
  title?: string;
}
