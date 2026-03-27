export interface WorkerAppEnv {
  APP_ENV?: string;
  COOKIE_DOMAIN?: string;
}

export function getAppEnv(env: WorkerAppEnv): string {
  return env.APP_ENV ?? "development";
}

export function getCookieDomain(env: WorkerAppEnv): string {
  return env.COOKIE_DOMAIN ?? ".opsuimeets.com";
}
