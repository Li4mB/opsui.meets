create table if not exists hook_delivery_attempts (
  id uuid primary key,
  workspace_id text not null,
  meeting_instance_id text,
  actor text not null,
  trigger text not null,
  event_type text not null,
  delivery_mode text not null,
  target_url text not null,
  ok boolean not null,
  status_code integer,
  occurred_at timestamptz not null default now()
);

create index if not exists hook_delivery_attempts_workspace_occurred_idx
  on hook_delivery_attempts (workspace_id, occurred_at desc);
