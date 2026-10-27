# SNBD Console

A self-hosted VPS management panel for SNBD Host. Customers can connect existing Linux servers, open a browser terminal, manage files, install applications, and monitor their servers. Hetzner Cloud provisioning and a WHMCS module connect the panel to a hosting business's ordering and billing workflow.

The project contains a React frontend, a TypeScript API backed by PostgreSQL, and a Go agent that runs on each managed VPS. It also exposes read-only server tools to AI assistants through the Model Context Protocol (MCP).

## Features

- **Server overview:** connection status, CPU, memory, disk usage, uptime, and activity history.
- **Browser terminal:** interactive PTY sessions over WebSockets, including terminal resizing.
- **File manager:** browse, edit text files, upload/download, create folders, rename, and delete. Text edits support files up to 2 MB; uploads support files up to 200 MB.
- **Application installer:** recipes for Claude Code, Hermes Agent, OpenClaw, Docker, Node.js 22, n8n, and Ollama, with progress, logs, and cancellation.
- **Server management:** connect an existing VPS, reset its root password, and use provider-supported power and OS reinstall controls.
- **Hetzner Cloud:** provision, suspend/unsuspend, resize, rebuild, and delete servers through the provider adapter.
- **WHMCS integration:** signed, idempotent lifecycle webhooks that provision the VPS and create a panel login, plus one-click SSO and password reset.
- **AI connectors:** scoped personal API tokens and OAuth authorization for read-only MCP tools.
- **Operations:** signed agent releases, agent key rotation, offline/recovery alerts, audit logs, retention cleanup, and database backup/restore scripts.

**Current limits:** BDIX is a placeholder adapter and does not provision VMs. Hetzner refuses to provision in production when `HETZNER_API_TOKEN` is missing (development still falls back to the stub). MCP currently exposes read-only tools; deployment and other write tools are not implemented. CloudPanel is a deployment option for the panel, not an included application recipe. Use the [staging checklist](docs/STAGING.md) to validate real provider operations and app installations before serving customers.

## Architecture

```text
Browser ── HTTPS / WebSocket ──> SNBD API ──> PostgreSQL
                                    │
Linux VPS agent ── outbound WSS ─────┤
                                    ├──> Hetzner Cloud API
WHMCS ── signed webhook / SSO ───────┤
AI assistant ── MCP + token/OAuth ───┘
```

Agents connect out to the panel at `/agent`; the panel does not need an inbound agent port on each VPS. Terminal sessions, file operations, metrics, and application jobs share this connection. The production API serves the built frontend as well as the API routes.

## Requirements

- **Node.js 22** with a current patch release (the deployment images use Node 22).
- **pnpm 11.15.1**, matching the Docker build.
- **PostgreSQL 16**, matching the Compose configuration, plus PostgreSQL client tools for local setup and backups.
- **Go 1.26 or newer** to build or run the agent, as declared in `agent/go.mod`.
- Managed VPSs: **Linux amd64 or arm64**; the installer expects root access and systemd. OpenSSL 3+ enables agent release signature verification.
- Optional: Docker for container deployment and provider/tools integration checks; a Hetzner Cloud project token for real provisioning; WHMCS for billing integration.

The agent executes terminal commands, file operations, and application recipes with the permissions of its operating-system user. A root-installed agent therefore manages the VPS as root. Use a disposable Linux VM for development involving these operations.

## Local development

### 1. Install dependencies and configure the database

```bash
git clone https://github.com/yeaminlabs/snbd-console.git
cd snbd-console
pnpm install --frozen-lockfile
cp .env.example .env
createdb snbd_console
```

Ensure PostgreSQL is running and edit `.env` to match your local database credentials. The supplied development settings use:

```dotenv
DATABASE_URL=postgres://localhost:5432/snbd_console
PORT=3101
PUBLIC_PANEL_URL=http://localhost:3101
```

Use port `3101` for the following instructions: it matches Vite's proxy and the integration scripts. Without a `PORT` setting, the API itself defaults to `3000`.

```bash
pnpm migrate
pnpm seed
```

