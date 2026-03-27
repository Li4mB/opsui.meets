create table if not exists recordings (
  id uuid primary key,
  meeting_instance_id uuid not null references meeting_instances(id) on delete cascade,
  provider text not null,
  provider_recording_id text not null,
  status text not null,
  storage_path text null,
  download_url text null,
  duration_seconds integer null,
  started_at timestamptz null,
  stopped_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
