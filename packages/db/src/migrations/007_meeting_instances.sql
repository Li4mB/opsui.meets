create table if not exists meeting_instances (
  id uuid primary key,
  meeting_id uuid not null references meetings(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  instance_key text not null,
  starts_at timestamptz null,
  ended_at timestamptz null,
  status text not null default 'scheduled',
  host_user_id uuid null references users(id) on delete set null,
  live_policy_snapshot_json jsonb not null default '{}'::jsonb,
  media_session_id text null,
  room_do_id text null,
  created_at timestamptz not null default now(),
  unique (meeting_id, instance_key)
);
