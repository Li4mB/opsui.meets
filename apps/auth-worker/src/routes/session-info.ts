import type { SessionInfo } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { getAuthDataStatus } from "../lib/data-status";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import { createFallbackActor, hydrateSessionActor } from "../lib/session-actors";
import { buildSessionCookie, getSessionSigningSecret } from "../lib/session-config";
import { buildSessionToken, getCookieValue, SESSION_COOKIE_NAME, verifySessionClaims } from "../lib/session-cookie";
import type { Env } from "../types";

export async function getSessionInfo(request: Request, env: Env): Promise<Response> {
  const cookieValue = getCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE_NAME);
  const signingSecret = getSessionSigningSecret(env);
  const session = (await verifySessionClaims(cookieValue, signingSecret)) ?? null;
  const dataStatus = getAuthDataStatus(env);
  const actor =
    dataStatus.authStorageReady
      ? await (async () => {
          const repositories = await getRepositories(env);
          const hydrated = hydrateSessionActor(session?.actor ?? null, repositories, env);
          await repositories.commit();
          return hydrated;
        })()
      : (session?.actor ?? createFallbackActor(env.DEFAULT_WORKSPACE_ID ?? "workspace_local"));
  const authenticated = actor.userId !== "guest_anonymous";
  const provider = authenticated ? (session?.provider ?? "mock") : "anonymous";
  const refreshedSession = authenticated && session
    ? await buildSessionToken(
        {
          actor,
          sessionType: "user",
          provider: session.provider,
        },
        signingSecret,
      )
    : null;

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
        ...(refreshedSession ? { "Set-Cookie": buildSessionCookie(refreshedSession.token, env) } : {}),
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
