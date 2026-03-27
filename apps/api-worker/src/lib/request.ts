import { ApiError } from "./http";

export async function parseJson<T>(request: Request): Promise<Partial<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new ApiError(400, "invalid_content_type", "Expected application/json body.");
  }

  return (await request.json().catch(() => ({}))) as Partial<T>;
}

export function requireNonEmptyString(
  value: unknown,
  code: string,
  fallback?: string,
): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new ApiError(400, code);
}

export function optionalBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  code: string,
): T {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }

  throw new ApiError(400, code);
}

export function optionalIsoDate(value: unknown, fallback: string, code: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, code);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new ApiError(400, code);
  }

  return new Date(timestamp).toISOString();
}
