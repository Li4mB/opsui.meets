import { LIVE_ROLES, type LiveRole } from "@opsui/shared-types";
import { recordAuthMetric } from "../lib/analytics";
import { normalizeEmail, prettifyEmailLocalPart, validateUsername } from "../lib/account-identity";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import {
  isMembershipDirectoryEnforced,
  resolveMembershipDirectoryEntry,
} from "../lib/membership-directory";
import { buildSessionActorFromRecords } from "../lib/session-actors";
import {
  buildPendingOidcAccountValue,
  buildOidcSessionToken,
  buildOidcStateValue,
  getCookieValue,
  getOidcPendingCookieName,
  getOidcStateCookieName,
  SESSION_COOKIE_NAME,
  verifyPendingOidcAccountValue,
  verifyOidcStateValue,
} from "../lib/session-cookie";
import { buildSessionCookie, getSessionSigningSecret } from "../lib/session-config";
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
  const signingSecret = getSessionSigningSecret(env);
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
  const signingSecret = getSessionSigningSecret(env);
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
        membershipSource: normalizeOidcMembershipSource(directoryMembership.membershipSource),
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

  const subject = String(userInfo.sub);
  const repositories = await getRepositories(env);
  const existingIdentity = repositories.externalAuthIdentities.getByProviderAndSubject("oidc", subject);

  if (existingIdentity) {
    const user = repositories.users.getById(existingIdentity.userId);
    const membership = user ? repositories.workspaceMemberships.listByUser(user.id)[0] ?? null : null;
    const workspace = membership ? repositories.workspaces.getById(membership.workspaceId) : null;
    await repositories.commit();

    if (!user || !membership || !workspace) {
      const response = json(
        {
          error: "oidc_account_missing",
          message: "The linked OpsUI Meets account could not be loaded.",
        },
        { status: 409 },
      );
      recordAuthMetric(env, {
        route: "oidc-callback",
        status: response.status,
        request,
        outcome: "account_missing",
      });
      return response;
    }

    const actor = buildSessionActorFromRecords({
      workspace,
      user,
      membership,
    });
    const session = await buildOidcSessionToken(actor, signingSecret);
    const headers = new Headers();
    headers.set("Location", buildPostAuthRedirectUrl(verifiedState.redirectTo, env));
    headers.append("Set-Cookie", buildSessionCookie(session.token, env));
    appendExpiredCookie(headers, getOidcStateCookieName(), env.COOKIE_DOMAIN);
    appendExpiredCookie(headers, getOidcPendingCookieName(), env.COOKIE_DOMAIN);

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

  const workspace = repositories.workspaces.getById(workspaceAccess.workspaceId);
  await repositories.commit();
  if (!workspace) {
    const response = json(
      {
        error: "oidc_workspace_not_found",
        message: "The workspace for this sign-in could not be found.",
      },
      { status: 409 },
    );
    recordAuthMetric(env, {
      route: "oidc-callback",
      status: response.status,
      request,
      outcome: "workspace_missing",
    });
    return response;
  }

  const email = normalizeEmail(typeof userInfo.email === "string" ? userInfo.email : "");
  const names = resolvePendingAccountNames(userInfo, email);
  const pending = await buildPendingOidcAccountValue(
    {
      subject,
      email,
      firstName: names.firstName,
      lastName: names.lastName,
      workspaceId: workspace.id,
      workspaceRole: workspaceAccess.workspaceRole,
      membershipSource: workspaceAccess.membershipSource,
      redirectTo: verifiedState.redirectTo,
    },
    signingSecret,
  );

  const headers = new Headers();
  headers.set("Location", buildPostAuthRedirectUrl("/complete-account", env));
  headers.append(
    "Set-Cookie",
    buildCookie(getOidcPendingCookieName(), pending.value, env.COOKIE_DOMAIN, 600),
  );
  appendExpiredCookie(headers, getOidcStateCookieName(), env.COOKIE_DOMAIN);

  const response = new Response(null, {
    status: 302,
    headers,
  });
  recordAuthMetric(env, {
    route: "oidc-callback",
    status: response.status,
    request,
    outcome: "pending_completion",
  });
  return response;
}

