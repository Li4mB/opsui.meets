import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import {
  isMembershipDirectoryConfigured,
  isMembershipDirectoryEnforced,
} from "../lib/membership-directory";
import { isOpsuiValidationConfigured } from "../lib/opsui-validation";
import { isOidcConfigured } from "./oidc";
import type { Env } from "../types";

export function getHealth(request: Request, env: Env): Response {
  const oidcConfigured = isOidcConfigured(env);
  const workspaceMappingConfigured = Boolean(
    env.OIDC_WORKSPACE_CLAIM ||
      (typeof env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP === "string"
        ? env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP !== "{}"
        : Boolean(env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP)),
  );
  const roleMappingConfigured = Boolean(env.OIDC_ROLE_CLAIM || env.OIDC_DEFAULT_ROLE);
  const workspaceAllowlistConfigured = Boolean(
    typeof env.OIDC_ALLOWED_WORKSPACE_IDS === "string" && env.OIDC_ALLOWED_WORKSPACE_IDS.trim(),
  );
  const membershipDirectoryConfigured = isMembershipDirectoryConfigured(env);
  const membershipEnforced = isMembershipDirectoryEnforced(env);
  const response = json({
    ok: true,
    service: "opsui-meets-auth",
    appEnv: env.APP_ENV ?? "production",
    mockAuthEnabled: env.ALLOW_MOCK_AUTH === "true",
    passwordAuthEnabled: Boolean(env.AUTH_PASSWORD_PEPPER?.trim()),
    signupEnabled: Boolean(env.AUTH_PASSWORD_PEPPER?.trim()),
    sessionSigningConfigured: Boolean(env.SESSION_SIGNING_SECRET?.trim() || env.MOCK_SESSION_SIGNING_SECRET),
    oidcConfigured,
    opsuiValidationConfigured: isOpsuiValidationConfigured(env),
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
