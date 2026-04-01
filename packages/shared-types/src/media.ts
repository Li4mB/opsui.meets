export interface CreateMeetingMediaSessionInput {
  displayName: string;
  participantId: string;
  role: string;
}

export interface MeetingMediaSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}
