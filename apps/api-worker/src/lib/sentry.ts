import type { Env } from "../types";

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export function getSentryOptions(env: Env) {
  if (!env.SENTRY_DSN) {
    return undefined;
  }

  return {
    dsn: env.SENTRY_DSN,
    enabled: true,
    environment: env.SENTRY_ENVIRONMENT ?? env.APP_ENV ?? "production",
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: resolveSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, DEFAULT_TRACES_SAMPLE_RATE),
  };
}

function resolveSampleRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}
