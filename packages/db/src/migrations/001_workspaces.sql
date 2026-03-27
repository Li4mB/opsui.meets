create table if not exists workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  domain_allowlist jsonb not null default '[]'::jsonb,
  plan_tier text not null default 'standard',
  default_room_policy_json jsonb not null default '{}'::jsonb,
  recording_policy_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
