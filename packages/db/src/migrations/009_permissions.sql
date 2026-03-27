create table if not exists permissions (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_id uuid null references rooms(id) on delete cascade,
  meeting_instance_id uuid null references meeting_instances(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  permission_key text not null,
  effect text not null,
  source text not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);
