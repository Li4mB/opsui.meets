import * as Sentry from "@sentry/react";
import { API_BASE_URL, AUTH_BASE_URL, PUBLIC_APP_BASE_URL } from "./config";

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const EXTENSION_ERROR_PATTERNS = [
  /Cannot redefine property:\s*solana/i,
  /Cannot redefine property:\s*phantom/i,
  /wallet-standard/i,
  /lockdown-install/i,
  /SES Removing unpermitted intrinsics/i,
];
const EXTENSION_SCRIPT_PATTERNS = [
  /(^|\/)inpage\.[\w-]+\.js$/i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-web-extension:\/\//i,
];

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
    beforeSend(event, hint) {
      if (shouldIgnoreBrowserExtensionNoise(event, hint)) {
        return null;
      }

      return event;
    },
  });
}

function shouldIgnoreBrowserExtensionNoise(event: Sentry.Event, hint?: Sentry.EventHint): boolean {
  const messages = [
    event.message,
    ...collectExceptionValues(event),
    resolveHintMessage(hint),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  if (EXTENSION_ERROR_PATTERNS.some((pattern) => pattern.test(messages))) {
    return true;
  }

  return collectCandidateUrls(event).some((url) =>
    EXTENSION_SCRIPT_PATTERNS.some((pattern) => pattern.test(url)),
  );
}

function collectExceptionValues(event: Sentry.Event): string[] {
  return (event.exception?.values ?? [])
    .map((value) => value.value)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function resolveHintMessage(hint?: Sentry.EventHint): string | undefined {
  const originalException = hint?.originalException;
  if (originalException instanceof Error) {
    return originalException.message;
  }

  return typeof originalException === "string" ? originalException : undefined;
}

function collectCandidateUrls(event: Sentry.Event): string[] {
  const urls = new Set<string>();

  for (const value of event.exception?.values ?? []) {
    for (const frame of value.stacktrace?.frames ?? []) {
      if (typeof frame.filename === "string" && frame.filename.trim().length > 0) {
        urls.add(frame.filename);
      }
    }
  }

  if (typeof event.request?.url === "string" && event.request.url.trim().length > 0) {
    urls.add(event.request.url);
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    const url = breadcrumb.data?.url;
    if (typeof url === "string" && url.trim().length > 0) {
      urls.add(url);
    }
  }

  return [...urls];
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
