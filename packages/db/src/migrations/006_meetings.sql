create table if not exists meetings (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  title text not null,
  meeting_kind text not null,
  schedule_type text not null,
  starts_at timestamptz null,
  ends_at timestamptz null,
  recurrence_rule text null,
  timezone text null,
  status text not null default 'scheduled',
  created_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
