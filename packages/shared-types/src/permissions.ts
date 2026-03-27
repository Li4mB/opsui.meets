export const LIVE_ROLES = [
  "owner",
  "host",
  "co_host",
  "presenter",
  "moderator",
  "participant",
  "viewer",
] as const;

export type LiveRole = (typeof LIVE_ROLES)[number];

export const PERMISSION_KEYS = [
  "meeting.start",
  "meeting.end",
  "lobby.admit",
  "lobby.deny",
  "room.lock",
  "participants.mute_all",
  "participants.remove",
  "recording.start",
  "recording.stop",
  "breakouts.assign",
  "polls.launch",
  "chat.manage",
  "attendance.export",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
