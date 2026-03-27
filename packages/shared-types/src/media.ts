export interface CreateMeetingMediaSessionInput {
  participantId: string;
  role: string;
}

export interface MeetingMediaSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}
