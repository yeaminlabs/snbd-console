# MCP server

Customers can connect an AI assistant (Claude, Claude Code, Cursor, OpenCode and others) to their own servers through the panel.
The assistant talks to `https://<panel>/mcp` using the Model Context Protocol, with a personal **API token** or an **OAuth** sign-in.

**Every connection has full access** to the servers the customer approves: it can inspect status, logs and files, and it can run
commands, write files and restart services. The approval page says this before the customer allows a connection. Every
server-level call is recorded in **Activity** under the connection's name.

## For customers: connect Claude
1. Panel → **MCP server** → **Advanced: tokens** → **Create a token**. Choose a name, which servers it may control, and when it expires. Copy the token; it is shown once.
2. **Claude Code:** run the command the panel shows, which looks like
   ```bash
   claude mcp add --transport http snbd https://console.example.com/mcp --header "Authorization: Bearer snbd_..."
   ```
   **Other tools** (Cursor, VS Code, ...): paste the JSON settings the panel shows into their MCP configuration.
3. Ask: "list my servers", "restart nginx on web-1", "which IP do I need for a DNS A record on web-1?", "show me the last 50 agent log lines on web-1".

### Connect the Claude app (OAuth, no token to paste)
Behind CloudPanel's nginx, first add the `/.well-known/oauth-` location block described in `docs/DOCKER.md` (step 3), or the app cannot find the sign-in service.

1. Claude → Settings → Connectors → **Add custom connector**, address `https://<panel>/mcp` (the MCP server page shows it with a copy button).
2. Click **Connect**. A panel page opens: sign in, choose all servers or some, read the full-access warning, then click **Allow full access**.
3. The connector appears under **MCP server** as an approved app and can be disconnected there at any time.

Claude Code can use the same flow (`/mcp` inside Claude Code, then authenticate), or a pasted token as above.

## Tools
| Tool | Access | What it does |
|---|---|---|
| `list_servers` | read | The servers this connection can see, with status, provider, region, IP on record, and whether the panel agent is online. |
| `server_status` | read | One server in detail: agent version, last heartbeat, latest CPU, memory, disk and uptime. |
| `get_public_ip` | read | The address to put in a DNS A record. Asks the server itself, and also reports the address the panel sees and the IP on record, with notes when they disagree (NAT, proxy). |
| `view_logs` | read | Recent lines from `system`, `agent`, `unit:<name>` (a systemd service) or `docker:<container>`. 1 to 500 lines. |
| `list_files` | read | Files and directories at an absolute path, with type, size and modification time. |
| `read_file` | read | Up to 128 KB from a file, with an optional byte offset. |
| `run_command` | write | Runs a shell command on the server and returns stdout, stderr and the exit code. 60 seconds maximum. Confirm destructive commands first. |
| `write_file` | write | Creates or overwrites a file (maximum 512 KB). The parent directory must already exist. |
| `restart_service` | write | `systemctl start`, `stop`, `restart`, `enable`, `disable` or `status` for a systemd unit, then reports whether it is active. |

The server sends the assistant instructions: ask which server when there are several, never guess when an agent is offline, confirm
the IP when sources disagree, do not paste secrets from logs, confirm before destructive commands, prefer a dedicated tool over
`run_command`, and verify a change after making it.

## Safety model
- **Full access by design.** An approved connection can run arbitrary commands on the servers it was given. Only approve AI clients you trust,
  and limit a connection to selected servers when it does not need all of them.
- **Tokens:** `snbd_` plus 256 random bits. Only the SHA-256 is stored; the token is shown once. Up to 20 active tokens per person;
  optional expiry (30, 90, 365 days or none); revoke any time and it stops at once.
- **Server scoping:** a connection belongs to one customer and can be limited to chosen servers. Every call re-checks ownership, so no
  connection can reach another customer's servers.
- **Separate from sign-in:** a token only opens `/mcp`. It cannot call the normal API or create tokens, and a sign-in session cannot call `/mcp`.
- **Audit:** every server-level call appears in **Activity**, tagged with the connection's name. `run_command` records the command and
  exit code; `write_file` records the path and size; `restart_service` records the unit and action.
- **Abuse limits:** 600 requests/minute per token, and 20 bad tokens from one IP block token logins from that IP for 10 minutes.
- **Origin check:** browser requests from another site are refused (MCP clients send no Origin).
- **Revocation:** disconnecting a client or revoking a token takes effect on the next request.

## OAuth details (for operators)
OAuth 2.1 authorization code with **PKCE (S256 only)**, public clients, dynamic client registration (RFC 7591), discovery
(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), token refresh with rotation, and revocation (RFC 7009).
- **Scope:** the server advertises the `full` scope because every connection has full access to its approved servers.
- **Lifetimes:** access token 1 hour, refresh token 30 days (rotated on every use), a connection must be approved again after 90 days. A one-time code lasts 5 minutes.
- **Theft response:** reusing an authorization code or an old refresh token revokes the whole connection.
- **Who can register an app:** registration is open by design, so *where a code may be sent* is restricted. Allowed redirect addresses: `https://claude.ai`, `https://claude.com`,
  `http://localhost`/`127.0.0.1` on any port (desktop and CLI apps), and the app schemes `cursor`, `vscode`, `vscode-insiders`, `windsurf`, `claude`. Add more with
  `OAUTH_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,chatgpt.com` and `OAUTH_ALLOWED_REDIRECT_SCHEMES=...` in the panel's `.env`. A refused registration is logged with the address.
- **Approval page:** shows the app's name, the host it will return to, and a full-access warning. It warns to continue only if the customer just started the connection.
- **Storage:** codes and tokens are stored as SHA-256 only. Expired data is cleaned up hourly.

## What is not built yet
Creating or deleting servers through MCP, a per-connection read-only/deploy choice, and application install recipes. `restart_service`
handles systemd units; use `run_command` for Docker containers. The `deploy` scope exists in the database, but every MCP connection
currently gets the full tool set regardless of the stored scope.

## Protocol notes
Streamable HTTP, stateless: each POST is a JSON-RPC 2.0 message (or a batch of up to 20) answered with plain JSON; notifications get `202`; `GET`/`DELETE` return `405`.
Versions `2025-06-18`, `2025-03-26` and `2024-11-05` are accepted. Tested with the official MCP client SDK and Claude Code.

Tests: `apps/api/src/oauth-smoke.ts` (runs the official SDK's OAuth client end to end plus attack cases) and `apps/api/src/mcp-smoke.ts`
(needs the API on :3101, the demo login in `DEMO_PASSWORD` and `AGENT_BIN`).
