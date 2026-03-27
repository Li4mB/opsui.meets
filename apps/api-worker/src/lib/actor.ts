import type { SessionActor } from "@opsui/shared-types";

export function getActorContext(request: Request): SessionActor {
  const workspaceId = request.headers.get("x-workspace-id") ?? "workspace_local";
  const userId = request.headers.get("x-user-id") ?? "user_local";
  const email = request.headers.get("x-user-email") ?? undefined;
  return { workspaceId, userId, email };
}
