import { getRepositoryContext, type DataMode, type RequestRepositoryContext } from "@opsui/db";
import { assertPersistenceAvailable } from "./data-status";
import type { Env } from "../types";

export function getDataConnectionString(env: Env): string | undefined {
  return env.DATABASE_URL?.trim() || undefined;
}

export function getRepositories(env: Env): Promise<RequestRepositoryContext> {
  const mode = env.APP_DATA_MODE === "postgres" ? "postgres" : "memory";
  assertPersistenceAvailable(env);
  return getRepositoryContext(mode as DataMode, {
    connectionString: getDataConnectionString(env),
  });
}
