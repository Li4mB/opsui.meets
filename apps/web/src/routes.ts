export const WEB_ROUTES = [
  "/",
  "/join",
  "/new",
  "/dashboard",
  "/schedule",
  "/rooms",
  "/rooms/:roomSlug",
  "/meetings/:meetingInstanceId/live",
  "/meetings/:meetingInstanceId/summary",
  "/templates",
  "/recordings",
  "/settings",
] as const;

export const LIVE_ROOM_PANELS = [
  "room",
  "people",
  "chat",
  "polls",
  "notes",
  "activity",
  "host-console",
] as const;
