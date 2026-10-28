-- capture request context for audit entries
alter table audit_log add column ip_address text;
alter table audit_log add column user_agent text;
alter table audit_log add column location text;
