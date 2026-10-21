-- key rotation: the replacement key is accepted alongside the old one until the agent first uses it
alter table agent_keys
  add column next_key_hash text,
  add column key_set_at timestamptz not null default now();

-- offline alerting
alter table servers
  add column offline_since timestamptz,
  add column offline_alerted_at timestamptz;

create index audit_log_at_idx on audit_log (at);
create index heartbeats_at_idx on heartbeats (at);
