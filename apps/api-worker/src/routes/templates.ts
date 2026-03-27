import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function listTemplates(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  await repositories.commit();
  return json({
    items: repositories.templates.listByWorkspace(actor.workspaceId),
  });
}
