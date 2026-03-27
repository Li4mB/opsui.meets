import type { ParticipantState, RoomSummary } from "@opsui/shared-types";

export const MOCK_ROOM: RoomSummary = {
  id: "room_ops_standup",
  workspaceId: "workspace_opsui",
  name: "Operations Standup",
  slug: "operations-standup",
  roomType: "persistent",
  policy: {
    lobbyEnabled: true,
    allowGuestJoin: true,
    joinBeforeHost: false,
    mutedOnEntry: true,
    cameraOffOnEntry: false,
    lockAfterStart: false,
    chatMode: "open",
    screenShareMode: "presenters",
    recordingMode: "manual",
  },
};

export const MOCK_PARTICIPANTS: ParticipantState[] = [
  {
    participantId: "p_host_1",
    meetingInstanceId: "meeting_today",
    displayName: "Jordan Hale",
    role: "host",
    presence: "active",
    audio: "unmuted",
    video: "on",
    handRaised: false,
    joinedAt: "2026-03-26T08:55:00.000Z",
  },
  {
    participantId: "p_mod_1",
    meetingInstanceId: "meeting_today",
    displayName: "Amira Vale",
    role: "moderator",
    presence: "active",
    audio: "muted",
    video: "on",
    handRaised: true,
    joinedAt: "2026-03-26T08:56:00.000Z",
  },
  {
    participantId: "p_participant_1",
    meetingInstanceId: "meeting_today",
    displayName: "Noah Pike",
    role: "participant",
    presence: "lobby",
    audio: "muted",
    video: "off",
    handRaised: false,
    joinedAt: undefined,
  },
];
