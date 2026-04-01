import { LIVE_ROLES, type LiveRole } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { json } from "../lib/http";
import {
  isMembershipDirectoryEnforced,
  resolveMembershipDirectoryEntry,
} from "../lib/membership-directory";
import {
  buildOidcSessionToken,
  buildOidcStateValue,
  getCookieValue,
  getOidcStateCookieName,
  SESSION_COOKIE_NAME,
  verifyOidcStateValue,
} from "../lib/session-cookie";
import type { Env } from "../types";

export async function startOidcLogin(request: Request, env: Env): Promise<Response> {
  const configuration = getOidcConfiguration(env);
  if (!configuration) {
    const response = json(
      {
        error: "oidc_not_configured",
        message: "OIDC login is not configured.",
      },
      { status: 501 },
    );
    recordAuthMetric(env, {
      route: "oidc-login",
      status: response.status,
      request,
      outcome: "not_configured",
    });
    return response;
  }

  const url = new URL(request.url);
  const requestedRedirect = url.searchParams.get("redirectTo");
  const redirectTo =
    requestedRedirect && requestedRedirect.startsWith("/") ? requestedRedirect : "/";
  const signingSecret = env.MOCK_SESSION_SIGNING_SECRET ?? "opsui-meets-dev-signing-secret";
  const stateValue = await buildOidcStateValue(redirectTo, signingSecret);
  const stateClaims = await verifyOidcStateValue(stateValue.value, signingSecret);
  const state = stateClaims?.state ?? crypto.randomUUID();

  const authorizeUrl = new URL(configuration.authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", configuration.clientId);
  authorizeUrl.searchParams.set("redirect_uri", configuration.redirectUri);
  authorizeUrl.searchParams.set("scope", configuration.scope);
  authorizeUrl.searchParams.set("state", state);

  const headers = new Headers();
  headers.set("Location", authorizeUrl.toString());
  headers.append(
    "Set-Cookie",
    [
      `${getOidcStateCookieName()}=${stateValue.value}`,
      `Domain=${env.COOKIE_DOMAIN}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=600",
    ].join("; "),
  );

  const response = new Response(null, {
    status: 302,
    headers,
  });
  recordAuthMetric(env, {
    route: "oidc-login",
    status: response.status,
    request,
    outcome: "redirect",
  });
  return response;
}

export async function handleOidcCallback(request: Request, env: Env): Promise<Response> {
  const configuration = getOidcConfiguration(env);
  if (!configuration) {
    const response = json(
      {
        error: "oidc_not_configured",
        message: "OIDC callback is not configured.",
      },
      { status: 501 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "not_configured",
    });
    return response;
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const signingSecret = env.MOCK_SESSION_SIGNING_SECRET ?? "opsui-meets-dev-signing-secret";
  const stateCookie = getCookieValue(request.headers.get("Cookie") ?? "", getOidcStateCookieName());
  const verifiedState = await verifyOidcStateValue(stateCookie, signingSecret);

  if (!code || !state || !verifiedState || verifiedState.state !== state) {
    const response = json(
      {
        error: "oidc_state_invalid",
        message: "OIDC callback state validation failed.",
      },
      { status: 400 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "state_invalid",
    });
    return response;
  }

  const tokenPayload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    redirect_uri: configuration.redirectUri,
  });
  const tokenResponse = await fetch(configuration.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenPayload.toString(),
  });

  if (!tokenResponse.ok) {
    const response = json(
      {
        error: "oidc_token_exchange_failed",
        status: tokenResponse.status,
      },
      { status: 502 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "token_exchange_failed",
    });
    return response;
  }

  const tokenJson = (await tokenResponse.json().catch(() => null)) as
    | { access_token?: string }
    | null;
  const accessToken = tokenJson?.access_token;
  if (!accessToken) {
    const response = json(
      {
        error: "oidc_access_token_missing",
      },
      { status: 502 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "access_token_missing",
    });
    return response;
  }

  const userInfoResponse = await fetch(configuration.userInfoEndpoint, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userInfoResponse.ok) {
    const response = json(
      {
        error: "oidc_userinfo_failed",
        status: userInfoResponse.status,
      },
      { status: 502 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "userinfo_failed",
    });
    return response;
  }

  const userInfo = (await userInfoResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!userInfo?.sub) {
    const response = json(
      {
        error: "oidc_subject_missing",
      },
      { status: 502 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "subject_missing",
    });
    return response;
  }

  const directoryMembership = resolveMembershipDirectoryEntry(
    {
      provider: "oidc",
      userId: String(userInfo.sub),
      email: typeof userInfo.email === "string" ? userInfo.email : undefined,
    },
    env,
  );
  if (isMembershipDirectoryEnforced(env) && !directoryMembership) {
    const response = json(
      {
        error: "oidc_membership_not_found",
        message: "The authenticated user does not have a configured workspace membership.",
      },
      { status: 403 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "membership_not_found",
    });
    return response;
  }

  const workspaceAccess = directoryMembership
    ? {
        allowed: isWorkspaceAllowed(directoryMembership.workspaceId, env),
        workspaceId: directoryMembership.workspaceId,
        workspaceRole: directoryMembership.workspaceRole,
        membershipSource: directoryMembership.membershipSource,
      }
    : resolveWorkspaceAccess(userInfo, env);
  if (!workspaceAccess.allowed) {
    const response = json(
      {
        error: "oidc_workspace_not_allowed",
        message: "The authenticated user does not belong to an allowed workspace.",
        workspaceId: workspaceAccess.workspaceId,
      },
      { status: 403 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "workspace_not_allowed",
    });
    return response;
  }

  const session = await buildOidcSessionToken(
    {
      workspaceId: workspaceAccess.workspaceId,
      userId: String(userInfo.sub),
      email: typeof userInfo.email === "string" ? userInfo.email : undefined,
      workspaceRole: workspaceAccess.workspaceRole,
      membershipSource: workspaceAccess.membershipSource,
    },
    signingSecret,
  );

  const headers = new Headers();
  headers.set("Location", buildPostAuthRedirectUrl(verifiedState.redirectTo, env));
  headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE_NAME}=${session.token}`,
      `Domain=${env.COOKIE_DOMAIN}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=86400",
    ].join("; "),
  );
  headers.append(
    "Set-Cookie",
    [
      `${getOidcStateCookieName()}=`,
      `Domain=${env.COOKIE_DOMAIN}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=0",
    ].join("; "),
  );

  const response = new Response(null, {
    status: 302,
    headers,
  });
  recordAuthMetric(env, {
    route: "oidc-callback",
    status: response.status,
    request,
    outcome: "authenticated",
    sessionType: "user",
  });
  return response;
}

export function clearSession(request: Request, env: Env): Response {
  const headers = buildClearedSessionHeaders(env);
  headers.set("Cache-Control", "no-store");

  const url = new URL(request.url);
  if (request.method === "GET") {
    headers.set("Location", buildPostAuthRedirectUrl(url.searchParams.get("redirectTo"), env));
    const response = new Response(null, {
      status: 302,
      headers,
    });
    recordAuthMetric(env, {
      route: "session-logout",
      status: response.status,
      request,
      outcome: "cleared",
    });
    return response;
  }

  const response = json(
    {
      ok: true,
    },
    {
      status: 200,
      headers,
    },
  );
  recordAuthMetric(env, {
    route: "session-logout",
    status: response.status,
    request,
    outcome: "cleared",
  });
  return response;
}

interface OidcConfiguration {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
}

export function isOidcConfigured(env: Env): boolean {
  if (!env.OIDC_ISSUER_URL || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET || !env.OIDC_REDIRECT_URI) {
    return false;
  }

  try {
    const issuerUrl = new URL(env.OIDC_ISSUER_URL);
    return issuerUrl.hostname.toLowerCase() !== "manage.auth0.com";
  } catch {
    return false;
  }
}

function getOidcConfiguration(env: Env): OidcConfiguration | null {
  if (!isOidcConfigured(env)) {
    return null;
  }

  const issuerBase = env.OIDC_ISSUER_URL!.replace(/\/+$/, "");
  return {
    issuerUrl: issuerBase,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    redirectUri: env.OIDC_REDIRECT_URI!,
    scope: env.OIDC_SCOPE ?? "openid profile email",
    authorizationEndpoint: env.OIDC_AUTHORIZATION_ENDPOINT ?? `${issuerBase}/authorize`,
    tokenEndpoint: env.OIDC_TOKEN_ENDPOINT ?? `${issuerBase}/oauth/token`,
    userInfoEndpoint: env.OIDC_USERINFO_ENDPOINT ?? `${issuerBase}/userinfo`,
  };
}

function buildPostAuthRedirectUrl(redirectTo: string | null, env: Env): string {
  const pathname = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
  const appBaseUrl = resolvePublicAppUrl(env);
  return new URL(pathname, appBaseUrl).toString();
}

function resolvePublicAppUrl(env: Env): string {
  const explicitUrl = env.PUBLIC_APP_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.endsWith("/") ? explicitUrl : `${explicitUrl}/`;
  }

  const cookieDomain = env.COOKIE_DOMAIN.replace(/^\.+/, "").trim();
  return `https://${cookieDomain}/`;
}

