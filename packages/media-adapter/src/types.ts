export interface CreateMediaSessionInput {
  meetingInstanceId: string;
  participantId: string;
  role: string;
}

export interface CreateMediaSessionResult {
  sessionId: string;
  token: string;
  expiresAt: string;
}

export interface RecordingControlInput {
  meetingInstanceId: string;
  actorUserId: string;
}

export interface MediaAdapter {
  createSession(input: CreateMediaSessionInput): Promise<CreateMediaSessionResult>;
  startRecording(input: RecordingControlInput): Promise<{ recordingId: string }>;
  stopRecording(input: RecordingControlInput): Promise<{ stopped: true }>;
}
