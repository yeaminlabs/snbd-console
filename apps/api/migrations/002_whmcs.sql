alter table servers
  add column suspended_at timestamptz,
  add column terminated_at timestamptz;

-- webhook idempotency: one row per X-SNBD-Idempotency-Key, holds the response to replay
create table webhook_events (
  key text primary key,
  state text not null check (state in ('processing', 'done')),
  http_status int,
  response jsonb,
  created_at timestamptz not null default now()
);

-- one-time login links handed to WHMCS for single sign-on
create table sso_tokens (
  token_hash text primary key,
  client_id uuid not null references clients(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
