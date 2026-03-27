create table if not exists rooms (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  template_id uuid null references templates(id) on delete set null,
  name text not null,
  slug text not null unique,
  room_type text not null,
  is_persistent boolean not null default false,
  default_join_policy jsonb not null default '{}'::jsonb,
  default_roles_json jsonb not null default '{}'::jsonb,
  settings_json jsonb not null default '{}'::jsonb,
  created_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
