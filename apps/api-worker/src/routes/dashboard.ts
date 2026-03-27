import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function getDashboard(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const summary = repositories.dashboard.getWorkspaceDashboard(actor.workspaceId);
  await repositories.commit();
  return json(summary);
}

export async function getAdminOverview(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const response = json(repositories.dashboard.getAdminOverview(actor.workspaceId));
  await repositories.commit();
  return response;
}
