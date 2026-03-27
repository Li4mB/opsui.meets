import type { Env } from "../types";

interface ApiMetricInput {
  route: string;
  status: number;
  request?: Request;
  outcome?: string;
  workspaceId?: string;
}

export function recordApiMetric(env: Env, input: ApiMetricInput): void {
  env.ANALYTICS?.writeDataPoint({
    blobs: [
      "api-worker",
      input.route,
      input.request?.method ?? "UNKNOWN",
      input.outcome ?? "ok",
      input.workspaceId ?? "unknown",
      getClientAddress(input.request),
    ],
    doubles: [input.status, Date.now()],
    indexes: [input.route, String(input.status)],
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
