import type { Env } from "../types";

interface AuthMetricInput {
  route: string;
  status: number;
  request?: Request;
  outcome?: string;
  sessionType?: string;
}

export function recordAuthMetric(env: Env, input: AuthMetricInput): void {
  env.ANALYTICS?.writeDataPoint({
    blobs: [
      "auth-worker",
      input.route,
      input.request?.method ?? "UNKNOWN",
      input.outcome ?? "ok",
      input.sessionType ?? "unknown",
      getClientAddress(input.request),
    ],
    doubles: [input.status, Date.now()],
    indexes: [input.route],
  });
}

function getClientAddress(request?: Request): string {
  if (!request) {
    return "unknown";
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown"
  );
}
