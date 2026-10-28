-- group agent (MCP) actions by the token/grant session that performed them,
-- so the Activity page can show one session card with its logs one after another
alter table audit_log add column session_id uuid;
create index audit_log_session_idx on audit_log (session_id, id desc);
