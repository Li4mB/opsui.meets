import { json } from "./http";

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const storeKey = "__opsui_meets_auth_rate_limits__";

export function getRateLimitResponse(
  request: Request,
  options: RateLimitOptions,
): Response | null {
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
    return null;
  }

  if (existing.count >= options.limit) {
    return json(
      {
        error: "rate_limit_exceeded",
        message: "Too many requests.",
      },
      { status: 429 },
    );
  }

  existing.count += 1;
  return null;
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

  return "unknown";
}
