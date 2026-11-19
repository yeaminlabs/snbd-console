create table if not exists wordpress_sites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  domain text not null,
  path text not null,
  site_name text,
  admin_user text,
  admin_email text,
  db_name text,
  db_user text,
  admin_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(server_id, domain)
);

create index if not exists idx_wordpress_sites_server_id on wordpress_sites(server_id);
