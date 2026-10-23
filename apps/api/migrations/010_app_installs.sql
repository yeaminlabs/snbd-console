create table app_installs (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references servers(id) on delete cascade,
  app_id      text not null,
  version     text not null default 'latest',
  install_dir text not null default '',
  status      text not null default 'installed' check (status in ('installing', 'installed', 'failed')),
  installed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- one active install record per app per server
create unique index app_installs_server_app on app_installs(server_id, app_id);
