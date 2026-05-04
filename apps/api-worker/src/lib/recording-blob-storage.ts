import { createSqlClient, type SqlClient } from "@opsui/db";
import type { Env } from "../types";

interface StoredRecordingBlob {
  bytes: Uint8Array;
  contentType: string;
  recordingId: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface PutRecordingBlobInput {
  bytes: Uint8Array;
  contentType: string;
  ownerUserId: string;
  recordingId: string;
  sizeBytes: number;
}

interface PersistedRecordingBlobRow {
  content_base64: string;
  content_type: string;
  recording_id: string;
  size_bytes: number | string;
  uploaded_at: string | Date;
}

const memoryRecordingBlobs = new Map<string, StoredRecordingBlob>();
let ensureDatabaseTablePromise: Promise<void> | null = null;

export async function putRecordingBlob(env: Env, input: PutRecordingBlobInput): Promise<void> {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    memoryRecordingBlobs.set(input.recordingId, {
      bytes: input.bytes,
      contentType: input.contentType,
      recordingId: input.recordingId,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
    });
    return;
  }

  const sql = createSqlClient(connectionString);
  try {
    await ensureDatabaseTable(sql);
    const contentBase64 = encodeBytesToBase64(input.bytes);
    await sql`
      insert into meeting_recording_blobs (
        recording_id,
        owner_user_id,
        content_type,
        size_bytes,
        content,
        uploaded_at
      )
      values (
        ${input.recordingId},
        ${input.ownerUserId},
        ${input.contentType},
        ${input.sizeBytes},
        decode(${contentBase64}, 'base64'),
        now()
      )
      on conflict (recording_id) do update
        set owner_user_id = excluded.owner_user_id,
            content_type = excluded.content_type,
            size_bytes = excluded.size_bytes,
            content = excluded.content,
            uploaded_at = now()
    `;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function getRecordingBlob(env: Env, recordingId: string): Promise<StoredRecordingBlob | null> {
  const memoryBlob = memoryRecordingBlobs.get(recordingId) ?? null;
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
    const rows = await sql<PersistedRecordingBlobRow[]>`
      select
        recording_id,
        content_type,
        size_bytes,
        encode(content, 'base64') as content_base64,
        uploaded_at
      from meeting_recording_blobs
      where recording_id = ${recordingId}
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      bytes: decodeBase64ToBytes(row.content_base64),
      contentType: row.content_type,
      recordingId: row.recording_id,
      sizeBytes: Number(row.size_bytes),
      uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function deleteRecordingBlob(env: Env, recordingId: string): Promise<void> {
  memoryRecordingBlobs.delete(recordingId);

  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    return;
  }

  const sql = createSqlClient(connectionString);
  try {
    await ensureDatabaseTable(sql);
    await sql`
      delete from meeting_recording_blobs
      where recording_id = ${recordingId}
    `;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function deleteRecordingBlobs(env: Env, recordingIds: string[]): Promise<void> {
  await Promise.all(recordingIds.map((recordingId) => deleteRecordingBlob(env, recordingId)));
}

async function ensureDatabaseTable(sql: SqlClient): Promise<void> {
  if (!ensureDatabaseTablePromise) {
    ensureDatabaseTablePromise = (async () => {
      await sql`
        create table if not exists meeting_recording_blobs (
          recording_id text primary key,
          owner_user_id text not null,
          content_type text not null,
          size_bytes bigint not null,
          content bytea not null,
          created_at timestamptz not null default now(),
          uploaded_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists meeting_recording_blobs_owner_user_id_idx
          on meeting_recording_blobs (owner_user_id, uploaded_at desc)
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
