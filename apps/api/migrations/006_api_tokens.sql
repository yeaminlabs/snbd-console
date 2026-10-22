-- API tokens for AI agents (MCP). Only the SHA-256 of a token is stored; the token itself is shown once.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scope text not null default 'read' check (scope in ('read', 'deploy')),
  server_ids uuid[],                      -- null = every server of this client
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_client_idx on api_tokens (client_id);

-- who did it: null = the signed-in person or the system, otherwise "<token name>"
alter table audit_log add column via text;

-- the address the panel sees the agent connect from (helps the AI agent tell the customer which A record to add)
alter table servers add column last_seen_ip inet;
