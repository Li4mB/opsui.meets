import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { enrichHookDeliveryAttempts } from "../lib/hook-delivery-view";
import { summarizeHookDeliveries } from "../lib/hook-delivery-summary";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function getAdminHookDeliveries(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const items = enrichHookDeliveryAttempts(
    repositories,
    repositories.hookDeliveries.listRecentByWorkspace(actor.workspaceId),
  );

  const response = json({
    items,
    summary: summarizeHookDeliveries(items),
  });
  await repositories.commit();
  return response;
}
