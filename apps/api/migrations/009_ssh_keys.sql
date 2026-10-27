-- Personal SSH keys. The panel never stores a generated private half; only the public line plus a
-- fingerprint are kept. ssh_key_servers records where a key has been installed (the agent appends
-- it to root's authorized_keys), so deletion can clean every machine before the rows go away.
create table ssh_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  key_type text not null,
  public_key text not null,
  fingerprint text not null,
  private_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (client_id, fingerprint)
);

create table ssh_key_servers (
  key_id uuid not null references ssh_keys(id) on delete cascade,
  server_id uuid not null references servers(id) on delete cascade,
  installed_at timestamptz not null default now(),
  primary key (key_id, server_id)
);

create index ssh_keys_client_idx on ssh_keys (client_id);
