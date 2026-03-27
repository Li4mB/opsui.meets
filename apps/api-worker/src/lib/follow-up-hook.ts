import type { RepositoryContext } from "@opsui/db";
import type { Env } from "../types";
import { recordApiMetric } from "./analytics";
import { buildMeetingFollowUpPackage, filterHookPayload } from "./follow-up-package";
import { buildHookSignatureHeaders } from "./hook-signing";
import { ApiError } from "./http";

export async function dispatchConfiguredFollowUp(input: {
  env?: Env;
  request?: Request;
  repositories: RepositoryContext;
  meetingInstanceId: string;
  actorLabel: string;
  trigger: "manual_dispatch" | "manual_retry" | "bulk_retry" | "meeting_end_auto";
}): Promise<{ ok: boolean; status: number; targetUrl: string }> {
  const meeting = input.repositories.meetings.getById(input.meetingInstanceId);
  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const policy = input.repositories.policies.getWorkspacePolicy(meeting.workspaceId);
  if (!policy) {
    throw new ApiError(404, "workspace_policy_not_found");
  }

  if (!policy.postMeetingHook.enabled) {
    throw new ApiError(409, "post_meeting_hook_disabled");
  }

  if (!policy.postMeetingHook.targetUrl) {
    throw new ApiError(400, "post_meeting_hook_target_required");
  }

  if (!policy.postMeetingHook.secret) {
    throw new ApiError(400, "post_meeting_hook_secret_required");
  }

  const payload = filterHookPayload(
    buildMeetingFollowUpPackage(input.repositories, input.meetingInstanceId),
    policy,
  );
  const body = JSON.stringify(payload);
  let ok = false;
  let status = 0;

  try {
    const signatureHeaders = await buildHookSignatureHeaders(policy.postMeetingHook.secret, body);
    const response = await fetch(policy.postMeetingHook.targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-opsui-event": "meeting.follow_up",
        "x-opsui-meeting-id": meeting.id,
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

  input.repositories.audit.append({
    actor: input.actorLabel,
    action: ok ? "follow_up.dispatched" : "follow_up.dispatch_failed",
    target: `${meeting.title} -> ${policy.postMeetingHook.targetUrl} [${status || "network"}]`,
  });
  input.repositories.hookDeliveries.append({
    workspaceId: meeting.workspaceId,
    meetingInstanceId: input.meetingInstanceId,
    meetingTitle: meeting.title,
    actor: input.actorLabel,
    trigger: input.trigger,
    eventType: "meeting.follow_up",
    deliveryMode: policy.postMeetingHook.deliveryMode,
    targetUrl: policy.postMeetingHook.targetUrl,
    ok,
    statusCode: status || null,
  });
  input.repositories.events.append({
    meetingInstanceId: input.meetingInstanceId,
    type: "follow_up.dispatched",
    payload: {
      targetUrl: policy.postMeetingHook.targetUrl,
      status,
      ok,
    },
  });
  if (input.env) {
    recordApiMetric(input.env, {
      route: "follow-up-dispatch",
      status: ok ? 200 : 502,
      request: input.request,
      outcome: ok ? input.trigger : `${input.trigger}_failed`,
      workspaceId: meeting.workspaceId,
    });
  }

  return {
    ok,
    status,
    targetUrl: policy.postMeetingHook.targetUrl,
  };
}