The seed creates a development customer (`demo@snbd.test` / `demo-password`), a `dev-box` server record, and a single-use enrollment token valid for 30 minutes. It prints the server ID and token. `SEED_EMAIL` and `SEED_PASSWORD` override the demo credentials when creating a customer; reseeding an existing email does not reset its password. Use demo credentials only for local development.

### 2. Start the API and frontend

Run each command in a separate terminal at the repository root:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173) and sign in with the seeded account. Vite proxies API, terminal, MCP, and OAuth requests to `http://localhost:3101`. Set `API_URL` when launching `dev:web` if the API uses a different address.

### 3. Connect a development agent

In another terminal, substitute the token printed by `pnpm seed`:

```bash
cd agent
PANEL_URL=ws://localhost:3101/agent \
  SNBD_STATE_DIR=./.snbd \
  ENROLL_TOKEN='<enrollment-token>' \
  go run .
```

This connects the machine running the command as `dev-box`. When running the agent on a separate Linux VM, replace `localhost` with an API address reachable from that VM. Enrollment stores the agent key in `SNBD_STATE_DIR`; subsequent connections reuse that key without another token. The panel's **Connect existing VPS** flow creates additional server records and installer commands.

## Configuration

Local API development, migration, seed, and client-creation commands read the root `.env`. Production `pnpm start` expects configuration to be supplied through the process environment; it does not load `.env` automatically. The systemd unit uses `/etc/snbd-console.env`, and Compose supplies environment variables explicitly.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Required in production. |
| `PORT`, `HOST` | API listen address. Defaults: `3000`, `0.0.0.0`. Use `3101` for the documented setup. |
| `PUBLIC_PANEL_URL` | Address customers and agents use. Must begin with `https://` in production. |
| `NODE_ENV` | Set to `production` for production validation, secure cookies, and serving the built frontend. |
| `TRUST_PROXY` | Trusted reverse proxy IPs/CIDRs. Match the actual proxy; production examples bind the API to localhost or a private container network. |
| `WHMCS_WEBHOOK_SECRET` | Shared WHMCS signing secret, at least 32 characters when configured. Leave empty to keep the integration disabled. |
| `WHMCS_API_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, `WHMCS_VPS_GROUP_IDS` | Lets clients order a VPS from the dashboard: the panel reads live products/pricing from WHMCS (Setup > API Credentials) and "Order" hands off to its cart to pay. `WHMCS_VPS_GROUP_IDS` is a comma-separated list of Product Group IDs (one per VPS region/plan group). All four are required together; leave any unset to hide VPS ordering. |
| `HETZNER_API_TOKEN` | Read/write Hetzner Cloud project token. Required for real Hetzner operations. |
| `HETZNER_API_URL` | Optional provider URL override, used by the local mock. |
| `WEB_URL` | Optional frontend address for SSO redirects and allowed browser origins. Defaults to the public panel URL for SSO. |
| `RELEASES_DIR` | Optional signed agent release directory. Defaults to `dist/releases` at the repository root. |
| `ALERT_WEBHOOK_URL` | Optional Slack, Mattermost, Discord, or compatible receiver for offline/recovery notifications. |
| `ALERT_GRACE_SECONDS` | Offline alert delay; defaults to `120`. |
| `KEY_ROTATE_AFTER_DAYS` | Agent key rotation age; defaults to `30`. |
| `OAUTH_ALLOWED_REDIRECT_HOSTS`, `OAUTH_ALLOWED_REDIRECT_SCHEMES` | Override OAuth redirect allowlists; see [MCP documentation](docs/MCP.md). |

See [.env.example](.env.example), [production settings](deploy/env.production.example), and [Compose configuration](deploy/docker/compose.yml) for deployment-specific settings. Keep real environment files, database backups, agent state, and private release-signing keys out of Git.

## Build and deploy

```bash
pnpm build
```

This type-checks and builds the frontend into `apps/web/dist`. The API runs TypeScript directly with `tsx`; there is no separate API compilation step. After migrations, launch it with the production environment supplied:

```bash
pnpm migrate
NODE_ENV=production pnpm start
```

Choose a deployment guide:

- [Docker with CloudPanel](docs/DOCKER.md): panel and PostgreSQL containers behind an HTTPS reverse proxy. The image applies migrations on startup. The guide includes details for the existing deployment; substitute your own domain, host, and paths.
- [CloudPanel deployment](docs/CLOUDPANEL.md): automated systemd installation and a manual alternative.
- [Staging checklist](docs/STAGING.md): end-to-end checks for provisioning, agents, WHMCS, alerts, backups, and restore.

The systemd files, Caddy example, and production environment template are in `deploy/`. `scripts/install-production.sh --help` lists installer options; `--dry-run` previews its changes. Serve the panel over HTTPS, proxy WebSockets, and allow the required upload size. OAuth connectors also need `/.well-known/oauth-*` discovery routes to reach the API; see the nginx example in the Docker guide.

**Resilience:** the API tolerates the Postgres connection dropping and reconnecting (a `pool.on('error')` handler, since Node otherwise treats an unhandled pool error as fatal) - this is what a routine `apt` security update restarting Postgres looks like to the app, and it used to crash the process every time. `snbd-api.service` also gets a generous restart budget (`StartLimitBurst=20` over `StartLimitIntervalSec=120`) so a burst of real failures doesn't leave the unit stuck "failed" waiting for someone to notice; `OnFailure=snbd-api-alert.service` posts to `ALERT_WEBHOOK_URL` if it ever does give up.

Create a production customer without demo data using:

```bash
CLIENT_EMAIL=you@example.com \
  CLIENT_NAME='Your Name' \
  CLIENT_PASSWORD='<password-at-least-12-characters>' \
  pnpm create-client
