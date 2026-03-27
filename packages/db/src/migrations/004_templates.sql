create table if not exists templates (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  template_type text not null,
  description text null,
  default_roles_json jsonb not null default '{}'::jsonb,
  default_policy_json jsonb not null default '{}'::jsonb,
  default_layout_json jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
