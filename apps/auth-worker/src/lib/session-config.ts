import { SESSION_COOKIE_NAME } from "./session-cookie";
import type { Env } from "../types";

export function getSessionSigningSecret(env: Env): string {
  return env.SESSION_SIGNING_SECRET?.trim() || env.MOCK_SESSION_SIGNING_SECRET || "opsui-meets-dev-signing-secret";
}

export function buildSessionCookie(value: string, env: Env): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Domain=${env.COOKIE_DOMAIN}`,
    "Path=/",
    "HttpOnly",
    ...(shouldUseSecureCookies(env) ? ["Secure"] : []),
    "SameSite=Lax",
    "Max-Age=86400",
  ].join("; ");
}

export function shouldUseSecureCookies(env: Env): boolean {
  const cookieDomain = env.COOKIE_DOMAIN.replace(/^\.+/, "").trim().toLowerCase();
  return cookieDomain !== "localhost" && cookieDomain !== "127.0.0.1";
}
