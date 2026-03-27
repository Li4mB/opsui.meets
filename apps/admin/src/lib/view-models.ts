import type { AdminDashboardPayload } from "./api";

export function normalizeAdminMetrics(payload: AdminDashboardPayload) {
  return payload.metrics;
}
