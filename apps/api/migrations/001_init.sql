create extension if not exists pgcrypto;

create table clients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  whmcs_client_id integer unique,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  client_id uuid not null references clients(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table servers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('bdix', 'hetzner', 'imported')),
  provider_ref text,
  status text not null default 'provisioning' check (status in ('provisioning', 'running', 'agent_offline', 'stopped')),
  ip inet,
  region text,
  plan jsonb not null default '{}',
  os text,
  whmcs_service_id integer unique,
  created_at timestamptz not null default now()
);
create index servers_client_idx on servers(client_id);

create table enroll_tokens (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table agent_keys (
  server_id uuid primary key references servers(id) on delete cascade,
  key_hash text not null,
  agent_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table heartbeats (
  server_id uuid not null references servers(id) on delete cascade,
  at timestamptz not null default now(),
  cpu real not null,
  mem_used bigint not null,
  mem_total bigint not null,
  disk_used bigint not null,
  disk_total bigint not null,
  uptime bigint not null
);
create index heartbeats_server_at_idx on heartbeats(server_id, at desc);

create table audit_log (
  id bigserial primary key,
  client_id uuid references clients(id) on delete set null,
  server_id uuid references servers(id) on delete set null,
  action text not null,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_server_idx on audit_log(server_id, at desc);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  log text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
