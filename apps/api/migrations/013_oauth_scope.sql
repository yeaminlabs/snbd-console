-- OAuth connectors can be read-only or full access (chosen by the customer on the approval page).
alter table oauth_grants
  add column if not exists scope text not null default 'read' check (scope in ('read', 'deploy'));
