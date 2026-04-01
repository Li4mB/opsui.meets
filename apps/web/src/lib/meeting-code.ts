export function generateMeetingCode(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  return `ops-${raw}`.toLowerCase();
}

export function normalizeMeetingCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlCandidate = toUrlCandidate(trimmed);
  if (urlCandidate) {
    if (urlCandidate.pathname === "/join") {
      return sanitizeCode(urlCandidate.searchParams.get("room"));
    }

    const parts = urlCandidate.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      return sanitizeCode(parts[parts.length - 1]);
    }
  }

  return sanitizeCode(trimmed);
}

export function formatMeetingCodeLabel(code: string): string {
  return code.toUpperCase();
}

function toUrlCandidate(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      if (value.startsWith("/")) {
        return new URL(`https://opsuimeets.com${value}`);
      }

      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

function sanitizeCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}
