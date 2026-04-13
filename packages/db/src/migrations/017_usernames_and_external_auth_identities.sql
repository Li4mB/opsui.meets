alter table workspaces
  add column if not exists organization_name_normalized text null;

create unique index if not exists workspaces_organization_name_normalized_unique
  on workspaces (organization_name_normalized)
  where workspace_kind = 'organisation' and organization_name_normalized is not null;

alter table users
  add column if not exists username text,
  add column if not exists username_normalized text;

create table if not exists external_auth_identities (
  id uuid primary key,
  provider text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists external_auth_identities_provider_subject_unique
  on external_auth_identities (provider, subject);

delete from external_auth_identities;
delete from user_password_credentials;
delete from workspace_memberships;
delete from users;

delete from workspace_policies
where workspace_id in (
  select id
  from workspaces
  where workspace_kind in ('personal', 'organisation')
    and id <> 'workspace_local'
);

delete from workspaces
where workspace_kind in ('personal', 'organisation')
  and id <> 'workspace_local';

alter table users
  alter column username set not null,
  alter column username_normalized set not null;

create unique index if not exists users_username_normalized_unique
  on users (username_normalized);
