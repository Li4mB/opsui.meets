import { LIVE_ROLES, type SessionActor } from "@opsui/shared-types";

export function getActorContext(request: Request): SessionActor {
  const workspaceId = request.headers.get("x-workspace-id") ?? "workspace_local";
  const userId = request.headers.get("x-user-id") ?? "user_local";
  const email = request.headers.get("x-user-email") ?? undefined;
  const rawWorkspaceRole = request.headers.get("x-workspace-role")?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const workspaceRole = rawWorkspaceRole && LIVE_ROLES.includes(rawWorkspaceRole as (typeof LIVE_ROLES)[number])
    ? rawWorkspaceRole as SessionActor["workspaceRole"]
    : undefined;
  return { workspaceId, userId, email, workspaceRole };
}
