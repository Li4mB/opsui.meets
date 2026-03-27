interface StoredResult<T> {
  body: T;
  status: number;
}

const globalKey = "__opsui_meets_idempotency_store__";

function getStore(): Map<string, StoredResult<unknown>> {
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, StoredResult<unknown>>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map();
  }

  return globalScope[globalKey];
}

export async function withIdempotency<T>(
  request: Request,
  scope: string,
  producer: () => Promise<StoredResult<T>>,
): Promise<StoredResult<T>> {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return producer();
  }

  const actorScope = `${request.headers.get("x-workspace-id") ?? "workspace_local"}:${request.headers.get("x-user-id") ?? "user_local"}`;
  const cacheKey = `${scope}:${actorScope}:${idempotencyKey}`;
  const store = getStore();
  const cached = store.get(cacheKey) as StoredResult<T> | undefined;
  if (cached) {
    return cached;
  }

  const created = await producer();
  store.set(cacheKey, created);
  return created;
}