export async function completeOidcAccount(request: Request, env: Env): Promise<Response> {
  const signingSecret = getSessionSigningSecret(env);
  const pendingCookie = getCookieValue(request.headers.get("Cookie") ?? "", getOidcPendingCookieName());
  const pending = await verifyPendingOidcAccountValue(pendingCookie, signingSecret);
  if (!pending) {
    const response = json(
      {
        error: "oidc_completion_not_available",
        message: "Start sign-in with your identity provider before completing your account.",
      },
      { status: 401 },
    );
    recordAuthMetric(env, {
      route: "oidc-complete-account",
      status: response.status,
      request,
      outcome: "pending_missing",
    });
    return response;
  }

  const body = (await request.json().catch(() => null)) as { username?: string } | null;
  const usernameResult = validateUsername(body?.username);
  if (!usernameResult.ok) {
    const response = json(
      {
        error: usernameResult.error,
        message: usernameResult.message,
      },
      { status: 400 },
    );
    recordAuthMetric(env, {
      route: "oidc-complete-account",
      status: response.status,
      request,
      outcome: "invalid_input",
    });
    return response;
  }

  const repositories = await getRepositories(env);
  if (repositories.users.getByNormalizedUsername(usernameResult.value.usernameNormalized)) {
    await repositories.commit();
    const response = json(
      {
        error: "username_already_exists",
        message: "That username is already taken.",
      },
      { status: 409 },
    );
    recordAuthMetric(env, {
      route: "oidc-complete-account",
      status: response.status,
      request,
      outcome: "duplicate_username",
    });
    return response;
  }

  const existingIdentity = repositories.externalAuthIdentities.getByProviderAndSubject("oidc", pending.subject);
  if (existingIdentity) {
    const user = repositories.users.getById(existingIdentity.userId);
    const membership = user ? repositories.workspaceMemberships.listByUser(user.id)[0] ?? null : null;
    const workspace = membership ? repositories.workspaces.getById(membership.workspaceId) : null;
    await repositories.commit();

    if (!user || !membership || !workspace) {
      const response = json(
        {
          error: "oidc_account_missing",
          message: "The linked OpsUI Meets account could not be loaded.",
        },
        { status: 409 },
      );
      recordAuthMetric(env, {
        route: "oidc-complete-account",
        status: response.status,
        request,
        outcome: "account_missing",
      });
      return response;
    }

    return issueCompletedOidcSession(request, env, signingSecret, pending.redirectTo, {
      workspace,
      user,
      membership,
    });
  }

  if (pending.email && repositories.users.getByEmail(pending.email)) {
    await repositories.commit();
    const response = json(
      {
        error: "email_already_exists",
        message: "An account with that email already exists.",
      },
      { status: 409 },
    );
    recordAuthMetric(env, {
      route: "oidc-complete-account",
      status: response.status,
      request,
      outcome: "duplicate_email",
    });
    return response;
  }

  const workspace = repositories.workspaces.getById(pending.workspaceId);
  if (!workspace) {
    await repositories.commit();
    const response = json(
      {
        error: "oidc_workspace_not_found",
        message: "The workspace for this sign-in could not be found.",
      },
      { status: 409 },
    );
    recordAuthMetric(env, {
      route: "oidc-complete-account",
      status: response.status,
      request,
      outcome: "workspace_missing",
    });
    return response;
  }

  const timestamp = new Date().toISOString();
  const user = {
    id: `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    email: pending.email || `oidc-${pending.subject}@opsuimeets.local`,
    username: usernameResult.value.username,
    usernameNormalized: usernameResult.value.usernameNormalized,
    firstName: pending.firstName,
    lastName: pending.lastName,
    displayName: `${pending.firstName} ${pending.lastName}`.trim() || pending.firstName || usernameResult.value.username,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const membership = {
    id: `membership_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    workspaceId: workspace.id,
    userId: user.id,
    workspaceRole: pending.workspaceRole,
    membershipSource: pending.membershipSource,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  repositories.users.create(user);
  repositories.workspaceMemberships.create(membership);
  repositories.externalAuthIdentities.create({
    id: `extauth_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    provider: "oidc",
    subject: pending.subject,
    userId: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repositories.commit();

  return issueCompletedOidcSession(request, env, signingSecret, pending.redirectTo, {
    workspace,
    user,
    membership,
  });
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

  headers.set("content-type", "application/json; charset=utf-8");
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
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
  appendExpiredCookie(headers, getOidcPendingCookieName(), env.COOKIE_DOMAIN);

  return headers;
}

function appendExpiredCookie(headers: Headers, name: string, cookieDomain: string): void {
  headers.append("Set-Cookie", buildCookie(name, "", cookieDomain, 0));
}

function buildCookie(name: string, value: string, cookieDomain: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    `Domain=${cookieDomain}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(maxAgeSeconds === 0 ? ["Expires=Thu, 01 Jan 1970 00:00:00 GMT"] : []),
  ].join("; ");
}

async function issueCompletedOidcSession(
  request: Request,
  env: Env,
  signingSecret: string,
  redirectTo: string | null,
  input: Parameters<typeof buildSessionActorFromRecords>[0],
): Promise<Response> {
  const actor = buildSessionActorFromRecords(input);
  const session = await buildOidcSessionToken(actor, signingSecret);
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.append("Set-Cookie", buildSessionCookie(session.token, env));
  appendExpiredCookie(headers, getOidcPendingCookieName(), env.COOKIE_DOMAIN);
  appendExpiredCookie(headers, getOidcStateCookieName(), env.COOKIE_DOMAIN);

  const response = new Response(
    JSON.stringify({
      ok: true,
      actor,
      expiresAt: session.expiresAt,
      redirectTo: redirectTo && redirectTo.startsWith("/") ? redirectTo : "/",
    }),
    {
      status: 200,
      headers,
    },
  );
  recordAuthMetric(env, {
    route: "oidc-complete-account",
    status: response.status,
    request,
    outcome: "completed",
    sessionType: "user",
  });
  return response;
}

function resolvePendingAccountNames(
  userInfo: Record<string, unknown>,
  email: string,
): { firstName: string; lastName: string } {
  const givenName = typeof userInfo.given_name === "string" ? userInfo.given_name.trim() : "";
  const familyName = typeof userInfo.family_name === "string" ? userInfo.family_name.trim() : "";
  if (givenName) {
    return {
      firstName: givenName,
      lastName: familyName,
    };
  }

  const fullName = typeof userInfo.name === "string" ? userInfo.name.trim() : "";
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length) {
      return {
        firstName: parts[0] ?? prettifyEmailLocalPart(email || String(userInfo.sub ?? "member")),
        lastName: parts.slice(1).join(" "),
      };
    }
  }

  return {
    firstName: prettifyEmailLocalPart(email || String(userInfo.sub ?? "member")),
    lastName: "",
  };
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

function normalizeOidcMembershipSource(
  membershipSource: WorkspaceAccess["membershipSource"] | "mock_directory_email" | "mock_directory_user",
): WorkspaceAccess["membershipSource"] {
  if (
    membershipSource === "oidc_claim" ||
    membershipSource === "oidc_domain" ||
    membershipSource === "oidc_default" ||
    membershipSource === "oidc_directory_email" ||
    membershipSource === "oidc_directory_user"
  ) {
    return membershipSource;
  }

  return membershipSource === "mock_directory_user" ? "oidc_directory_user" : "oidc_directory_email";
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
