create table if not exists direct_message_threads (
  id uuid primary key,
  thread_kind text not null default 'direct',
  participant_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz null,
  last_message_preview text null
);

create table if not exists direct_message_thread_members (
  thread_id uuid not null references direct_message_threads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_message_id uuid null,
  last_read_at timestamptz null,
  primary key (thread_id, user_id)
);

create table if not exists direct_message_messages (
  id uuid primary key,
  thread_id uuid not null references direct_message_threads(id) on delete cascade,
  sender_user_id uuid not null references users(id) on delete cascade,
  body text not null,
  sent_at timestamptz not null default now()
);

create index if not exists direct_message_threads_last_message_at_idx
  on direct_message_threads (last_message_at desc nulls last, updated_at desc);

create index if not exists direct_message_thread_members_user_id_idx
  on direct_message_thread_members (user_id);

create index if not exists direct_message_messages_thread_id_sent_at_idx
  on direct_message_messages (thread_id, sent_at);
