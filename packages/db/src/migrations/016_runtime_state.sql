create table if not exists opsui_runtime_state (
  scope text primary key,
  version bigint not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
