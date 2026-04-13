import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";

const AUTH_BASE_URL =
  (typeof window !== "undefined" && window.location.hostname === "localhost")
    ? "http://127.0.0.1:8788"
    : "https://auth.opsuimeets.com";

const SESSION_CACHE_TTL_MS = 30_000;
const FALLBACK_SESSION: SessionInfo = {
  authenticated: false,
  sessionType: "guest",
  actor: {
    workspaceId: "workspace_local",
    workspaceName: "My Workspace",
    workspaceKind: "personal",
    planTier: "standard",
    userId: "guest_anonymous",
  },
};

let sessionCache: { expiresAt: number; value: SessionInfo } | null = null;
let capabilitiesCache: { expiresAt: number; value: AuthCapabilities } | null = null;

export async function getSessionState(forceRefresh = false): Promise<SessionInfo> {
  if (!forceRefresh && sessionCache && sessionCache.expiresAt > Date.now()) {
    return sessionCache.value;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/session`, {
      credentials: "include",
    });

    if (response.ok) {
      const session = (await response.json()) as SessionInfo;
      sessionCache = {
        value: session,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      };
      return session;
    }
  } catch {}

  return FALLBACK_SESSION;
}

export async function getAuthCapabilities(forceRefresh = false): Promise<AuthCapabilities> {
  if (!forceRefresh && capabilitiesCache && capabilitiesCache.expiresAt > Date.now()) {
    return capabilitiesCache.value;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/health`, {
      credentials: "include",
    });

    if (response.ok) {
      const capabilities = (await response.json()) as AuthCapabilities;
      capabilitiesCache = {
        value: capabilities,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      };
      return capabilities;
    }
  } catch {}

  return {
    ok: false,
    service: "opsui-meets-auth",
    appEnv: "unknown",
    mockAuthEnabled: false,
    passwordAuthEnabled: false,
    signupEnabled: false,
    sessionSigningConfigured: false,
    oidcConfigured: false,
    opsuiValidationConfigured: false,
    membershipDirectoryConfigured: false,
    membershipEnforced: false,
    workspaceMappingConfigured: false,
    roleMappingConfigured: false,
    workspaceAllowlistConfigured: false,
    analyticsConfigured: false,
  };
}

export async function getActorHeaders(
  extra?: Record<string, string>,
  options?: { includeJsonContentType?: boolean; forceRefresh?: boolean },
): Promise<Record<string, string>> {
  const session = await getSessionState(options?.forceRefresh);

  return {
    ...(options?.includeJsonContentType ? { "content-type": "application/json" } : {}),
    "x-workspace-id": session.actor.workspaceId,
    "x-user-id": session.actor.userId,
    ...(extra ?? {}),
  };
}

export function startLogin(redirectTo = "/"): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(`${AUTH_BASE_URL}/v1/login`);
  url.searchParams.set("redirectTo", redirectTo);
  window.location.assign(url.toString());
}

export async function logout(): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/logout`, {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      sessionCache = null;
      capabilitiesCache = null;
      return true;
    }
  } catch {}

  return false;
}
