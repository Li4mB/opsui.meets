import type { SessionActor } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import {
  isMembershipDirectoryEnforced,
  resolveMembershipDirectoryEntry,
} from "../lib/membership-directory";
import { prettifyEmailLocalPart } from "../lib/account-identity";
import { createFallbackActor } from "../lib/session-actors";
import { buildSessionCookie, getSessionSigningSecret } from "../lib/session-config";
import { buildMockSessionToken, SESSION_COOKIE_NAME } from "../lib/session-cookie";
import type { Env } from "../types";

export async function issueMockSession(request: Request, env: Env): Promise<Response> {
  const requestBody = await request.json().catch(() => null) as
    | { email?: string; userId?: string }
    | null;
  const directoryMembership = resolveMembershipDirectoryEntry(
    {
      provider: "mock",
      userId: requestBody?.userId,
      email: requestBody?.email ?? env.MOCK_AUTH_DEFAULT_EMAIL,
    },
    env,
  );
  if (isMembershipDirectoryEnforced(env) && !directoryMembership) {
    const response = json(
      {
        error: "mock_membership_not_found",
        message: "Mock auth requires a configured workspace membership entry.",
      },
      { status: 403 },
    );
    recordAuthMetric(env, {
      route: "session-mock",
      status: response.status,
      request,
      outcome: "membership_not_found",
      sessionType: "user",
    });
    return response;
  }

  const actor: SessionActor = directoryMembership
    ? {
        workspaceId: directoryMembership.workspaceId,
        workspaceName: "My Workspace",
        workspaceKind: "personal",
        planTier: "standard",
        userId:
          requestBody?.userId?.trim() ||
          directoryMembership.userId ||
          `mock_email_${(directoryMembership.email ?? "member").replace(/[^a-z0-9]+/gi, "_")}`,
        email: requestBody?.email ?? directoryMembership.email,
        username: prettifyEmailLocalPart(requestBody?.email ?? directoryMembership.email ?? "member")
          .replace(/\s+/g, "")
          .toLowerCase(),
        firstName: prettifyEmailLocalPart(requestBody?.email ?? directoryMembership.email ?? "member"),
        lastName: "User",
        workspaceRole: directoryMembership.workspaceRole,
        membershipSource: directoryMembership.membershipSource,
      }
    : createFallbackActor(env.DEFAULT_WORKSPACE_ID ?? "workspace_local", {
        userId: `mock_user_${crypto.randomUUID().slice(0, 8)}`,
        username: `mockuser${crypto.randomUUID().slice(0, 4).toLowerCase()}`,
        firstName: "Mock",
        lastName: "User",
        workspaceRole: "owner",
        membershipSource: "mock",
      });
  const signingSecret = getSessionSigningSecret(env);
  const session = await buildMockSessionToken(actor, signingSecret);
  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(session.token, env));

  const response = json(
    {
      ok: true,
      actor,
      expiresAt: session.expiresAt,
      membershipDirectoryUsed: Boolean(directoryMembership),
    },
    {
      status: 200,
      headers,
    },
  );
  recordAuthMetric(env, {
    route: "session-mock",
    status: response.status,
    request,
    outcome: "issued",
    sessionType: "user",
  });
  return response;
}
