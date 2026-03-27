create table if not exists attendance (
  id uuid primary key,
  meeting_instance_id uuid not null references meeting_instances(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  first_joined_at timestamptz null,
  last_left_at timestamptz null,
  total_seconds integer not null default 0,
  focus_seconds integer not null default 0,
  device_failures_count integer not null default 0,
  attendance_status text not null default 'partial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_instance_id, participant_id)
);
