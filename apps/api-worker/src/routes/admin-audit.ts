import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function getAdminAudit(env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const response = json({
    items: repositories.audit.listRecent(),
  });
  await repositories.commit();
  return response;
}
