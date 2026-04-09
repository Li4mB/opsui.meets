export function json<T>(body: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export function notFound(): Response {
  return json({ error: "not_found" }, { status: 404 });
}

export function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed" }, { status: 405 });
}

export function badRequest(code: string, details?: unknown): Response {
  return json({ error: code, details }, { status: 400 });
}

export function internalError(): Response {
  return json({ error: "internal_error" }, { status: 500 });
}

export function fromApiError(error: ApiError): Response {
  return json({ error: error.code, message: error.message }, { status: error.status });
}
