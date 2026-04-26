import type { RequestRepositoryContext, UserRecord, WorkspaceMembershipRecord, WorkspaceRecord } from "@opsui/db";
import { DEFAULT_PROFILE_VISUALS, type SessionActor } from "@opsui/shared-types";
import type { Env } from "../types";

export function createFallbackActor(
  workspaceId: string,
  overrides?: Partial<SessionActor>,
): SessionActor {
  return {
    workspaceId,
    workspaceName: "My Workspace",
    workspaceKind: "personal",
    planTier: "standard",
    userId: "guest_anonymous",
    profileVisuals: DEFAULT_PROFILE_VISUALS,
    ...(overrides ?? {}),
  };
}

export function buildSessionActorFromRecords(input: {
  workspace: WorkspaceRecord;
  user: Pick<UserRecord, "id" | "email" | "username" | "firstName" | "lastName" | "profileVisuals">;
  membership: Pick<WorkspaceMembershipRecord, "workspaceRole" | "membershipSource">;
}): SessionActor {
  return {
    workspaceId: input.workspace.id,
    workspaceName: input.workspace.name,
    workspaceKind: input.workspace.workspaceKind,
    planTier: input.workspace.planTier,
    userId: input.user.id,
    email: input.user.email,
    username: input.user.username,
    firstName: input.user.firstName,
    lastName: input.user.lastName,
    profileVisuals: input.user.profileVisuals ?? DEFAULT_PROFILE_VISUALS,
    organizationCode: input.workspace.organizationCode ?? undefined,
    workspaceRole: input.membership.workspaceRole,
    membershipSource: input.membership.membershipSource,
  };
}

export function hydrateSessionActor(
  actor: SessionActor | null | undefined,
  repositories: RequestRepositoryContext,
  env: Env,
): SessionActor {
  if (!actor) {
    const defaultWorkspace =
      repositories.workspaces.getById(env.DEFAULT_WORKSPACE_ID ?? "workspace_local") ?? null;
    if (defaultWorkspace) {
      return {
        workspaceId: defaultWorkspace.id,
        workspaceName: defaultWorkspace.name,
        workspaceKind: defaultWorkspace.workspaceKind,
        planTier: defaultWorkspace.planTier,
        userId: "guest_anonymous",
        profileVisuals: DEFAULT_PROFILE_VISUALS,
        organizationCode: defaultWorkspace.organizationCode ?? undefined,
      };
    }

    return createFallbackActor(env.DEFAULT_WORKSPACE_ID ?? "workspace_local");
  }

  const workspace = repositories.workspaces.getById(actor.workspaceId);
  const user = repositories.users.getById(actor.userId);
  const membership = repositories.workspaceMemberships.getByWorkspaceAndUser(actor.workspaceId, actor.userId);

  if (!workspace) {
    return createFallbackActor(actor.workspaceId, actor);
  }

  return {
    ...actor,
    workspaceName: workspace.name,
    workspaceKind: workspace.workspaceKind,
    planTier: workspace.planTier,
    organizationCode: workspace.organizationCode ?? undefined,
    email: user?.email ?? actor.email,
    username: user?.username ?? actor.username,
    firstName: user?.firstName ?? actor.firstName,
    lastName: user?.lastName ?? actor.lastName,
    profileVisuals: user?.profileVisuals ?? actor.profileVisuals ?? DEFAULT_PROFILE_VISUALS,
    workspaceRole: membership?.workspaceRole ?? actor.workspaceRole,
    membershipSource: membership?.membershipSource ?? actor.membershipSource,
  };
}
