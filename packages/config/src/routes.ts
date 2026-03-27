export const APP_HOSTS = {
  public: "opsuimeets.com",
  app: "app.opsuimeets.com",
  api: "api.opsuimeets.com",
  ws: "ws.opsuimeets.com",
  media: "media.opsuimeets.com",
  auth: "auth.opsuimeets.com",
  admin: "admin.opsuimeets.com",
  docs: "docs.opsuimeets.com",
  preview: "preview.opsuimeets.com",
} as const;

export const API_ROUTES = {
  health: "/v1/health",
  rooms: "/v1/rooms",
  meetings: "/v1/meetings",
  joinToken: "/v1/join-token",
} as const;
