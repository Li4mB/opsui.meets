import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import {
  isMembershipDirectoryConfigured,
  isMembershipDirectoryEnforced,
} from "../lib/membership-directory";
import type { Env } from "../types";

export function getHealth(request: Request, env: Env): Response {
  const oidcConfigured = Boolean(
    env.OIDC_ISSUER_URL &&
      env.OIDC_CLIENT_ID &&
      env.OIDC_CLIENT_SECRET &&
      env.OIDC_REDIRECT_URI,
  );
  const workspaceMappingConfigured = Boolean(
    env.OIDC_WORKSPACE_CLAIM || (env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP && env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP !== "{}"),
  );
  const roleMappingConfigured = Boolean(env.OIDC_ROLE_CLAIM || env.OIDC_DEFAULT_ROLE);
  const workspaceAllowlistConfigured = Boolean(env.OIDC_ALLOWED_WORKSPACE_IDS?.trim());
  const membershipDirectoryConfigured = isMembershipDirectoryConfigured(env);
  const membershipEnforced = isMembershipDirectoryEnforced(env);
  const response = json({
    ok: true,
    service: "opsui-meets-auth",
    appEnv: env.APP_ENV ?? "production",
    mockAuthEnabled: env.ALLOW_MOCK_AUTH === "true",
    sessionSigningConfigured: Boolean(env.MOCK_SESSION_SIGNING_SECRET),
    oidcConfigured,
    membershipDirectoryConfigured,
    membershipEnforced,
    workspaceMappingConfigured,
    roleMappingConfigured,
    workspaceAllowlistConfigured,
    analyticsConfigured: Boolean(env.ANALYTICS),
  }, {
    headers: {
      "access-control-allow-origin": "*",
    },
  });
  recordAuthMetric(env, {
    route: "health",
    status: response.status,
    request,
    outcome: "health",
  });
  return response;
}
