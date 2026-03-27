import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { ApiError, json } from "../lib/http";
import { buildHookSignatureHeaders } from "../lib/hook-signing";
import { enforceRateLimit } from "../lib/rate-limit";
import { optionalBoolean, optionalEnum, parseJson } from "../lib/request";
import type { UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import type { Env } from "../types";

export async function testPostMeetingHook(request: Request, env: Env): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "post-meeting-hook-test",
    limit: 10,
    windowMs: 60_000,
  });
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<UpdateWorkspacePolicyInput>(request);
  const policy = repositories.policies.getWorkspacePolicy(actor.workspaceId);

  if (!policy) {
    throw new ApiError(404, "workspace_policy_not_found");
  }

  const hook = {
    ...policy.postMeetingHook,
    enabled:
      payload.postMeetingHookEnabled === undefined
        ? policy.postMeetingHook.enabled
        : optionalBoolean(payload.postMeetingHookEnabled),
    deliveryMode:
      payload.postMeetingHookDeliveryMode === undefined
        ? policy.postMeetingHook.deliveryMode
        : optionalEnum(
            payload.postMeetingHookDeliveryMode,
            ["manual", "on_end"] as const,
            "manual",
            "invalid_post_meeting_hook_delivery_mode",
          ),
    targetUrl: normalizeOptionalTargetUrl(payload.postMeetingHookTargetUrl, policy),
    includeAttendance:
      payload.postMeetingHookIncludeAttendance === undefined
        ? policy.postMeetingHook.includeAttendance
        : optionalBoolean(payload.postMeetingHookIncludeAttendance),
    includeActionItems:
      payload.postMeetingHookIncludeActionItems === undefined
        ? policy.postMeetingHook.includeActionItems
        : optionalBoolean(payload.postMeetingHookIncludeActionItems),
    includeRecording:
      payload.postMeetingHookIncludeRecording === undefined
        ? policy.postMeetingHook.includeRecording
        : optionalBoolean(payload.postMeetingHookIncludeRecording),
    secret:
      payload.postMeetingHookClearSecret === true
        ? ""
        : payload.postMeetingHookSecret === undefined
          ? policy.postMeetingHook.secret
          : normalizeOptionalSecret(payload.postMeetingHookSecret),
  };

  if (!hook.enabled) {
    throw new ApiError(409, "post_meeting_hook_disabled");
  }

  if (!hook.targetUrl) {
    throw new ApiError(400, "post_meeting_hook_target_required");
  }

  if (!hook.secret) {
    throw new ApiError(400, "post_meeting_hook_secret_required");
  }

  let ok = false;
  let status = 0;
  const body = JSON.stringify({
    generatedAt: new Date().toISOString(),
    workspaceId: actor.workspaceId,
    event: "meeting.follow_up.test",
    deliveryMode: hook.deliveryMode,
    includes: {
      attendance: hook.includeAttendance,
      actionItems: hook.includeActionItems,
      recording: hook.includeRecording,
    },
  });

  try {
    const signatureHeaders = await buildHookSignatureHeaders(hook.secret, body);
    const response = await fetch(hook.targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-opsui-event": "meeting.follow_up.test",
        "x-opsui-workspace-id": actor.workspaceId,
        ...signatureHeaders,
      },
      body,
    });
    ok = response.ok;
    status = response.status;
  } catch {
    ok = false;
    status = 0;
  }

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: ok ? "post_meeting_hook.tested" : "post_meeting_hook.test_failed",
    target: `${hook.targetUrl} [${status || "network"}]`,
  });
  repositories.hookDeliveries.append({
    workspaceId: actor.workspaceId,
    actor: actor.email ?? actor.userId,
    trigger: "admin_test",
    eventType: "meeting.follow_up.test",
    deliveryMode: hook.deliveryMode,
    targetUrl: hook.targetUrl,
    ok,
    statusCode: status || null,
  });

  const response = json({
    ok,
    status,
    targetUrl: hook.targetUrl,
  });
  recordApiMetric(env, {
    route: "post-meeting-hook-test",
    status: response.status,
    request,
    outcome: ok ? "delivered" : "failed",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  return response;
}

function normalizeOptionalTargetUrl(
  value: unknown,
  policy: WorkspacePolicy,
): string {
  if (value === undefined) {
    return policy.postMeetingHook.targetUrl;
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

function normalizeOptionalSecret(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_post_meeting_hook_secret");
  }

  return value.trim();
}
