import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { API_BASE_URL, AUTH_BASE_URL } from "./config";

export interface JoinTokenResponse {
  token: string;
  cookieDomain: string;
}

const SESSION_CACHE_TTL_MS = 30_000;
const LOCAL_DEV_SESSION_STORAGE_KEY = "opsui-meets.local-dev-session";
const FALLBACK_SESSION: SessionInfo = {
  authenticated: false,
  sessionType: "guest",
  actor: {
    workspaceId: "workspace_local",
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
      cache: "no-store",
      credentials: "include",
    });
    if (response.ok) {
      const session = (await response.json()) as SessionInfo;
      const nextSession =
        shouldEnableLocalDevAuth() && !session.authenticated
          ? readLocalDevSession() ?? session
          : session;
      sessionCache = {
        value: nextSession,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      };
      return nextSession;
    }
  } catch {}

  const localDevSession = readLocalDevSession();
  if (localDevSession) {
    sessionCache = {
      value: localDevSession,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    };
    return localDevSession;
  }

  sessionCache = {
    value: FALLBACK_SESSION,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  };
  return FALLBACK_SESSION;
}

export async function getAuthCapabilities(forceRefresh = false): Promise<AuthCapabilities> {
  if (!forceRefresh && capabilitiesCache && capabilitiesCache.expiresAt > Date.now()) {
    return capabilitiesCache.value;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/health`, {
      cache: "no-store",
      credentials: "include",
    });
    if (response.ok) {
      const capabilities = (await response.json()) as AuthCapabilities;
      const nextCapabilities = shouldEnableLocalDevAuth()
        ? {
            ...capabilities,
            mockAuthEnabled: capabilities.mockAuthEnabled || !capabilities.oidcConfigured,
          }
        : capabilities;
      capabilitiesCache = {
        value: nextCapabilities,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      };
      return nextCapabilities;
    }
  } catch {}

  const fallbackCapabilities = {
    ok: false,
    service: "opsui-meets-auth",
    appEnv: "unknown",
    mockAuthEnabled: shouldEnableLocalDevAuth(),
    sessionSigningConfigured: false,
    oidcConfigured: false,
    membershipDirectoryConfigured: false,
    membershipEnforced: false,
    workspaceMappingConfigured: false,
    roleMappingConfigured: false,
    workspaceAllowlistConfigured: false,
    analyticsConfigured: false,
  };
  capabilitiesCache = {
    value: fallbackCapabilities,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  };
  return fallbackCapabilities;
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
    ...(session.actor.email ? { "x-user-email": session.actor.email } : {}),
    ...(session.actor.workspaceRole ? { "x-workspace-role": session.actor.workspaceRole } : {}),
    ...(extra ?? {}),
  };
}

export async function issueMockSession(input?: { email?: string; userId?: string }): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/session/mock`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: input?.email?.trim() || undefined,
        userId: input?.userId?.trim() || undefined,
      }),
    });

    if (response.ok) {
      clearLocalDevSession();
      sessionCache = null;
      capabilitiesCache = null;
      return true;
    }
  } catch {}

  if (shouldEnableLocalDevAuth()) {
    const nextSession = createLocalDevSession(input);
    writeLocalDevSession(nextSession);
    sessionCache = {
      value: nextSession,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    };
    capabilitiesCache = null;
    return true;
  }

  return false;
}

export function startLogin(redirectTo = "/"): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(`${AUTH_BASE_URL}/v1/login`);
  url.searchParams.set("redirectTo", redirectTo);
  window.location.assign(url.toString());
}

export function startLogout(redirectTo = "/sign-in"): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(`${AUTH_BASE_URL}/v1/logout`);
  url.searchParams.set("redirectTo", redirectTo);
  window.location.assign(url.toString());
}

export async function logout(): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/logout`, {
      cache: "no-store",
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      clearLocalDevSession();
      sessionCache = null;
      capabilitiesCache = null;
      return true;
    }
  } catch {}

  if (clearLocalDevSession()) {
    sessionCache = null;
    capabilitiesCache = null;
    return true;
  }

  return false;
}

export function getSessionDisplayName(session: SessionInfo | null): string {
  const raw = session?.actor.email ?? session?.actor.userId ?? "Guest User";
  const localPart = raw.includes("@") ? raw.split("@")[0] ?? raw : raw;
  const cleaned = localPart.replace(/[_.-]+/g, " ").trim();

  if (!cleaned) {
    return "Guest User";
  }

  return cleaned.replace(/\b\w/g, (value) => value.toUpperCase());
}

export function shouldUseRedirectLogout(): boolean {
  return typeof window !== "undefined" && !shouldEnableLocalDevAuth();
}

function shouldEnableLocalDevAuth(): boolean {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function createLocalDevSession(input?: { email?: string; userId?: string }): SessionInfo {
  const email = input?.email?.trim() || "member@example.com";
  const userId =
    input?.userId?.trim() ||
    `mock_${(email.split("@")[0] ?? "member").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;

  return {
    authenticated: true,
    sessionType: "user",
    provider: "mock",
    actor: {
      workspaceId: "workspace_local",
      userId,
      email,
      workspaceRole: "owner",
      membershipSource: "mock",
    },
  };
}

function readLocalDevSession(): SessionInfo | null {
  if (!shouldEnableLocalDevAuth()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_DEV_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SessionInfo;
  } catch {
    return null;
  }
}

function writeLocalDevSession(session: SessionInfo): void {
  if (!shouldEnableLocalDevAuth()) {
    return;
  }

  window.localStorage.setItem(LOCAL_DEV_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearLocalDevSession(): boolean {
  if (!shouldEnableLocalDevAuth()) {
    return false;
  }

  const hadSession = window.localStorage.getItem(LOCAL_DEV_SESSION_STORAGE_KEY) !== null;
  window.localStorage.removeItem(LOCAL_DEV_SESSION_STORAGE_KEY);
  return hadSession;
}

export { API_BASE_URL };
