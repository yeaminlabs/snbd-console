-- What the panel knows about the machine behind an MCP connection. Refreshed when the connection is used,
-- so the MCP page can say "Claude Code on macOS, from 1.2.3.4, 2 minutes ago" instead of listing raw keys.
alter table api_tokens
  add column last_ip inet,
  add column last_user_agent text;

alter table oauth_grants
  add column last_ip inet,
  add column last_user_agent text;
