import type { CreateTemplateInput, TemplateSummary, UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import { getActorHeaders } from "./auth";
import { ADMIN_API_BASE_URL } from "./config";

async function getAdminHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  return getActorHeaders(extra, { includeJsonContentType: true });
}

export async function createTemplate(input: CreateTemplateInput): Promise<TemplateSummary> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/templates`, {
    method: "POST",
    headers: await getAdminHeaders({
      "Idempotency-Key": `template:${input.name}:${input.templateType}`,
    }),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to create template."));
  }

  return (await response.json()) as TemplateSummary;
}

export async function updateWorkspacePolicy(
  input: UpdateWorkspacePolicyInput,
): Promise<WorkspacePolicy> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/policies/workspace`, {
    method: "PATCH",
    headers: await getAdminHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to update workspace policy."));
  }

  return (await response.json()) as WorkspacePolicy;
}

export async function testPostMeetingHook(
  input: UpdateWorkspacePolicyInput,
): Promise<{ ok: boolean; status: number; targetUrl: string }> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/policies/workspace/post-meeting-hook/test`, {
    method: "POST",
    headers: await getAdminHeaders({
      "Idempotency-Key": "post-meeting-hook:test",
    }),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to test post-meeting hook."));
  }

  return (await response.json()) as { ok: boolean; status: number; targetUrl: string };
}

export async function retryMeetingFollowUp(
  meetingInstanceId: string,
): Promise<{ ok: boolean; status: number; targetUrl: string }> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/meetings/${meetingInstanceId}/follow-up/retry`, {
    method: "POST",
    headers: await getAdminHeaders({
      "Idempotency-Key": `follow-up-retry:${meetingInstanceId}`,
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to retry follow-up delivery."));
  }

  return (await response.json()) as { ok: boolean; status: number; targetUrl: string };
}

export async function retryFailedMeetingFollowUps(): Promise<{
  totalCandidates: number;
  retriedCount: number;
  successCount: number;
  failureCount: number;
}> {
  const response = await fetch(`${ADMIN_API_BASE_URL}/v1/admin/hooks/retry-failures`, {
    method: "POST",
    headers: await getAdminHeaders({
      "Idempotency-Key": "follow-up-retry:bulk",
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to retry follow-up backlog."));
  }

  return (await response.json()) as {
    totalCandidates: number;
    retriedCount: number;
    successCount: number;
    failureCount: number;
  };
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    switch (payload.error) {
      case "post_meeting_hook_target_required":
        return "Set a hook target URL before enabling or testing delivery.";
      case "post_meeting_hook_secret_required":
        return "Set a signing secret before enabling or testing delivery.";
      case "post_meeting_hook_disabled":
        return "Enable the post-meeting hook before testing delivery.";
      case "invalid_post_meeting_hook_target":
        return "Enter a valid HTTP or HTTPS hook target URL.";
      case "invalid_post_meeting_hook_secret":
        return "Enter a valid signing secret for the hook.";
      default:
        return payload.message ?? fallback;
    }
  } catch {
    return fallback;
  }
}
