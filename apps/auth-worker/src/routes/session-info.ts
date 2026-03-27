import type { SessionInfo } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import { getCookieValue, SESSION_COOKIE_NAME, verifySessionClaims } from "../lib/session-cookie";
import type { Env } from "../types";

export async function getSessionInfo(request: Request, env: Env): Promise<Response> {
  const cookieValue = getCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE_NAME);
  const session =
    (await verifySessionClaims(
      cookieValue,
      env.MOCK_SESSION_SIGNING_SECRET ?? "opsui-meets-dev-signing-secret",
    )) ?? null;
  const actor =
    session?.actor ?? {
      workspaceId: env.DEFAULT_WORKSPACE_ID ?? "workspace_local",
      userId: "guest_anonymous",
    };
  const authenticated = actor.userId !== "guest_anonymous";
  const provider = authenticated ? (session?.provider ?? "mock") : "anonymous";

  const response = json({
    authenticated,
    sessionType: authenticated ? "user" : "guest",
    actor,
    provider,
  } satisfies SessionInfo);
  recordAuthMetric(env, {
    route: "session-info",
    status: response.status,
    request,
    outcome: authenticated ? provider : "guest",
    sessionType: authenticated ? "user" : "guest",
  });
  return response;
}
