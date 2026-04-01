const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function isLocalHostname(): boolean {
  return typeof window !== "undefined" && LOCAL_HOSTNAMES.has(window.location.hostname);
}

export const API_BASE_URL = isLocalHostname()
  ? resolveRequiredUrl("VITE_API_BASE_URL", "http://127.0.0.1:8787")
  : resolveRequiredUrl("VITE_API_BASE_URL", "https://api.opsuimeets.com");

export const AUTH_BASE_URL = isLocalHostname()
  ? resolveRequiredUrl("VITE_AUTH_BASE_URL", "http://127.0.0.1:8788")
  : resolveRequiredUrl("VITE_AUTH_BASE_URL", "https://auth.opsuimeets.com");

export const REALTIME_BASE_URL = isLocalHostname()
  ? resolveOptionalUrl("VITE_REALTIME_BASE_URL", null)
  : resolveOptionalUrl("VITE_REALTIME_BASE_URL", "wss://ws.opsuimeets.com");

export const PUBLIC_APP_BASE_URL =
  typeof window !== "undefined" ? window.location.origin : "https://opsuimeets.com";

function resolveRequiredUrl(
  envKey: "VITE_API_BASE_URL" | "VITE_AUTH_BASE_URL",
  fallback: string,
): string {
  const raw = import.meta.env[envKey];
  if (typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  return trimmed || fallback;
}

function resolveOptionalUrl(
  envKey: "VITE_REALTIME_BASE_URL",
  fallback: string | null,
): string | null {
  const raw = import.meta.env[envKey];
  if (typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  return trimmed || null;
}
