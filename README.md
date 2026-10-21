# SNBD Console

VPS panel: a Go agent inside each VPS dials out to this Node API; browsers get a terminal (files, apps, reinstall come next).
Design: https://claude.ai/artifact/6HKa7dAa78BET1bewmAyTu. Build plan phases 0-7 are done.

## Run locally
Needs Node, pnpm, Go, Postgres (`createdb snbd_console`).

```bash
pnpm install
cp .env.example .env        # DATABASE_URL, PORT=3101
pnpm migrate
pnpm seed                   # prints login + one-time agent token (30 min, single use)
pnpm dev:api                # http://localhost:3101
pnpm dev:web                # http://localhost:5173
cd agent && PANEL_URL=ws://localhost:3101/agent SNBD_STATE_DIR=./.snbd ENROLL_TOKEN=<token> go run .
```
Sign in with the seeded login, open the server, click Open terminal.
After the first enroll the agent stores its key in `SNBD_STATE_DIR` and reconnects without the token.

`pnpm --filter @snbd/api exec tsx --env-file=../../.env src/smoke.ts <serverId>` runs a headless terminal check.

## Agent releases and install
```bash
node scripts/release.mjs keygen   # once; private key goes to ~/.snbd/release-ed25519.pem (back it up, never commit)
./scripts/build-agent.sh          # builds linux amd64+arm64, writes SHA256SUMS, signs it, into dist/releases/
```
The panel serves `dist/releases` under `/dl/`, plus:
- `GET /enroll/<token>`: `curl -fsSL <panel>/enroll/<token> | sh` (what "Connect existing VPS" shows)
- `GET /install.sh`: first-boot script for cloud-init; reads the token from `/etc/snbd/agent.env`

`install.sh` verifies the Ed25519 signature (OpenSSL 3+; older systems get a warning, or a hard fail with
`SNBD_REQUIRE_SIGNATURE=1`), then the SHA-256, installs `snbd-agent` and a systemd unit, enrolls, and
removes the spent token from `agent.env`. Plain `http://` panels are refused unless `SNBD_INSECURE=1`.
Tested on Ubuntu 24.04 (systemd), Debian 12 and AlmaLinux 9 (arm64 containers).

## WHMCS
Copy `whmcs-module/snbdpanel/` to `<whmcs>/modules/servers/snbdpanel/`. In WHMCS add a Server: hostname = panel host,
tick Secure, Access Hash = `WHMCS_WEBHOOK_SECRET` from `.env`. Create a product with module "SNBD Panel" and set provider,
vCPU, RAM, disk, region and OS (a configurable option named `os` overrides the product default).

The module calls `POST /webhooks/whmcs` with `X-SNBD-Timestamp`, `X-SNBD-Signature: sha256=<hmac of "<ts>.<body>">` and
`X-SNBD-Idempotency-Key`. Timestamps more than 5 minutes off are refused; a repeated key replays the first answer.
Actions: `create` (client + server + 24 h enroll token + cloud-init user-data to the provider adapter), `suspend`,
`unsuspend`, `changepackage`, `terminate` (revokes the agent key), and `sso` (60-second single-use sign-in link
for the client-area "Open panel" button).
Until a real provider adapter exists (phase 5) a stub records the user-data under `dist/dev-userdata/` and creates no VM.

`pnpm --filter @snbd/api exec tsx --env-file=../../.env src/webhook-smoke.ts` runs 22 webhook checks against a running API.

## Providers, power and reinstall
`apps/api/src/providers/` holds the adapter interface. **Hetzner** (`hetzner.ts`) creates, powers, resizes, reinstalls and
deletes servers; it is used when `HETZNER_API_TOKEN` is set. A retried create reuses the VM labelled `snbd_server_id=<id>`
instead of making a second one. **BDIX** is a stub: it creates nothing and the API answers 501 for power and reinstall.
WHMCS products for Hetzner need the "Hetzner server type" option (e.g. `cx22`).

- `POST /api/servers/:id/power` `{action: start|stop|reboot}`; stop = graceful shutdown.
- `POST /api/servers/:id/reinstall` `{os, acknowledged: true}`: sends a fresh enroll token inside user-data with the rebuild,
  then revokes the old agent key. The Hetzner root password is returned once to the browser and never stored.
- Resize = power off, `change_type` (disk kept), power on.

