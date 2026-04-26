import {
  DEFAULT_PROFILE_VISUALS,
  type AuthCapabilities,
  type OrganisationProfile,
  type ProfileVisuals,
  type SessionInfo,
} from "@opsui/shared-types";
import { API_BASE_URL, AUTH_BASE_URL } from "./config";

export interface JoinTokenResponse {
  token: string;
  cookieDomain: string;
}

const SESSION_CACHE_TTL_MS = 30_000;
const STALE_AUTHENTICATED_SESSION_GRACE_MS = 5 * 60_000;
const LOCAL_DEV_SESSION_STORAGE_KEY = "opsui-meets.local-dev-session";
const FALLBACK_SESSION: SessionInfo = {
  authenticated: false,
  sessionType: "guest",
  actor: {
    workspaceId: "workspace_local",
    workspaceName: "My Workspace",
    workspaceKind: "personal",
    planTier: "standard",
    userId: "guest_anonymous",
    profileVisuals: DEFAULT_PROFILE_VISUALS,
  },
};

let sessionCache: { expiresAt: number; value: SessionInfo } | null = null;
let capabilitiesCache: { expiresAt: number; value: AuthCapabilities } | null = null;

export async function getSessionState(forceRefresh = false): Promise<SessionInfo> {
  if (!forceRefresh && sessionCache && sessionCache.expiresAt > Date.now()) {
    return sessionCache.value;
  }

  const staleSession = sessionCache?.value ?? null;
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

  if (staleSession?.authenticated) {
    sessionCache = {
      value: staleSession,
      expiresAt: Date.now() + STALE_AUTHENTICATED_SESSION_GRACE_MS,
    };
    return staleSession;
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
    dataMode: "memory" as const,
    databaseConfigured: false,
    authStorageReady: false,
    persistenceReason: "postgres_unconfigured" as const,
    mockAuthEnabled: shouldEnableLocalDevAuth(),
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

  return buildActorHeadersFromSession(session, extra, options);
}

export function buildActorHeadersFromSession(
  session: SessionInfo | null | undefined,
  extra?: Record<string, string>,
  options?: { includeJsonContentType?: boolean },
): Record<string, string> {
  const actor = session?.actor ?? FALLBACK_SESSION.actor;

  return {
    ...(options?.includeJsonContentType ? { "content-type": "application/json" } : {}),
    "x-workspace-id": actor.workspaceId,
    "x-user-id": actor.userId,
    "x-session-type": session?.sessionType ?? "guest",
    ...(actor.email ? { "x-user-email": actor.email } : {}),
    ...(actor.workspaceRole ? { "x-workspace-role": actor.workspaceRole } : {}),
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

export interface PasswordLoginInput {
  email: string;
  password: string;
}

export interface IndividualSignUpInput extends PasswordLoginInput {
  username: string;
  firstName: string;
  lastName: string;
}

export interface OrganisationSignUpInput extends IndividualSignUpInput {
  organizationName: string;
  linkToOpsui: boolean;
}

export interface BusinessSignUpInput extends IndividualSignUpInput {
  organizationCode: string;
}

export interface AuthMutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  redirectTo?: string;
}

export async function loginWithPassword(input: PasswordLoginInput): Promise<AuthMutationResult> {
  return postAuthMutation("/v1/login/password", input);
}

export async function signUpIndividual(input: IndividualSignUpInput): Promise<AuthMutationResult> {
  return postAuthMutation("/v1/signup/individual", input);
}

export async function signUpOrganisation(input: OrganisationSignUpInput): Promise<AuthMutationResult> {
  return postAuthMutation("/v1/signup/organisation", input);
}

export async function signUpWithBusiness(input: BusinessSignUpInput): Promise<AuthMutationResult> {
  return postAuthMutation("/v1/signup/business", input);
}

export async function completeOidcAccount(input: { username: string }): Promise<AuthMutationResult> {
  return postAuthMutation("/v1/oidc/complete-account", input);
}

export async function getOrganisationProfile(forceRefresh = false): Promise<OrganisationProfile | null> {
  if (forceRefresh) {
    sessionCache = null;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/organisation/me`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as OrganisationProfile;
  } catch {
    return null;
  }
}

export async function getMyProfile(forceRefresh = false): Promise<{ profileVisuals: ProfileVisuals } | null> {
  if (forceRefresh) {
    sessionCache = null;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/profile/me`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as { profileVisuals: ProfileVisuals };
  } catch {
    return null;
  }
}

export async function updateMyProfileVisuals(profileVisuals: ProfileVisuals): Promise<AuthMutationResult> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/profile/me`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ profileVisuals }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          message?: string;
        }
      | null;

    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: payload?.error ?? "request_failed",
        message: payload?.message ?? "That request could not be completed.",
      };
    }

    sessionCache = null;
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "request_failed",
      message: "That request could not be completed.",
    };
  }
}

export async function sendPresenceHeartbeat(): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/v1/presence/heartbeat`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });

    return response.ok;
  } catch {
    return false;
  }
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
  const firstName = session?.actor.firstName?.trim();
  if (firstName) {
    return firstName;
  }

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
  const localPart = email.split("@")[0] ?? "member";
  const firstName = localPart
    .replace(/[_.-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (value) => value.toUpperCase()) || "Member";
  const username = localPart.replace(/[^a-z0-9._]+/gi, "").slice(0, 24) || "member";

  return {
    authenticated: true,
    sessionType: "user",
    provider: "mock",
    actor: {
      workspaceId: "workspace_local",
      workspaceName: "My Workspace",
      workspaceKind: "personal",
      planTier: "standard",
      userId,
      email,
      username,
      firstName,
      lastName: "User",
      profileVisuals: DEFAULT_PROFILE_VISUALS,
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

async function postAuthMutation(pathname: string, body: unknown): Promise<AuthMutationResult> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}${pathname}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          message?: string;
          redirectTo?: string;
        }
      | null;

    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: payload?.error ?? "request_failed",
        message: payload?.message ?? "That request could not be completed.",
      };
    }

    sessionCache = null;
    capabilitiesCache = null;
    clearLocalDevSession();
    return {
      ok: true,
      redirectTo:
        payload && typeof payload.redirectTo === "string" && payload.redirectTo.startsWith("/")
          ? payload.redirectTo
          : undefined,
    };
  } catch {
    return {
      ok: false,
      error: "request_failed",
      message: "That request could not be completed.",
    };
  }
}

export { API_BASE_URL };
