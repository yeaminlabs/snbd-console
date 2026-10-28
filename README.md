# SNBD Console

SNBD Console is a self-hosted panel for managing VPS servers. It belongs to SNBD Host. Customers can connect their own Linux servers, open a terminal in the browser, manage files, install apps, and watch server stats. The panel can also order new servers from Hetzner Cloud, and it connects to WHMCS so a hosting business can sell and bill for VPS plans.

The project has three main parts: a React frontend, a TypeScript API backed by PostgreSQL, and a Go agent that runs on each server it manages. The panel also lets AI assistants (like Claude) talk to a customer's servers through the Model Context Protocol (MCP). An AI assistant can run commands and restart services, with the customer's permission.

## Features

- **Server overview:** shows connection status, CPU, memory, disk use, uptime, and a history of what happened on the server.
- **Browser terminal:** a real terminal window that runs over WebSockets, right in your browser. You can resize it like a normal terminal.
- **File manager:** browse folders, edit text files, upload and download files, make folders, rename things, and delete them. You can edit files up to 2 MB and upload files up to 200 MB.
- **Application installer:** one-click installs for Claude Code, Hermes Agent, OpenClaw, Docker, Node.js 22, n8n, and Ollama. You see progress and logs, and you can cancel a running install.
- **Server management:** connect a server you already have, reset its root password, and (where the provider supports it) turn it on/off or reinstall its OS.
- **SSH keys:** make a new Ed25519 key pair (the private key is shown once and never saved) or bring in a key you already have. Install or remove it on any connected server through the agent. Deleting a key removes it everywhere it was installed.
- **Hetzner Cloud:** create, suspend, resume, resize, rebuild, and delete servers directly through Hetzner's API.
- **WHMCS integration:** signed webhooks that set up a new VPS and a panel login when someone orders one, plus one-click sign-in and password reset for that customer.
- **AI connectors:** customers can create personal API tokens or use OAuth to let an AI assistant use MCP tools on the servers they choose.
- **Operations tools:** signed agent updates, agent key rotation, alerts when a server goes offline (and comes back), audit logs, old-data cleanup, and scripts to back up and restore the database.

**What doesn't work yet:** BDIX (through Proxmox) can manage a server that already exists — suspend it, resume it, cancel it, resize it, turn it on/off — once you link it using the "attach" field in the WHMCS module. But it cannot create a brand-new server yet for a fresh order. See [docs/BDIX.md](docs/BDIX.md) for the full picture. Without `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, and `PROXMOX_TOKEN_SECRET` set, BDIX just pretends in development and refuses to do anything in production. The same is true for Hetzner: it refuses to run for real in production if `HETZNER_API_TOKEN` is missing (in development it falls back to a fake version). MCP only offers read tools plus commands, file writes, and service restarts — it cannot create or delete a server. CloudPanel is just one way to deploy the panel, not an app you install through it. Before you put this in front of real customers, run through the [staging checklist](docs/STAGING.md) to check that provisioning and app installs really work.

## How it's built

```text
Browser ── HTTPS / WebSocket ──> SNBD API ──> PostgreSQL
                                    │
Linux VPS agent ── outbound WSS ─────┤
                                    ├──> Hetzner Cloud API
WHMCS ── signed webhook / SSO ───────┤
AI assistant ── MCP + token/OAuth ───┘
```

The agent on each server reaches out to the panel at `/agent` — the panel never needs to open a port on the VPS itself. One connection handles the terminal, file actions, stats, and app installs. In production, the API also serves the built frontend, so it's just one thing to run.

## What you need

- **Node.js 22**, a recent patch release (the deploy images use Node 22).
- **pnpm 11.15.1** — this must match what the Docker build uses.
- **PostgreSQL 16**, matching the Docker Compose setup, plus the PostgreSQL command-line tools for local setup and backups.
- **Go 1.26 or newer**, to build or run the agent (set in `agent/go.mod`).
- Any server you manage: **Linux, amd64 or arm64**, with root access and systemd. OpenSSL 3+ lets the agent check release signatures.
- Optional: Docker, for container deploys and some tests; a Hetzner Cloud token, to create real servers; WHMCS, for billing.

