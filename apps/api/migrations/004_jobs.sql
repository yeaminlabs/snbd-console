-- at most one install running per server
create unique index jobs_one_active_per_server on jobs (server_id) where status in ('queued', 'running');
create index jobs_server_created_idx on jobs (server_id, created_at desc);
