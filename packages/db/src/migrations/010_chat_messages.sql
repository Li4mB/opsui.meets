create table if not exists chat_messages (
  id uuid primary key,
  meeting_instance_id uuid not null references meeting_instances(id) on delete cascade,
  sender_participant_id uuid not null references participants(id) on delete cascade,
  message_type text not null default 'text',
  body text not null,
  mentions_json jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  moderation_state text not null default 'visible',
  sent_at timestamptz not null default now(),
  deleted_at timestamptz null
);
