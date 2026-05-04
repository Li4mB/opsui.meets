create table if not exists meeting_recording_blobs (
  recording_id text primary key,
  owner_user_id text not null,
  content_type text not null,
  size_bytes bigint not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now()
);

create index if not exists meeting_recording_blobs_owner_user_id_idx
  on meeting_recording_blobs (owner_user_id, uploaded_at desc);
