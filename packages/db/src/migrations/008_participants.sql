create table if not exists participants (
  id uuid primary key,
  meeting_instance_id uuid not null references meeting_instances(id) on delete cascade,
  user_id uuid null references users(id) on delete set null,
  guest_email text null,
  display_name text not null,
  role text not null,
  join_state text not null default 'invited',
  admitted_by uuid null references users(id) on delete set null,
  joined_at timestamptz null,
  left_at timestamptz null,
  device_meta_json jsonb not null default '{}'::jsonb,
  network_meta_json jsonb not null default '{}'::jsonb
);
