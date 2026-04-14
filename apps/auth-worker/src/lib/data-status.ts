import type { Env } from "../types";

export interface AuthDataStatus {
  dataMode: "memory" | "postgres";
  databaseConfigured: boolean;
  authStorageReady: boolean;
  reason: "memory_mode" | "postgres_ready" | "postgres_unconfigured";
}

export function getAuthDataStatus(env: Env): AuthDataStatus {
  const dataMode = env.APP_DATA_MODE === "postgres" ? "postgres" : "memory";
  const databaseConfigured = Boolean(env.DATABASE_URL?.trim());

  if (dataMode === "memory") {
    return {
      dataMode,
      databaseConfigured,
      authStorageReady: true,
      reason: "memory_mode",
    };
  }

  if (!databaseConfigured) {
    return {
      dataMode,
      databaseConfigured,
      authStorageReady: false,
      reason: "postgres_unconfigured",
    };
  }

  return {
    dataMode,
    databaseConfigured,
    authStorageReady: true,
    reason: "postgres_ready",
  };
}
