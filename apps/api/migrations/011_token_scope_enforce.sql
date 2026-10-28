-- MCP tool dispatch starts enforcing api_tokens.scope; grandfather existing tokens as
-- 'deploy' so no live AI connection silently loses run_command/write_file/restart_service.
update api_tokens set scope = 'deploy' where scope = 'read';
