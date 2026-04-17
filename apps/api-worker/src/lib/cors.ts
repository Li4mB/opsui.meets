const ALLOWED_ORIGINS = new Set([
  "https://opsuimeets.com",
  "https://app.opsuimeets.com",
  "https://admin.opsuimeets.com",
  "https://docs.opsuimeets.com",
  "https://preview.opsuimeets.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const ALLOWED_HEADERS = [
  "baggage",
  "content-type",
  "idempotency-key",
  "sentry-trace",
  "x-session-type",
  "x-workspace-id",
  "x-user-id",
  "x-user-email",
  "x-workspace-role",
  "x-idempotency-key",
];

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "OPTIONS"];

export function getCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  appendVary(headers, "Origin");
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }

  headers.set("access-control-allow-methods", ALLOWED_METHODS.join(", "));
  headers.set("access-control-allow-headers", ALLOWED_HEADERS.join(", "));
  headers.set("access-control-max-age", "86400");
  return headers;
}

export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of getCorsHeaders(request).entries()) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleCorsPreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") {
    return null;
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", value);
    return;
  }

  const existingValues = existing
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (existingValues.includes(value.toLowerCase())) {
    return;
  }

  headers.set("vary", `${existing}, ${value}`);
}
