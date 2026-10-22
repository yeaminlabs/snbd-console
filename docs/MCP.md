# AI agents (MCP)

Customers can connect an AI assistant (Claude, Cursor and others) to their own servers through the panel. The assistant talks to
`https://<panel>/mcp` using the Model Context Protocol and a personal **API token**. Today the tools are read-only.

## For customers: connect Claude
1. Panel → **AI agents** → **Create a token**. Choose a name, which servers it may see, and when it expires. Copy the token; it is shown once.
2. **Claude Code:** run the command the panel shows, which looks like
   ```bash
   claude mcp add --transport http snbd https://console.example.com/mcp --header "Authorization: Bearer snbd_..."
   ```
   **Other tools** (Cursor, VS Code, ...): paste the JSON settings the panel shows into their MCP configuration.
3. Ask: "list my servers", "which IP do I need for a DNS A record on web-1?", "show me the last 50 agent log lines on web-1".

### Connect the Claude app (OAuth, no token to paste)
Behind CloudPanel's nginx, first add the `/.well-known/oauth-` location block described in `docs/DOCKER.md` (step 3), or the app cannot find the sign-in service.

1. Claude → Settings → Connectors → **Add custom connector**, address `https://<panel>/mcp` (the AI agents page shows it with a copy button).
2. Click **Connect**. A panel page opens: sign in, choose all servers or some, click **Allow**.
3. The connector appears under **AI agents** as "Connected app" and can be disconnected there at any time.

Claude Code can use the same flow (`/mcp` inside Claude Code, then authenticate), or a pasted token as above.

## Tools (all read-only)
| Tool | What it does |
|---|---|
| `list_servers` | The servers this token can see, with status, provider, region, IP on record, and whether the panel agent is online. |
| `server_status` | One server in detail: agent version, last heartbeat, latest CPU, memory, disk and uptime. |
| `get_public_ip` | The address to put in a DNS A record. Asks the server itself, and also reports the address the panel sees and the IP on record, with notes when they disagree (NAT, proxy). |
| `view_logs` | Recent lines from `system`, `agent`, `unit:<name>` (a systemd service) or `docker:<container>`. 1 to 500 lines. |

The server sends the assistant instructions: ask which server when there are several, never guess when an agent is offline, confirm the IP when
sources disagree, do not paste secrets from logs, and never claim a change was made.

## Safety model
- **Tokens:** `snbd_` plus 256 random bits. Only the SHA-256 is stored; the token is shown once. Up to 20 active tokens per person; optional expiry (30, 90, 365 days or none); revoke any time and it stops at once.
- **Scope:** a token belongs to one customer and can be limited to chosen servers. Every call re-checks ownership, so no token can see another customer's servers.
- **Separate from sign-in:** a token only opens `/mcp`. It cannot call the normal API or create tokens, and a sign-in session cannot call `/mcp`.
- **Fixed commands only:** `get_public_ip` and `view_logs` run commands built by the panel. The log source is matched against a strict pattern (no spaces, quotes or path characters) and the line count is a bounded integer, so a request cannot inject shell syntax. The tools cannot run arbitrary commands.
- **Audit:** every server-level call appears in **Activity** as "Agent: <token name>". Token creation and revocation are recorded too.
- **Abuse limits:** 600 requests/minute per token, and 20 bad tokens from one IP block token logins from that IP for 10 minutes.
- **Origin check:** browser requests from another site are refused (MCP clients send no Origin).

## OAuth details (for operators)
OAuth 2.1 authorization code with **PKCE (S256 only)**, public clients, dynamic client registration (RFC 7591), discovery
(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), token refresh with rotation, and revocation (RFC 7009).
- **Lifetimes:** access token 1 hour, refresh token 30 days (rotated on every use), a connection must be approved again after 90 days. A one-time code lasts 5 minutes.
- **Theft response:** reusing an authorization code or an old refresh token revokes the whole connection.
- **Who can register an app:** registration is open by design, so *where a code may be sent* is restricted. Allowed redirect addresses: `https://claude.ai`, `https://claude.com`,
  `http://localhost`/`127.0.0.1` on any port (desktop and CLI apps), and the app schemes `cursor`, `vscode`, `vscode-insiders`, `windsurf`, `claude`. Add more with
  `OAUTH_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,chatgpt.com` and `OAUTH_ALLOWED_REDIRECT_SCHEMES=...` in the panel's `.env`. A refused registration is logged with the address.
- **Approval page:** shows the app's name and the host it will return to, and warns to continue only if the customer just started the connection.
- **Storage:** codes and tokens are stored as SHA-256 only. Expired data is cleaned up hourly.

## What is not built yet
Write tools (deploy, restart, install), a "deploy" token scope, and domain/HTTPS handling for deployed apps. The `deploy` scope
already exists in the database and the tool checks, but the panel cannot create such tokens yet.

## Protocol notes
Streamable HTTP, stateless: each POST is a JSON-RPC 2.0 message (or a batch of up to 20) answered with plain JSON; notifications get `202`; `GET`/`DELETE` return `405`.
Versions `2025-06-18`, `2025-03-26` and `2024-11-05` are accepted. Tested with the official MCP client SDK and Claude Code.

Tests: `apps/api/src/oauth-smoke.ts` (61 checks, runs the official SDK's OAuth client end to end plus attack cases) and `apps/api/src/mcp-smoke.ts` (46 checks; needs the API on :3101, the demo login in `DEMO_PASSWORD` and `AGENT_BIN`).
