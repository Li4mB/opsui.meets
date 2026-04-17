import type {
  DirectMessageMessage,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
} from "@opsui/shared-types";
import { getActorHeaders } from "./auth";
import { API_BASE_URL } from "./config";
import { createIdempotencyKey } from "./idempotency";

export interface DirectMessageAttachmentUploadSlot {
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
}

export async function listDirectMessageThreads(): Promise<DirectMessageThreadSummary[]> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads`, {
      cache: "no-store",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { items?: DirectMessageThreadSummary[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

export async function searchDirectMessageUsers(query: string): Promise<DirectMessageSearchResult[]> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(
      `${API_BASE_URL}/v1/direct-messages/search?query=${encodeURIComponent(query)}`,
      {
        cache: "no-store",
        credentials: "include",
        headers,
      },
    );

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { items?: DirectMessageSearchResult[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

export async function openDirectMessageThread(
  username: string,
): Promise<{ ok: true; thread: DirectMessageThreadDetail } | { ok: false; message: string }> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("dm-thread-open"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ username }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        message: payload?.message ?? "We could not open that conversation.",
      };
    }

    return {
      ok: true,
      thread: (await response.json()) as DirectMessageThreadDetail,
    };
  } catch {
    return {
      ok: false,
      message: "We could not open that conversation.",
    };
  }
}

export async function getDirectMessageThread(threadId: string): Promise<DirectMessageThreadDetail | null> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads/${threadId}`, {
      cache: "no-store",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as DirectMessageThreadDetail;
  } catch {
    return null;
  }
}

export async function listDirectMessageMessages(threadId: string): Promise<DirectMessageMessage[]> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads/${threadId}/messages`, {
      cache: "no-store",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { items?: DirectMessageMessage[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

export async function signDirectMessageAttachments(
  threadId: string,
  files: File[],
): Promise<
  { ok: true; items: DirectMessageAttachmentUploadSlot[] } |
  { ok: false; error: string }
> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("dm-attachments-sign"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads/${threadId}/attachments/sign`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        files: files.map((file) => ({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        })),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        error: payload?.message ?? "Your files could not be prepared for upload.",
      };
    }

    const payload = (await response.json()) as { items?: DirectMessageAttachmentUploadSlot[] };
    return {
      ok: true,
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  } catch {
    return {
      ok: false,
      error: "Your files could not be prepared for upload.",
    };
  }
}

export async function uploadDirectMessageAttachment(
  slot: DirectMessageAttachmentUploadSlot,
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const headers = new Headers(slot.uploadHeaders);
    if (!headers.has("content-type") && file.type) {
      headers.set("content-type", file.type);
    }

    const response = await fetch(slot.uploadUrl, {
      method: slot.uploadMethod,
      headers,
      body: file,
    });
    if (!response.ok) {
      return {
        ok: false,
        error: "One of your files could not be uploaded.",
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "One of your files could not be uploaded.",
    };
  }
}

export async function sendDirectMessage(
  threadId: string,
  text: string,
  attachmentIds: string[] = [],
): Promise<{ ok: true; message: DirectMessageMessage } | { ok: false; error: string }> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("dm-send"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads/${threadId}/messages`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ text, attachmentIds }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        error: payload?.message ?? "Your message could not be sent.",
      };
    }

    return {
      ok: true,
      message: (await response.json()) as DirectMessageMessage,
    };
  } catch {
    return {
      ok: false,
      error: "Your message could not be sent.",
    };
  }
}

export async function fetchDirectMessageAttachmentBlob(
  attachmentId: string,
  options?: { download?: boolean },
): Promise<Blob> {
  const headers = await getActorHeaders();
  const url = new URL(`${API_BASE_URL}/v1/direct-messages/attachments/${attachmentId}/content`);
  if (options?.download) {
    url.searchParams.set("download", "1");
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    throw new Error("attachment_fetch_failed");
  }

  return response.blob();
}

export async function markDirectMessageThreadRead(threadId: string): Promise<boolean> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("dm-read"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/direct-messages/threads/${threadId}/read`, {
      method: "POST",
      credentials: "include",
      headers,
    });

    return response.ok;
  } catch {
    return false;
  }
}