The agent runs terminal commands, file actions, and app installs as whatever OS user installed it. If you install it as root, it manages the whole VPS as root. For testing, use a throwaway Linux VM — don't point it at something you care about.

## Running it on your own machine

### 1. Install everything and set up the database

```bash
git clone https://github.com/yeaminlabs/snbd-console.git
cd snbd-console
pnpm install --frozen-lockfile
cp .env.example .env
createdb snbd_console
```

Make sure PostgreSQL is running, and edit `.env` so it matches your local database. The default settings are:

```dotenv
DATABASE_URL=postgres://localhost:5432/snbd_console
PORT=3101
PUBLIC_PANEL_URL=http://localhost:3101
```

Use port `3101` for everything below — it's what Vite and the test scripts expect. Without a `PORT` setting, the API uses `3000` instead.

```bash
pnpm migrate
pnpm seed
```

This creates a test customer (`demo@snbd.test` / `demo-password`), a server record called `dev-box`, and a one-time setup code that's good for 30 minutes. It prints the server ID and the code. You can set `SEED_EMAIL` and `SEED_PASSWORD` to use different test credentials. Running the seed again on an email that already exists won't change its password. Only use these demo credentials for local testing, never in production.

### 2. Start the API and the frontend

Open two terminal windows at the project's root folder, and run one command in each:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173) and log in with the test account. Vite forwards API, terminal, MCP, and OAuth requests to `http://localhost:3101` automatically. If your API runs somewhere else, set `API_URL` when you start `dev:web`.

### 3. Connect a test agent

In a third terminal, swap in the code that `pnpm seed` printed:

```bash
cd agent
PANEL_URL=ws://localhost:3101/agent \
  SNBD_STATE_DIR=./.snbd \
  ENROLL_TOKEN='<enrollment-token>' \
  go run .
```

This connects whatever machine runs the command, naming it `dev-box`. If you run the agent on a separate Linux VM instead, swap `localhost` for an address that VM can actually reach. Once connected, the agent saves its key in `SNBD_STATE_DIR` and won't need a new code next time. To add more test servers, use the panel's **Connect existing VPS** button — it gives you a fresh command each time.

## Settings

Local commands (the dev API, migrations, seeding, creating a client) all read the `.env` file at the project root. In production, `pnpm start` does **not** load `.env` on its own — it only reads whatever is already in the environment. The systemd setup reads `/etc/snbd-console.env`, and Docker Compose passes its own variables directly.

| Setting | What it's for |
| --- | --- |
| `DATABASE_URL` | How to connect to PostgreSQL. Required in production. |
| `PORT`, `HOST` | Where the API listens. Defaults: `3000` and `0.0.0.0`. Use `3101` to match this guide. |
| `PUBLIC_PANEL_URL` | The address customers and agents use to reach the panel. Must start with `https://` in production. |
| `NODE_ENV` | Set to `production` to turn on production checks, secure cookies, and serving the built frontend. |
| `TRUST_PROXY` | Which reverse-proxy IPs or ranges to trust. Match it to your real setup — in production examples the API itself only listens on localhost or an internal network. |
| `WHMCS_WEBHOOK_SECRET` | A shared secret with WHMCS, at least 32 characters. Leave it blank to turn the WHMCS integration off. |
| `HETZNER_API_TOKEN` | A Hetzner Cloud token with read and write access. Needed for real Hetzner servers. |
| `HETZNER_API_URL` | Optional — lets you point at a different API address, used by the local test mock. |
| `WEB_URL` | Optional — the frontend's own address, used for sign-in redirects. Defaults to the panel's public address. |
| `RELEASES_DIR` | Optional — where signed agent builds live. Defaults to `dist/releases` in the project root. |
| `ALERT_WEBHOOK_URL` | Optional — a Slack, Mattermost, Discord, or similar webhook for offline/back-online alerts. |
| `ALERT_GRACE_SECONDS` | How long to wait before calling a server offline. Defaults to `120`. |
| `KEY_ROTATE_AFTER_DAYS` | How old an agent's key can get before it's rotated. Defaults to `30`. |
| `OAUTH_ALLOWED_REDIRECT_HOSTS`, `OAUTH_ALLOWED_REDIRECT_SCHEMES` | Lets you change which OAuth redirect addresses are allowed. See the [MCP guide](docs/MCP.md). |

