import { ApiError } from "./http";

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const storeKey = "__opsui_meets_api_rate_limits__";

export function enforceRateLimit(request: Request, options: RateLimitOptions): void {
  const store = getRateLimitStore();
  const now = Date.now();
  const identity = getRequesterIdentity(request);
  const key = `${options.bucket}:${identity}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return;
  }

  if (existing.count >= options.limit) {
    throw new ApiError(429, "rate_limit_exceeded", "Too many requests.");
  }

  existing.count += 1;
}

function getRateLimitStore(): Map<string, RateLimitEntry> {
  const globalScope = globalThis as typeof globalThis & {
    [storeKey]?: Map<string, RateLimitEntry>;
  };

  if (!globalScope[storeKey]) {
    globalScope[storeKey] = new Map();
  }

  return globalScope[storeKey];
}

function getRequesterIdentity(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const actor = request.headers.get("x-user-id");
  if (actor) {
    return actor;
  }

  return "unknown";
}
