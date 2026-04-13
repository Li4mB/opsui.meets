import type { SessionInfo } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import { createFallbackActor, hydrateSessionActor } from "../lib/session-actors";
import { getSessionSigningSecret } from "../lib/session-config";
import { getCookieValue, SESSION_COOKIE_NAME, verifySessionClaims } from "../lib/session-cookie";
import type { Env } from "../types";

export async function getSessionInfo(request: Request, env: Env): Promise<Response> {
  const cookieValue = getCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE_NAME);
  const session = (await verifySessionClaims(cookieValue, getSessionSigningSecret(env))) ?? null;
  const repositories = await getRepositories(env);
  const actor = hydrateSessionActor(session?.actor ?? null, repositories, env);
  await repositories.commit();
  const authenticated = actor.userId !== "guest_anonymous";
  const provider = authenticated ? (session?.provider ?? "mock") : "anonymous";

  const response = json(
    {
      authenticated,
      sessionType: authenticated ? "user" : "guest",
      actor,
      provider,
    } satisfies SessionInfo,
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  recordAuthMetric(env, {
    route: "session-info",
    status: response.status,
    request,
    outcome: authenticated ? provider : "guest",
    sessionType: authenticated ? "user" : "guest",
  });
  return response;
}