```

Add `RESET=1` to reset an existing customer's password and revoke their browser sessions. This helper also reads the root `.env`, so configure it for the intended database.

### Signed agent releases

On the machine used to build releases:

```bash
node scripts/release.mjs keygen  # once; refuses to overwrite an existing key
./scripts/build-agent.sh
```

The build produces Linux amd64 and arm64 binaries, `VERSION`, `SHA256SUMS`, its Ed25519 signature, and the public key in `dist/releases/`. The API serves these files at `/dl/`. The private key stays at `~/.snbd/release-ed25519.pem` (or `SNBD_RELEASE_KEY`); back it up separately and never publish it.

Customers use the command from **Connect existing VPS**, which fetches `/enroll/<token>`. Cloud-init uses `/install.sh` with enrollment settings in `/etc/snbd/agent.env`. The installer checks SHA-256 and verifies the signature when supported; `SNBD_REQUIRE_SIGNATURE=1` makes unavailable signature verification fatal. Re-running the installer upgrades the binary while preserving enrollment unless an explicit enrollment token requests a new connection. Releasing a new binary does not automatically update enrolled VPSs.

### Backups

`scripts/backup-db.sh` creates verified custom-format PostgreSQL dumps and keeps the newest 14. `scripts/restore-db.sh` restores into an empty database. The systemd backup service/timer and Docker backup script provide deployment-specific scheduling options. Copy backups off the panel host and test restoration.

## Integrations

### WHMCS and providers

Copy `whmcs-module/snbdpanel/` to `<whmcs>/modules/servers/snbdpanel/`. Add the panel as a WHMCS server using its hostname, enable **Secure**, and set **Access Hash** to `WHMCS_WEBHOOK_SECRET`. Configure a product with the **SNBD Panel** module and the appropriate provider, region, OS, and plan. Hetzner products require an actual Hetzner server type.

The module sends HMAC-signed requests to `POST /webhooks/whmcs` with timestamp and idempotency headers. Supported actions are `create`, `suspend`, `unsuspend`, `changepackage`, `terminate`, and `sso`. SSO links are single-use and valid for 60 seconds. The [staging guide](docs/STAGING.md) covers full setup and validation.

That webhook is WHMCS calling the panel after an order is paid. The other direction — a client ordering a *new* VPS from inside the panel — is read-only against the WHMCS API and never touches payment:

1. Put every sellable VPS product into one or more WHMCS Product Groups (Setup > Products/Services > Create/Manage Groups) and note their group IDs.
2. Generate an API credential (Setup > API Credentials; note that WHMCS lets you restrict a credential to specific IPs — if you do, allowlist the panel server's outbound IPv4 address) and set `WHMCS_API_URL` (e.g. `https://portal.snbdhost.com`), `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, and `WHMCS_VPS_GROUP_IDS` (comma-separated, e.g. `4,6,17,18,20,22`) in the API's environment. The panel always calls WHMCS over IPv4, even on a dual-stack host, so a single IPv4 allowlist entry is enough.
3. The dashboard's **Order a new VPS** button calls `GET /api/vps-plans`, which fetches every product in those groups (name, description, live pricing) from `GetProducts` and returns one `orderUrl` per plan pointing at `WHMCS_API_URL/cart.php?a=add&pid=<id>`.
4. Clicking a plan opens that cart link in a new tab, where the client logs in/registers and pays on WHMCS with whatever gateways are already configured there. Once WHMCS activates the order, the existing `snbdpanel` module webhook provisions the server and it appears in the dashboard on its own.