function buildClearedSessionHeaders(env: Env): Headers {
  const headers = new Headers();

  appendExpiredCookie(headers, SESSION_COOKIE_NAME, env.COOKIE_DOMAIN);
  appendExpiredCookie(headers, getOidcStateCookieName(), env.COOKIE_DOMAIN);

  return headers;
}

function appendExpiredCookie(headers: Headers, name: string, cookieDomain: string): void {
  headers.append(
    "Set-Cookie",
    [
      `${name}=`,
      `Domain=${cookieDomain}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "Max-Age=0",
    ].join("; "),
  );
}

interface WorkspaceAccess {
  allowed: boolean;
  workspaceId: string;
  workspaceRole: LiveRole;
  membershipSource:
    | "oidc_claim"
    | "oidc_domain"
    | "oidc_default"
    | "oidc_directory_email"
    | "oidc_directory_user";
}

function resolveWorkspaceAccess(userInfo: Record<string, unknown>, env: Env): WorkspaceAccess {
  const target = resolveWorkspaceTarget(userInfo, env);
  return {
    allowed: isWorkspaceAllowed(target.workspaceId, env),
    workspaceId: target.workspaceId,
    workspaceRole: resolveWorkspaceRole(userInfo, env),
    membershipSource: target.membershipSource,
  };
}

function resolveWorkspaceTarget(
  userInfo: Record<string, unknown>,
  env: Env,
): Pick<WorkspaceAccess, "workspaceId" | "membershipSource"> {
  const claimName = env.OIDC_WORKSPACE_CLAIM?.trim();
  if (claimName) {
    const claimValue = userInfo[claimName];
    if (typeof claimValue === "string" && claimValue.trim()) {
      return {
        workspaceId: claimValue.trim(),
        membershipSource: "oidc_claim",
      };
    }
  }

  const email = typeof userInfo.email === "string" ? userInfo.email : "";
  const domain = email.includes("@") ? email.split("@")[1]?.toLowerCase() ?? "" : "";
  const mappedWorkspace = getWorkspaceMap(env)[domain];
  if (mappedWorkspace) {
    return {
      workspaceId: mappedWorkspace,
      membershipSource: "oidc_domain",
    };
  }

  return {
    workspaceId: env.DEFAULT_WORKSPACE_ID ?? "workspace_local",
    membershipSource: "oidc_default",
  };
}

function resolveWorkspaceRole(userInfo: Record<string, unknown>, env: Env): LiveRole {
  const claimName = env.OIDC_ROLE_CLAIM?.trim();
  if (claimName) {
    const claimValue = userInfo[claimName];
    const normalizedClaimRole =
      typeof claimValue === "string"
        ? normalizeLiveRole(claimValue)
        : Array.isArray(claimValue)
          ? normalizeLiveRole(claimValue.find((item) => typeof item === "string") ?? "")
          : null;
    if (normalizedClaimRole) {
      return normalizedClaimRole;
    }
  }

  return normalizeLiveRole(env.OIDC_DEFAULT_ROLE ?? "") ?? "participant";
}

function getWorkspaceMap(env: Env): Record<string, string> {
  const raw = env.OIDC_EMAIL_DOMAIN_WORKSPACE_MAP;
  if (!raw) {
    return {};
  }

  try {
    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : ((raw as Record<string, unknown>) ?? {});
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1].trim()),
      ),
    );
  } catch {
    return {};
  }
}

function isWorkspaceAllowed(workspaceId: string, env: Env): boolean {
  const allowedSource =
    typeof env.OIDC_ALLOWED_WORKSPACE_IDS === "string" ? env.OIDC_ALLOWED_WORKSPACE_IDS : "";
  const allowed = allowedSource.split(",").map((value) => value.trim()).filter(Boolean);

  if (!allowed.length) {
    return true;
  }

  return allowed.includes(workspaceId);
}

function normalizeLiveRole(value: string): LiveRole | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LIVE_ROLES.includes(normalized as LiveRole) ? (normalized as LiveRole) : null;
}
