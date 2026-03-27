const encoder = new TextEncoder();

export async function buildHookSignatureHeaders(secret: string, body: string): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  const payload = `${timestamp}.${body}`;
  const signature = await signPayload(secret, payload);

  return {
    "x-opsui-signature-version": "v1",
    "x-opsui-timestamp": timestamp,
    "x-opsui-signature": `sha256=${signature}`,
  };
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
