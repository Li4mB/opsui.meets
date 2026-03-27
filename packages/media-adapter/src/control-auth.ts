const SIGNATURE_VERSION = "v1";
const TIMESTAMP_HEADER = "x-opsui-media-timestamp";
const SIGNATURE_HEADER = "x-opsui-media-signature";
const SIGNATURE_VERSION_HEADER = "x-opsui-media-signature-version";
const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export interface MediaControlVerificationResult {
  ok: boolean;
  error?: "media_control_auth_not_configured" | "media_control_signature_missing" | "media_control_signature_invalid";
}

export async function createMediaControlHeaders(
  body: string,
  secret: string | undefined,
): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };

  if (!secret) {
    return headers;
  }

  const timestamp = String(Date.now());
  headers[TIMESTAMP_HEADER] = timestamp;
  headers[SIGNATURE_VERSION_HEADER] = SIGNATURE_VERSION;
  headers[SIGNATURE_HEADER] = await signMediaControlPayload(body, timestamp, secret);
  return headers;
}

export async function verifyMediaControlRequest(
  request: Request,
  body: string,
  secret: string | undefined,
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
): Promise<MediaControlVerificationResult> {
  if (!secret) {
    return {
      ok: false,
      error: "media_control_auth_not_configured",
    };
  }

  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const version = request.headers.get(SIGNATURE_VERSION_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !version || !signature || version !== SIGNATURE_VERSION) {
    return {
      ok: false,
      error: "media_control_signature_missing",
    };
  }

  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp) > maxSkewMs) {
    return {
      ok: false,
      error: "media_control_signature_invalid",
    };
  }

  const expectedSignature = await signMediaControlPayload(body, timestamp, secret);
  if (signature !== expectedSignature) {
    return {
      ok: false,
      error: "media_control_signature_invalid",
    };
  }

  return { ok: true };
}

async function signMediaControlPayload(body: string, timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${SIGNATURE_VERSION}.${timestamp}.${body}`),
  );

  return toBase64Url(signature);
}

function toBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