Before using a real project run `HETZNER_API_TOKEN=... pnpm hetzner:check cx22` to confirm the OS images in
`apps/api/src/os.ts` and your server types exist. To try everything without Hetzner: `pnpm mock:hetzner`, then start the API with
`HETZNER_API_TOKEN=test-token HETZNER_API_URL=http://localhost:4010/v1`, and run `src/provider-smoke.ts`
(needs Docker; boots a container from the user-data to prove the VM re-enrolls itself after a reinstall).

## Files, apps and password reset (agent 0.3.0)
The panel talks to the agent over the same outbound socket with request/response calls (`rpc`) and background jobs.
- **Files**: list, edit (text, up to 2 MB, saved atomically with permissions kept), upload (up to 200 MB, in 1 MB parts),
  download, new folder, rename, delete. Deleting top-level system folders is refused. Every write, upload, download and delete is audited.
- **Apps**: recipes live in `scripts/apps/` (`_lib.sh` helpers + one script per app) and are sent to the agent as a job. Recipes print
  `##STEP i/N text` lines, which drive the progress bar. One job per server at a time; cancel sends SIGTERM, then SIGKILL after 10 s.
  If the agent drops, its job is marked failed. Included: Claude Code, Hermes Agent, OpenClaw, Docker, Node.js 22, n8n, Ollama.
  CloudPanel is not included yet. To add an app: write `scripts/apps/<id>.sh` and add it to `apps/api/src/apps.ts`.
- **Password reset**: the panel generates a 20-character password, the agent sets it with `chpasswd` (stdin), the browser shows it once.
  It is never stored or logged.
- Run `src/tools-smoke.ts` (needs Docker and `snbd-vm-base`, built by `provider-smoke.ts`) for 48 end-to-end checks.

## Production (phase 7)
Files in `deploy/`: `Caddyfile` (automatic HTTPS), `snbd-api.service`, `snbd-backup.service` + `.timer`, `env.production.example`.
1. `pnpm install && pnpm build` (the API then serves the built web app itself), `./scripts/build-agent.sh`.
2. Copy `deploy/env.production.example` to `/etc/snbd-console.env` (mode 600), fill it in. In production the API refuses to start
   unless `PUBLIC_PANEL_URL` is https and secrets are long enough. Keep `HOST=127.0.0.1` and `TRUST_PROXY=true` behind Caddy.
3. Install the unit files, edit the domain in the Caddyfile, start `snbd-api` and Caddy, enable `snbd-backup.timer`.

**Limits and protections**: 5 wrong logins per IP+email lock that pair for 15 min; per-IP caps on login, webhook, enroll, installer
and agent connections; 600 requests/min per signed-in session. Browser POSTs naming a foreign `Origin` are refused. Security headers
and a CSP are sent. Agents with 10 failed attempts from one IP are blocked for 10 min.
**Cleanup** (hourly): expired enroll/SSO tokens and sessions, webhook events (30 d), heartbeats (30 d), finished jobs (90 d), audit log (365 d);
tune with `*_RETENTION_DAYS`. **Key rotation**: connected agents get a new key every 30 days (`KEY_ROTATE_AFTER_DAYS`); the old key keeps working
until the agent uses the new one, so a lost message cannot lock a server out. `pnpm rotate-keys` forces a rotation on every agent's next check.
**Offline alerts**: set `ALERT_WEBHOOK_URL` (Slack, Mattermost or Discord). A server whose agent is gone for `ALERT_GRACE_SECONDS` (120) gets one alert
and one recovery notice. Dead connections are detected by a 25 s ping (agent 0.4.0 also drops a link silent for 75 s).
**Backups**: `scripts/backup-db.sh` (custom-format dump, verified, newest 14 kept, mode 600) and `scripts/restore-db.sh` (empty database only).
Copy dumps off the machine, and back up `~/.snbd/release-ed25519.pem` separately: losing it means re-signing releases and re-issuing the installer.
Checks: `src/hardening-smoke.ts` (27 checks; run the API with `ALERT_WEBHOOK_URL=http://localhost:4020 ALERT_GRACE_SECONDS=3 MONITOR_INTERVAL_MS=1000` and `AGENT_BIN=<built agent>`).

## Layout
`apps/api` Fastify + ws + Postgres · `apps/web` React + Vite + xterm.js · `agent` Go · `packages/proto` shared message schemas
