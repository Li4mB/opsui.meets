import { getRepositoryContext, type DataMode, type RequestRepositoryContext } from "@opsui/db";
import type { Env } from "../types";

export function getRepositories(env: Env): Promise<RequestRepositoryContext> {
  const mode = env.APP_DATA_MODE === "postgres" ? "postgres" : "memory";
  return getRepositoryContext(mode as DataMode, {
    connectionString: env.DATABASE_URL?.trim() || undefined,
  });
}
