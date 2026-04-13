alter table workspaces
  add column if not exists workspace_kind text not null default 'personal',
  add column if not exists organization_code text null unique,
  add column if not exists opsui_linked boolean not null default false,
  add column if not exists opsui_business_id text null;

alter table users
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';

create table if not exists user_password_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  hash_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
