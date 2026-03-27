import { ApiError } from "./http";
import type { Env } from "../types";

export interface DataStatus {
  dataMode: "memory" | "postgres";
  databaseConfigured: boolean;
  persistenceReady: boolean;
  reason: "memory_mode" | "postgres_unconfigured" | "postgres_adapter_pending";
}

export function getDataStatus(env: Env): DataStatus {
  const dataMode = env.APP_DATA_MODE === "postgres" ? "postgres" : "memory";
  const databaseConfigured = Boolean(env.DATABASE_URL);

  if (dataMode === "memory") {
    return {
      dataMode,
      databaseConfigured,
      persistenceReady: false,
      reason: "memory_mode",
    };
  }

  if (!databaseConfigured) {
    return {
      dataMode,
      databaseConfigured,
      persistenceReady: false,
      reason: "postgres_unconfigured",
    };
  }

  return {
    dataMode,
    databaseConfigured,
    persistenceReady: true,
    reason: "postgres_adapter_pending",
  };
}

export function getPersistenceAvailabilityError(env: Env): ApiError | null {
  const dataStatus = getDataStatus(env);

  if (dataStatus.dataMode !== "postgres") {
    return null;
  }

  if (dataStatus.reason === "postgres_unconfigured") {
    return new ApiError(
      503,
      "postgres_not_configured",
      "Postgres mode is enabled but database connectivity is not configured.",
    );
  }

  return null;
}

export function assertPersistenceAvailable(env: Env): void {
  const error = getPersistenceAvailabilityError(env);
  if (error) {
    throw error;
  }
}
