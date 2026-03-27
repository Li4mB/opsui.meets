export function createIdempotencyKey(scope: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${scope}-${crypto.randomUUID()}`;
  }

  return `${scope}-${Date.now()}`;
}
