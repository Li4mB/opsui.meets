import { createSqlClient, type SqlClient } from "@opsui/db";
import type { Env } from "../types";

interface StoredDirectMessageAttachmentBlob {
  attachmentId: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  uploadedAt: string;
}

interface PutDirectMessageAttachmentBlobInput {
  attachmentId: string;
  threadId: string;
  uploaderUserId: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

interface PersistedDirectMessageAttachmentBlobRow {
  attachment_id: string;
  content_type: string;
  size_bytes: number | string;
  content_base64: string;
  uploaded_at: string | Date;
}

const memoryAttachmentBlobs = new Map<string, StoredDirectMessageAttachmentBlob>();
let ensureDatabaseTablePromise: Promise<void> | null = null;

export async function putDirectMessageAttachmentBlob(
  env: Env,
  input: PutDirectMessageAttachmentBlobInput,
): Promise<void> {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    memoryAttachmentBlobs.set(input.attachmentId, {
      attachmentId: input.attachmentId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      bytes: input.bytes,
      uploadedAt: new Date().toISOString(),
    });
    return;
  }

  const sql = createSqlClient(connectionString);
  try {
    await ensureDatabaseTable(sql);
    const contentBase64 = encodeBytesToBase64(input.bytes);
    await sql`
      insert into direct_message_attachment_blobs (
        attachment_id,
        thread_id,
        uploader_user_id,
        content_type,
        size_bytes,
        content,
        uploaded_at
      )
      values (
        ${input.attachmentId},
        ${input.threadId},
        ${input.uploaderUserId},
        ${input.contentType},
        ${input.sizeBytes},
        decode(${contentBase64}, 'base64'),
        now()
      )
      on conflict (attachment_id) do update
        set thread_id = excluded.thread_id,
            uploader_user_id = excluded.uploader_user_id,
            content_type = excluded.content_type,
            size_bytes = excluded.size_bytes,
            content = excluded.content,
            uploaded_at = now()
    `;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function getDirectMessageAttachmentBlob(
  env: Env,
  attachmentId: string,
): Promise<StoredDirectMessageAttachmentBlob | null> {
  const memoryBlob = memoryAttachmentBlobs.get(attachmentId) ?? null;
  if (memoryBlob) {
    return memoryBlob;
  }

  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    return null;
  }

  const sql = createSqlClient(connectionString);
  try {
    await ensureDatabaseTable(sql);
    const rows = await sql<PersistedDirectMessageAttachmentBlobRow[]>`
      select
        attachment_id,
        content_type,
        size_bytes,
        encode(content, 'base64') as content_base64,
        uploaded_at
      from direct_message_attachment_blobs
      where attachment_id = ${attachmentId}
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      attachmentId: row.attachment_id,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      bytes: decodeBase64ToBytes(row.content_base64),
      uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function ensureDatabaseTable(sql: SqlClient): Promise<void> {
  if (!ensureDatabaseTablePromise) {
    ensureDatabaseTablePromise = (async () => {
      await sql`
        create table if not exists direct_message_attachment_blobs (
          attachment_id text primary key,
          thread_id text not null,
          uploader_user_id text not null,
          content_type text not null,
          size_bytes bigint not null,
          content bytea not null,
          created_at timestamptz not null default now(),
          uploaded_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists direct_message_attachment_blobs_thread_id_idx
          on direct_message_attachment_blobs (thread_id, uploaded_at desc)
      `;
      await sql`
        create index if not exists direct_message_attachment_blobs_uploader_user_id_idx
          on direct_message_attachment_blobs (uploader_user_id, uploaded_at desc)
      `;
    })().catch((error) => {
      ensureDatabaseTablePromise = null;
      throw error;
    });
  }

  await ensureDatabaseTablePromise;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
