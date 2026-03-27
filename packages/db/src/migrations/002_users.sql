create table if not exists users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  avatar_url text null,
  status text not null default 'active',
  timezone text null,
  last_active_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