Look at [.env.example](.env.example), [the production settings example](deploy/env.production.example), and the [Docker Compose file](deploy/docker/compose.yml) for more detail. Never commit real `.env` files, database backups, agent keys, or private signing keys to Git.

## Building and deploying

```bash
pnpm build
```

This checks the types and builds the frontend into `apps/web/dist`. The API doesn't need a separate build step — it runs straight from TypeScript using `tsx`. Once you've built it and run migrations, start it in production mode:

```bash
pnpm migrate
NODE_ENV=production pnpm start
```

Pick a deploy guide:

- [Docker with CloudPanel](docs/DOCKER.md): runs the panel and PostgreSQL in containers behind an HTTPS proxy. Migrations run automatically on startup. This guide is based on a real deployment, so swap in your own domain, host, and paths.
- [CloudPanel deployment](docs/CLOUDPANEL.md): an automatic systemd install, plus a manual option.
- [Staging checklist](docs/STAGING.md): a full list of checks for provisioning, agents, WHMCS, alerts, backups, and restoring from backup.
- [BDIX / Proxmox integration](docs/BDIX.md): what actually works today (suspend/resume/cancel/resize/power for a server that already exists) versus what's not built yet (creating a brand-new server automatically), how to link an existing customer in, and how the real BDIX server is set up (IPs, disk space, templates).

The systemd files, a Caddy config example, and a production settings template all live in `deploy/`. Run `scripts/install-production.sh --help` to see installer options, or add `--dry-run` to preview what it would do without changing anything. Always serve the panel over HTTPS, let WebSockets through your proxy, and allow large enough file uploads. If you're using OAuth connectors, you'll also need the `/.well-known/oauth-*` routes reachable — see the nginx example in the Docker guide.

