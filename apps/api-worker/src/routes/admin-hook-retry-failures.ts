import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { dispatchConfiguredFollowUp } from "../lib/follow-up-hook";
import { enrichHookDeliveryAttempts } from "../lib/hook-delivery-view";
import { summarizeHookDeliveries } from "../lib/hook-delivery-summary";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function retryAdminHookFailures(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const attempts = enrichHookDeliveryAttempts(
    repositories,
    repositories.hookDeliveries.listRecentByWorkspace(actor.workspaceId, 100),
  );
  const candidates = summarizeHookDeliveries(attempts).attentionItems;
  const results: Array<{
    meetingInstanceId: string;
    meetingTitle?: string;
    ok: boolean;
    status: number;
    targetUrl: string;
  }> = [];

  for (const attempt of candidates) {
    const result = await dispatchConfiguredFollowUp({
      env,
      request,
      repositories,
      meetingInstanceId: attempt.meetingInstanceId!,
      actorLabel: actor.email ?? actor.userId,
      trigger: "bulk_retry",
    });

    results.push({
      meetingInstanceId: attempt.meetingInstanceId!,
      meetingTitle: attempt.meetingTitle,
      ok: result.ok,
      status: result.status,
      targetUrl: result.targetUrl,
    });
  }

  const response = json({
    totalCandidates: candidates.length,
    retriedCount: results.length,
    successCount: results.filter((item) => item.ok).length,
    failureCount: results.filter((item) => !item.ok).length,
    items: results,
  });
  recordApiMetric(env, {
    route: "admin-hook-retry-failures",
    status: response.status,
    request,
    outcome: results.some((item) => !item.ok) ? "partial_failure" : "completed",
    workspaceId: actor.workspaceId,
  });
  await repositories.commit();
  return response;
}
