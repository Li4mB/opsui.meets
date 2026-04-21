create table if not exists direct_message_attachment_blobs (
  attachment_id text primary key,
  thread_id text not null,
  uploader_user_id text not null,
  content_type text not null,
  size_bytes bigint not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now()
);

create index if not exists direct_message_attachment_blobs_thread_id_idx
  on direct_message_attachment_blobs (thread_id, uploaded_at desc);

create index if not exists direct_message_attachment_blobs_uploader_user_id_idx
  on direct_message_attachment_blobs (uploader_user_id, uploaded_at desc);
