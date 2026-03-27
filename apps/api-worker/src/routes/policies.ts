import type { UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { ApiError, json, notFound } from "../lib/http";
import { optionalBoolean, optionalEnum, parseJson } from "../lib/request";
import type { Env } from "../types";

export async function getWorkspacePolicy(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const policy = repositories.policies.getWorkspacePolicy(actor.workspaceId);

  if (!policy) {
    return notFound();
  }

  await repositories.commit();
  return json(toPublicPolicy(policy));
}

export async function updateWorkspacePolicy(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<UpdateWorkspacePolicyInput>(request);
  const existingPolicy = repositories.policies.getWorkspacePolicy(actor.workspaceId);
  if (!existingPolicy) {
    throw new ApiError(404, "workspace_policy_not_found");
  }
  const postMeetingHookEnabled =
    payload.postMeetingHookEnabled === undefined
      ? undefined
      : optionalBoolean(payload.postMeetingHookEnabled);
  const postMeetingHookClearSecret =
    payload.postMeetingHookClearSecret === undefined
      ? undefined
      : optionalBoolean(payload.postMeetingHookClearSecret);
  const postMeetingHookTargetUrl = normalizeOptionalTargetUrl(payload.postMeetingHookTargetUrl);
  const postMeetingHookSecret = normalizeOptionalSecret(payload.postMeetingHookSecret);
  const effectiveHookEnabled = postMeetingHookEnabled ?? existingPolicy.postMeetingHook.enabled;
  const effectiveHookTargetUrl = postMeetingHookTargetUrl ?? existingPolicy.postMeetingHook.targetUrl;
  const effectiveHookSecret = postMeetingHookClearSecret
    ? ""
    : postMeetingHookSecret ?? existingPolicy.postMeetingHook.secret;

  if (effectiveHookEnabled && !effectiveHookTargetUrl) {
    throw new ApiError(400, "post_meeting_hook_target_required");
  }

  if (effectiveHookEnabled && !effectiveHookSecret) {
    throw new ApiError(400, "post_meeting_hook_secret_required");
  }

  const policy = repositories.policies.updateWorkspacePolicy(actor.workspaceId, {
    guestJoinMode:
      payload.guestJoinMode === undefined
        ? undefined
        : optionalEnum(
            payload.guestJoinMode,
            ["open", "restricted", "disabled"] as const,
            "restricted",
            "invalid_guest_join_mode",
          ),
    recordingAccess:
      payload.recordingAccess === undefined
        ? undefined
        : optionalEnum(
            payload.recordingAccess,
            ["owner_host_only", "workspace_admins", "disabled"] as const,
            "owner_host_only",
            "invalid_recording_access",
          ),
    chatMode:
      payload.chatMode === undefined
        ? undefined
        : optionalEnum(
            payload.chatMode,
            ["open", "host_only", "moderated", "disabled"] as const,
            "open",
            "invalid_chat_mode",
          ),
    screenShareMode:
      payload.screenShareMode === undefined
        ? undefined
        : optionalEnum(
            payload.screenShareMode,
            ["hosts_only", "presenters", "everyone"] as const,
            "presenters",
            "invalid_screen_share_mode",
          ),
    mutedOnEntry: payload.mutedOnEntry === undefined ? undefined : optionalBoolean(payload.mutedOnEntry),
    lobbyEnabled: payload.lobbyEnabled === undefined ? undefined : optionalBoolean(payload.lobbyEnabled),
    postMeetingHookEnabled,
    postMeetingHookDeliveryMode:
      payload.postMeetingHookDeliveryMode === undefined
        ? undefined
        : optionalEnum(
            payload.postMeetingHookDeliveryMode,
            ["manual", "on_end"] as const,
            "manual",
            "invalid_post_meeting_hook_delivery_mode",
          ),
    postMeetingHookTargetUrl,
    postMeetingHookSecret,
    postMeetingHookClearSecret,
    postMeetingHookIncludeAttendance:
      payload.postMeetingHookIncludeAttendance === undefined
        ? undefined
        : optionalBoolean(payload.postMeetingHookIncludeAttendance),
    postMeetingHookIncludeActionItems:
      payload.postMeetingHookIncludeActionItems === undefined
        ? undefined
        : optionalBoolean(payload.postMeetingHookIncludeActionItems),
    postMeetingHookIncludeRecording:
      payload.postMeetingHookIncludeRecording === undefined
        ? undefined
        : optionalBoolean(payload.postMeetingHookIncludeRecording),
  });

  if (!policy) {
    throw new ApiError(404, "workspace_policy_not_found");
  }

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "workspace.policy.updated",
    target: `${policy.guestJoinMode}:${policy.recordingAccess}`,
  });
  await repositories.commit();

  return json(toPublicPolicy(policy));
}

function normalizeOptionalTargetUrl(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_post_meeting_hook_target");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ApiError(400, "invalid_post_meeting_hook_target");
    }

    return url.toString();
  } catch {
    throw new ApiError(400, "invalid_post_meeting_hook_target");
  }
}

function normalizeOptionalSecret(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_post_meeting_hook_secret");
  }

  return value.trim();
}

function toPublicPolicy(policy: WorkspacePolicy): WorkspacePolicy {
  return {
    ...policy,
    postMeetingHook: {
      ...policy.postMeetingHook,
      secret: "",
      hasSecret: Boolean(policy.postMeetingHook.secret),
    },
  };
}