**Staying up when things go wrong:** the API can survive its database connection dropping and coming back (this used to crash the whole process whenever something like a routine security update restarted Postgres — now it doesn't). The `snbd-api` service also gets plenty of restart attempts (20 tries over 2 minutes) before systemd gives up on it, so a short burst of real failures won't leave it stuck in a "failed" state until someone notices by hand. If it does eventually give up, it posts an alert to `ALERT_WEBHOOK_URL`.

To create a real production account without any demo data:

```bash
CLIENT_EMAIL=you@example.com \
  CLIENT_NAME='Your Name' \
  CLIENT_PASSWORD='<password-at-least-12-characters>' \
  pnpm create-client
```

Add `RESET=1` to reset an existing customer's password and sign them out everywhere. This command also reads the root `.env`, so make sure it's pointed at the right database first.

### Signed agent releases

On whichever machine you use to build releases:

```bash
node scripts/release.mjs keygen  # run once; won't overwrite a key that already exists
./scripts/build-agent.sh
```

This builds Linux binaries for amd64 and arm64, plus a `VERSION` file, a `SHA256SUMS` file, a signature for it, and the matching public key — all saved to `dist/releases/`. The API serves these at `/dl/`. Keep the private signing key (at `~/.snbd/release-ed25519.pem`, or wherever `SNBD_RELEASE_KEY` points) backed up somewhere safe, and never share it publicly.

Customers get the install command from **Connect existing VPS**, which points at `/enroll/<token>`. New servers set up through cloud-init instead use `/install.sh`, with their setup details stored in `/etc/snbd/agent.env`. Either way, the installer checks the file's checksum and, where possible, its signature too — set `SNBD_REQUIRE_SIGNATURE=1` to make it fail instead of just warning when it can't check the signature. Running the installer again just upgrades the agent and keeps the existing connection, unless you give it a fresh setup code on purpose. Building a new agent release does not automatically push it out to already-connected servers.

### Backups

`scripts/backup-db.sh` makes verified PostgreSQL backups and keeps the last 14. `scripts/restore-db.sh` restores one into an empty database. There's a systemd timer and a Docker script if you want this to run on a schedule. Always copy your backups somewhere else, and actually test that a restore works.

## Connecting other systems

### WHMCS and server providers

Copy `whmcs-module/snbdpanel/` into `<whmcs>/modules/servers/snbdpanel/`. In WHMCS, add the panel as a server using its address, turn on **Secure**, and set **Access Hash** to your `WHMCS_WEBHOOK_SECRET`. Then set up a product using the **SNBD Panel** module, and fill in the right provider, region, OS, and plan. If you're selling Hetzner plans, you also need a real Hetzner server type.

The module sends signed requests to `POST /webhooks/whmcs`, each with a timestamp and a unique ID so the same request can't run twice by accident. It supports `create`, `suspend`, `unsuspend`, `changepackage`, `terminate`, and `sso`. Sign-in links from `sso` only work once, and only for 60 seconds. For full setup and testing steps, see the [staging guide](docs/STAGING.md).

That webhook is WHMCS telling the panel about a paid order. Ordering itself happens in WHMCS — the panel has no ordering UI. Once WHMCS marks the order active, the `snbdpanel` webhook sets up the server, and it shows up in the dashboard on its own.

Before provisioning anything for real, check which server types and OS images are actually available:

```bash
pnpm hetzner:check <server-type>
```

This needs `HETZNER_API_TOKEN` set when you run it. To try it out without touching real infrastructure, run `pnpm mock:hetzner`, then start the API with `HETZNER_API_TOKEN=test-token` and `HETZNER_API_URL=http://localhost:4010/v1`.

### AI assistants (MCP)

The **MCP server** page lets a customer create tokens that can be turned off at any time, each one limited to the servers they choose. An AI assistant can connect to `https://<panel>/mcp` using one of these tokens, or sign in through OAuth where that's supported.

Tools available for looking things up: `list_servers`, `server_status`, `get_public_ip`, `view_logs`, `list_files`, and `read_file`. Tools that change things: `run_command`, `write_file`, and `restart_service`. **Any connection that's approved gets full access** to the servers it covers — the approval screen says this plainly, and every action it takes shows up in the Activity log. It cannot create or delete a server. See the [MCP and OAuth guide](docs/MCP.md) for how to set up a client, what permissions mean, proxy requirements, and the technical details of the protocol.

## Checking your work

Quick checks:

```bash
pnpm --filter @snbd/api typecheck
pnpm build
cd agent
go test ./...
```

The Go code doesn't have real unit tests yet — `go test` just checks that it compiles. The deeper integration tests live in `apps/api/src/` and need a running API plus a database you don't mind messing with, since they create and change real-looking records, and may run commands through connected agents.

For example, with the test agent from earlier still connected:

```bash
pnpm --filter @snbd/api exec tsx --env-file=../../.env src/smoke.ts <server-id>
```

| Script | What it checks, and what it needs |
| --- | --- |
| `webhook-smoke.ts` | How the WHMCS webhook behaves. |
| `provider-smoke.ts` | Creating and reinstalling a server through the mock Hetzner provider. Needs Docker and the mock provider running. |
| `tools-smoke.ts` | File management, app installs, and password reset. Needs Docker and the `snbd-vm-base` image (built by the provider smoke script). |
| `hardening-smoke.ts` | Rate limits, cleanup, alerts, and key rotation. Needs a native `AGENT_BIN` and the alert settings listed at the top of the script. |
| `mcp-smoke.ts` | MCP tools and making sure tokens stay isolated from each other. Needs `DEMO_PASSWORD` and a native `AGENT_BIN`. |
| `oauth-smoke.ts` | OAuth, PKCE, refreshing and revoking tokens, and MCP SDK sign-in. Needs `DEMO_PASSWORD` and `PUBLIC_PANEL_URL=http://localhost:3101` set on the API. |

Run these the same way: `pnpm --filter @snbd/api exec tsx --env-file=../../.env src/<script>.ts`, with whatever environment variables that script needs. Read each script's setup notes before running it — several of them assume the API is running on port `3101`.

## What's in this repository

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
