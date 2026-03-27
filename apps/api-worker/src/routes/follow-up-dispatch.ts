import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { dispatchConfiguredFollowUp } from "../lib/follow-up-hook";
import { enforceRateLimit } from "../lib/rate-limit";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function dispatchFollowUp(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "follow-up-dispatch",
    limit: 20,
    windowMs: 60_000,
  });
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const result = await dispatchConfiguredFollowUp({
    env,
    request,
    repositories,
    meetingInstanceId,
    actorLabel: actor.email ?? actor.userId,
    trigger: "manual_dispatch",
  });
  await repositories.commit();
  return json(result);
}
