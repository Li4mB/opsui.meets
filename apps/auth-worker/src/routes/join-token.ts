import type { JoinTokenClaims } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import type { Env } from "../types";

export async function issueJoinToken(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as Partial<{
    roomId: string;
    meetingInstanceId: string;
    displayName: string;
  }>;

  const tokenPayload: JoinTokenClaims = {
    sub: crypto.randomUUID(),
    roomId: payload.roomId ?? "room_local",
    meetingInstanceId: payload.meetingInstanceId ?? "meeting_instance_local",
    displayName: payload.displayName ?? "Guest",
    exp: Date.now() + 5 * 60 * 1000,
  };

  const response = json({
    token: toBase64Url(JSON.stringify(tokenPayload)),
    cookieDomain: env.COOKIE_DOMAIN,
  });
  recordAuthMetric(env, {
    route: "join-token",
    status: response.status,
    request,
    outcome: "issued",
    sessionType: "guest",
  });
  return response;
}

function toBase64Url(value: string): string {
  const base64 = btoa(value);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
