create table if not exists action_items (
  id text primary key,
  meeting_instance_id uuid not null references meeting_instances(id) on delete cascade,
  source_type text not null,
  title text not null,
  owner_label text,
  due_at timestamptz,
  status text not null,
  created_at timestamptz not null default now()
);
