import type { AuthProvider, LiveRole, SessionActor } from "@opsui/shared-types";

export const SESSION_COOKIE_NAME = "opsui_meets_session";
const SESSION_SIGNATURE_VERSION = "v1";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionClaims {
  actor: SessionActor;
  sessionType: "user";
  provider: AuthProvider;
  iat: number;
  exp: number;
}

const OIDC_STATE_COOKIE_NAME = "opsui_meets_oidc_state";
const OIDC_PENDING_COOKIE_NAME = "opsui_meets_oidc_pending";

export interface PendingOidcAccountClaims {
  provider: "oidc";
  subject: string;
  email: string;
  firstName: string;
  lastName: string;
  workspaceId: string;
  workspaceRole: LiveRole;
  membershipSource:
    | "oidc_claim"
    | "oidc_domain"
    | "oidc_default"
    | "oidc_directory_email"
    | "oidc_directory_user";
  redirectTo: string | null;
  iat: number;
  exp: number;
}

export async function buildMockSessionToken(
  actor: SessionActor,
  signingSecret: string,
): Promise<{ token: string; expiresAt: string }> {
  return buildSessionToken(
    {
      actor,
      sessionType: "user",
      provider: "mock",
    },
    signingSecret,
  );
}

export async function buildOidcSessionToken(
  actor: SessionActor,
  signingSecret: string,
): Promise<{ token: string; expiresAt: string }> {
  return buildSessionToken(
    {
      actor,
      sessionType: "user",
      provider: "oidc",
    },
    signingSecret,
  );
}

export async function buildPasswordSessionToken(
  actor: SessionActor,
  signingSecret: string,
): Promise<{ token: string; expiresAt: string }> {
  return buildSessionToken(
    {
      actor,
      sessionType: "user",
      provider: "password",
    },
    signingSecret,
  );
}

export async function buildOidcStateValue(
  redirectTo: string | null,
  signingSecret: string,
): Promise<{ value: string; expiresAt: string }> {
  const claims = {
    state: crypto.randomUUID(),
    redirectTo,
    iat: Date.now(),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = await signValue(`${SESSION_SIGNATURE_VERSION}.${payload}`, signingSecret);

  return {
    value: `${SESSION_SIGNATURE_VERSION}.${payload}.${signature}`,
    expiresAt: new Date(claims.exp).toISOString(),
  };
}

export async function verifyOidcStateValue(
  cookieValue: string | null,
  signingSecret: string | undefined,
): Promise<{ state: string; redirectTo: string | null } | null> {
  const claims = await verifyClaims<{ state: string; redirectTo: string | null; exp: number }>(
    cookieValue,
    signingSecret,
  );
  if (!claims) {
    return null;
  }

  return {
    state: claims.state,
    redirectTo: claims.redirectTo ?? null,
  };
}

export function getOidcStateCookieName(): string {
  return OIDC_STATE_COOKIE_NAME;
}

export async function buildPendingOidcAccountValue(
  input: Omit<PendingOidcAccountClaims, "provider" | "iat" | "exp">,
  signingSecret: string,
): Promise<{ value: string; expiresAt: string }> {
  const claims: PendingOidcAccountClaims = {
    provider: "oidc",
    ...input,
    iat: Date.now(),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = await signValue(`${SESSION_SIGNATURE_VERSION}.${payload}`, signingSecret);

  return {
    value: `${SESSION_SIGNATURE_VERSION}.${payload}.${signature}`,
    expiresAt: new Date(claims.exp).toISOString(),
  };
}

export async function verifyPendingOidcAccountValue(
  cookieValue: string | null,
  signingSecret: string | undefined,
): Promise<PendingOidcAccountClaims | null> {
  return verifyClaims<PendingOidcAccountClaims>(cookieValue, signingSecret);
}

export function getOidcPendingCookieName(): string {
  return OIDC_PENDING_COOKIE_NAME;
}

async function buildSessionToken(
  input: {
    actor: SessionActor;
    sessionType: "user";
    provider: AuthProvider;
  },
  signingSecret: string,
): Promise<{ token: string; expiresAt: string }> {
  const claims: SessionClaims = {
    actor: input.actor,
    sessionType: input.sessionType,
    provider: input.provider,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = await signValue(`${SESSION_SIGNATURE_VERSION}.${payload}`, signingSecret);

  return {
    token: `${SESSION_SIGNATURE_VERSION}.${payload}.${signature}`,
    expiresAt: new Date(claims.exp).toISOString(),
  };
}

export async function verifySessionToken(
  cookieValue: string | null,
  signingSecret: string | undefined,
): Promise<SessionActor | null> {
  const claims = await verifySessionClaims(cookieValue, signingSecret);
  return claims?.actor ?? null;
}

export async function verifySessionClaims(
  cookieValue: string | null,
  signingSecret: string | undefined,
): Promise<SessionClaims | null> {
  return verifyClaims<SessionClaims>(cookieValue, signingSecret);
}

async function verifyClaims<T extends { exp: number }>(
  cookieValue: string | null,
  signingSecret: string | undefined,
): Promise<T | null> {
  if (!cookieValue || !signingSecret) {
    return null;
  }

  const [version, payload, signature] = cookieValue.split(".");
  if (!version || !payload || !signature || version !== SESSION_SIGNATURE_VERSION) {
    return null;
  }

  const valid = await verifyValue(`${version}.${payload}`, signature, signingSecret);
  if (!valid) {
    return null;
  }

  try {
    const claims = JSON.parse(fromBase64Url(payload)) as T;
    if (claims.exp <= Date.now()) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string, name: string): string | null {
  const cookies = cookieHeader.split(";").map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return toBase64Url(signature);
}

async function verifyValue(value: string, signature: string, secret: string): Promise<boolean> {
  const key = await importSigningKey(secret);

  return crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64UrlToArrayBuffer(signature),
    new TextEncoder().encode(value),
  );
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(value: string | ArrayBuffer): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  return new TextDecoder().decode(new Uint8Array(fromBase64UrlToArrayBuffer(value)));
}

function fromBase64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
