const HASH_VERSION = "pbkdf2_sha256_v1";
// Cloudflare Workers currently caps PBKDF2 iterations at 100000.
const PBKDF2_ITERATIONS = 100_000;
const DERIVED_BITS = 256;

export async function hashPassword(password: string, pepper: string): Promise<{
  hash: string;
  hashVersion: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKeyBits(password, pepper, salt, PBKDF2_ITERATIONS);

  return {
    hash: [
      HASH_VERSION,
      String(PBKDF2_ITERATIONS),
      toBase64Url(salt),
      toBase64Url(derived),
    ].join("$"),
    hashVersion: HASH_VERSION,
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  pepper: string,
): Promise<boolean> {
  const [hashVersion, iterationsRaw, saltValue, expectedValue] = storedHash.split("$");
  if (hashVersion !== HASH_VERSION || !iterationsRaw || !saltValue || !expectedValue) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const salt = fromBase64Url(saltValue);
  const expected = fromBase64Url(expectedValue);
  const actual = await deriveKeyBits(password, pepper, salt, iterations);
  return constantTimeEqual(actual, expected);
}

export function getPasswordHashVersion(): string {
  return HASH_VERSION;
}

async function deriveKeyBits(
  password: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${password}${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: salt as unknown as BufferSource,
    },
    baseKey,
    DERIVED_BITS,
  );

  return new Uint8Array(derivedBits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