Changing the WHMCS address or group later is just an environment-variable edit and a restart — no code change or redeploy.

Check available server types and OS images before real provisioning:

```bash
pnpm hetzner:check <server-type>
```

This requires `HETZNER_API_TOKEN` in the command's environment. To exercise the mock provider, run `pnpm mock:hetzner`, then start the API with `HETZNER_API_TOKEN=test-token` and `HETZNER_API_URL=http://localhost:4010/v1`.

### AI assistants (MCP)

The **AI agents** page creates revocable tokens scoped to the customer's servers. MCP clients connect to `https://<panel>/mcp` with a bearer token, or use OAuth authorization with PKCE where supported.

Available tools: `list_servers`, `server_status`, `get_public_ip`, and `view_logs`. They cannot deploy applications or execute arbitrary commands. See [MCP and OAuth setup](docs/MCP.md) for client configuration, permissions, proxy requirements, and protocol details.

## Verification

Basic checks:

```bash
pnpm --filter @snbd/api typecheck
pnpm build
cd agent
go test ./...
```

The Go package currently has no unit test files; `go test` verifies that it compiles. Integration smoke scripts live in `apps/api/src/` and require a running API and a disposable migrated database. They create or modify test records and may run commands through agents.

For example, with the seeded agent connected:

```bash
pnpm --filter @snbd/api exec tsx --env-file=../../.env src/smoke.ts <server-id>
```

| Script | Coverage / additional setup |
| --- | --- |
| `webhook-smoke.ts` | WHMCS webhook behavior. |
| `provider-smoke.ts` | Mock Hetzner provisioning/reinstall; requires Docker and the mock provider. |
| `tools-smoke.ts` | File management, app jobs, and password reset; requires Docker and the `snbd-vm-base` image prepared by the provider smoke script. |
| `hardening-smoke.ts` | Rate limits, cleanup, alerts, and key rotation; requires a native `AGENT_BIN` and the API alert settings listed at the top of the script. |
| `mcp-smoke.ts` | MCP tools and token isolation; requires `DEMO_PASSWORD` and a native `AGENT_BIN`. |
| `oauth-smoke.ts` | OAuth/PKCE, refresh/revocation, and MCP SDK authorization; requires `DEMO_PASSWORD` and `PUBLIC_PANEL_URL=http://localhost:3101` on the API. |

Use the same `pnpm --filter @snbd/api exec tsx --env-file=../../.env src/<script>.ts` form for these scripts, supplying their required environment settings. Check each script's setup before running it; several assume the API is on port `3101`.

## Repository layout

```text
apps/api/          Fastify API, PostgreSQL migrations, providers, MCP/OAuth, smoke scripts
apps/web/          React + Vite frontend and xterm.js terminal
agent/             Go VPS agent (terminal, files, jobs, metrics)
packages/proto/    Shared TypeScript message schemas
scripts/apps/      Application installation recipes
scripts/           Release, deployment, backup, and provider utility scripts
deploy/            Docker Compose, systemd, Caddy, and environment examples
docs/              Deployment, staging, and integration guides
whmcs-module/      WHMCS provisioning module and client-area template
```
