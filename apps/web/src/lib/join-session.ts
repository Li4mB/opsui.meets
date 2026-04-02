const JOIN_SESSION_STORAGE_KEY = "opsui_meets_join_session_id";

let cachedJoinSessionId: string | null = null;

export function getJoinSessionId(): string {
  if (cachedJoinSessionId) {
    return cachedJoinSessionId;
  }

  if (typeof window === "undefined") {
    cachedJoinSessionId = "server_join_session";
    return cachedJoinSessionId;
  }

  try {
    const existing = window.sessionStorage.getItem(JOIN_SESSION_STORAGE_KEY)?.trim();
    if (existing) {
      cachedJoinSessionId = existing;
      return cachedJoinSessionId;
    }

    const nextValue = createJoinSessionId();
    window.sessionStorage.setItem(JOIN_SESSION_STORAGE_KEY, nextValue);
    cachedJoinSessionId = nextValue;
    return cachedJoinSessionId;
  } catch {
    cachedJoinSessionId = createJoinSessionId();
    return cachedJoinSessionId;
  }
}

function createJoinSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `join_${Math.random().toString(36).slice(2, 10)}`;
}
