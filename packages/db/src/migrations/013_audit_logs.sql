create table if not exists audit_logs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  meeting_instance_id uuid null references meeting_instances(id) on delete cascade,
  actor_user_id uuid null references users(id) on delete set null,
  actor_participant_id uuid null references participants(id) on delete set null,
  target_type text not null,
  target_id text null,
  action text not null,
  payload_json jsonb not null default '{}'::jsonb,
  ip_address inet null,
  user_agent text null,
  created_at timestamptz not null default now()
);
