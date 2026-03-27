import { recordApiMetric } from "../lib/analytics";
import { getDataStatus } from "../lib/data-status";
import { json } from "../lib/http";
import type { Env } from "../types";

export function getHealth(request: Request, env: Env): Response {
  const dataStatus = getDataStatus(env);
  const response = json({
    ok: true,
    service: "opsui-meets-api",
    env: env.APP_ENV,
    dataMode: dataStatus.dataMode,
    databaseConfigured: dataStatus.databaseConfigured,
    persistenceReady: dataStatus.persistenceReady,
    persistenceReason: dataStatus.persistenceReady ? "postgres_ready" : dataStatus.reason,
    analyticsConfigured: Boolean(env.ANALYTICS),
  }, {
    headers: {
      "access-control-allow-origin": "*",
    },
  });
  recordApiMetric(env, {
    route: "health",
    status: response.status,
    request,
    outcome: "health",
  });
  return response;
}
