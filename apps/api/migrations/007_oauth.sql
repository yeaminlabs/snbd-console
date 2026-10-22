-- OAuth 2.1 for MCP connectors (Claude, Claude Code, ...). Public clients with PKCE; every secret is stored only as a SHA-256.
create table oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- an authorization the customer has been sent to approve (valid 10 minutes)
create table oauth_requests (
  id text primary key,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  state text,
  expires_at timestamptz not null
);

-- what the customer approved: one row per connected app. Shown in "AI agents"; revoking it kills every token below.
create table oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_client_id uuid not null references clients(id) on delete cascade,
  oauth_client_id text not null references oauth_clients(client_id) on delete cascade,
  name text not null,
  server_ids uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index oauth_grants_user_idx on oauth_grants (user_client_id);

create table oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index oauth_tokens_grant_idx on oauth_tokens (grant_id);
