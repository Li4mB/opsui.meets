import * as Sentry from "@sentry/react";
import { API_BASE_URL, AUTH_BASE_URL, PUBLIC_APP_BASE_URL } from "./config";

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export function initializeSentry(): void {
  if (typeof window !== "undefined" && LOCAL_HOSTNAMES.has(window.location.hostname)) {
    return;
  }

  const dsn = resolveOptionalString(import.meta.env.VITE_SENTRY_DSN);
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    enabled: true,
    environment: resolveOptionalString(import.meta.env.VITE_SENTRY_ENVIRONMENT) ?? import.meta.env.MODE,
    release: resolveOptionalString(import.meta.env.VITE_SENTRY_RELEASE),
    sendDefaultPii: false,
    tracesSampleRate: resolveSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, DEFAULT_TRACES_SAMPLE_RATE),
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracePropagationTargets: [
      PUBLIC_APP_BASE_URL,
      API_BASE_URL,
      AUTH_BASE_URL,
      /^https:\/\/([a-z0-9-]+\.)?opsuimeets\.com$/i,
    ],
  });
}

function resolveOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveSampleRate(value: string | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}
