# Run SNBD Console on CloudPanel

This puts the panel on a server that is always on, with a permanent HTTPS address, using CloudPanel for the website,
the certificate and the firewall. When you finish, `https://panel.yourdomain.com` is the address every VPS agent and WHMCS use.

How the pieces fit:

```
browser / VPS agents / WHMCS ──HTTPS──▶ CloudPanel nginx ──▶ 127.0.0.1:3101 (SNBD API, run by PM2)
                                                                   │
                                                              PostgreSQL (127.0.0.1:5432)
```

CloudPanel does **not** run your app and does **not** manage PostgreSQL (its database screens are MySQL only). So you
add two things yourself: PostgreSQL (once, as root) and PM2 (as the site user). Both are normal Linux installs.

Facts below came from CloudPanel's own docs and its Node.js nginx template. Where I am reasoning rather than quoting, it says so.

---

## Fast path: one script (recommended)

`scripts/install-production.sh` does Steps 4 to 7 and 11 below for you and leaves only the CloudPanel clicks. It runs the panel as its own
systemd service on `127.0.0.1:3101`; CloudPanel's Node.js site then simply proxies to that port (so skip the PM2 steps; they are the manual alternative).

**1. On your Mac**, build and upload (replace `SERVER` with the server's IP):
```bash
cd "/Users/yeaminadib/Documents/SNBD HOST/hetzner-clone"
pnpm install && ./scripts/build-agent.sh        # signs the agent with ~/.snbd (the key stays on your Mac)
rsync -a --exclude node_modules --exclude .env --exclude .git --exclude backups --exclude .dev-login --exclude '._*' \
  ./ root@SERVER:/root/snbd-src/
```
**2. On the server**, as root:
```bash
cd /root/snbd-src
./scripts/install-production.sh --domain panel.yourdomain.com --email you@yourdomain.com --name "Your Name"
```
Add `--dry-run` first to see exactly what it would change without changing anything; it asks for confirmation unless you pass `--yes`.
Options: `--password` (otherwise a random one is generated and saved to `/root/snbd-first-login.txt`, mode 600), `--hetzner-token`, `--alert-webhook`,
`--port`, `--skip-releases`, `--help`.

It installs PostgreSQL (if missing) and its **own private Node 22 in `/opt/snbd-node`**, so the server's system Node, `n8n` and your other sites are never touched. It creates the database and secrets (`/etc/snbd-console.env`), builds the web app, applies the database tables,
creates your login, starts the panel, sets up a daily backup, runs one backup, and checks that the panel answers on localhost only. A failing step
stops the script with the reason.

**3. In CloudPanel**, do what the script prints at the end: add a **Node.js site** for the domain with **App Port 3101**, issue the Let's Encrypt
certificate, and add `client_max_body_size 210m;` in the **Vhost** (Step 8 below explains why). Then run the checks in Step 9.

**Updating later:** upload the new code the same way and run the same command again. It keeps your secrets, database and login, applies new
migrations and restarts the panel. It does not touch nginx or the firewall.

Tested end to end in a fresh Ubuntu 24.04 server with systemd (first install, login, re-run, backup, localhost-only binding). Not tested on a
real CloudPanel machine: it assumes nothing else uses port 3101.

The rest of this page is the manual version of the same steps, plus the CloudPanel details.

---

## 0. What you need
- A server with CloudPanel installed: Ubuntu 22.04/24.04 or Debian 12/13, at least 2 GB RAM (CloudPanel's minimum; the panel itself is light).
- A domain you control, for example `panel.yourdomain.com`.
- Root SSH to the server, and the CloudPanel login (`https://<server-ip>:8443`).
- On your Mac: this repo, Go (to build the agent), and your release signing key at `~/.snbd/release-ed25519.pem`.

## 1. DNS
- [ ] Create an **A record**: `panel.yourdomain.com` → the server's public IPv4. Wait until `dig +short panel.yourdomain.com` shows it.
  (CloudPanel's docs require a valid DNS record before it can issue a certificate.)

## 2. Create the site in CloudPanel
- [ ] Sites → **Add Site** → **Create a Node.js Site**.
- [ ] **Domain Name:** `panel.yourdomain.com`. **Node.js Version:** `22` (or newer). **App Port:** `3101`.
- [ ] Create. CloudPanel shows a **Site User** (for example `panel`). Set its SSH password or add your SSH key under the site's **SSH/FTP** tab.
- [ ] Open the site → **SSL/TLS** → Actions → **New Let's Encrypt Certificate** → Create and Install.
  (By default the site has a self-signed certificate; browsers warn until this is done.)

## 3. Firewall
CloudPanel's firewall (Admin Area → Security) is built on UFW.
- [ ] Check that **80** and **443** are allowed (your site needs them).
- [ ] Restrict **22** (SSH) and **8443** (CloudPanel itself) to your own IP if you have a fixed one, as CloudPanel recommends.
- [ ] Do **not** open **3101** or **5432**. The panel listens on `127.0.0.1` only, so nothing outside can reach it even if a rule were added by mistake.

## 4. Install PostgreSQL (as root, once)
CloudPanel's docs mention only MySQL. PostgreSQL installs next to it as an ordinary package and listens on localhost by default
(this is my reasoning, not something CloudPanel documents; the steps below verify it).

```bash
apt-get update && apt-get install -y postgresql postgresql-client
sudo -u postgres psql -c "create role snbd login password 'PUT-A-LONG-RANDOM-PASSWORD-HERE';"
sudo -u postgres createdb -O snbd snbd_console
ss -ltnp | grep 5432      # must show 127.0.0.1:5432 only, never 0.0.0.0
```

Pick the password with `openssl rand -hex 24` and keep it for Step 6.

## 5. Put the code on the server
Easiest, from your Mac (no git credentials needed on the server). Replace `panel` with your Site User:

```bash
cd "/Users/yeaminadib/Documents/SNBD HOST/hetzner-clone"
pnpm install && pnpm build                 # builds apps/web/dist
./scripts/build-agent.sh                    # builds + signs dist/releases (uses ~/.snbd key)
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude .dev-login --exclude backups --exclude .git \
  ./ panel@<server-ip>:~/htdocs/panel.yourdomain.com/
```

Then log in **as the Site User** and install tools (CloudPanel's Node.js docs use PM2 as the process manager):

```bash
ssh panel@<server-ip>
cd ~/htdocs/panel.yourdomain.com
npm install -g pnpm pm2
pnpm install --frozen-lockfile
```

`dist/releases/` (the signed agent binaries) came across with rsync. The **private signing key stays on your Mac**; the server only holds the public half.

## 6. Configure
Still as the Site User. Create `~/snbd.env` (this holds secrets: `chmod 600`):

```bash
cat > ~/snbd.env <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=3101
TRUST_PROXY=127.0.0.1
DATABASE_URL=postgres://snbd:PUT-THE-SAME-PASSWORD-HERE@127.0.0.1:5432/snbd_console
PUBLIC_PANEL_URL=https://panel.yourdomain.com
WHMCS_WEBHOOK_SECRET=
HETZNER_API_TOKEN=
ALERT_WEBHOOK_URL=
EOF
chmod 600 ~/snbd.env
# generate the webhook secret and write it in
sed -i "s|^WHMCS_WEBHOOK_SECRET=.*|WHMCS_WEBHOOK_SECRET=$(openssl rand -hex 32)|" ~/snbd.env
```

- `TRUST_PROXY=127.0.0.1` matters. CloudPanel's nginx **appends** to `X-Forwarded-For`; trusting only the local proxy makes the panel read the real client address
  instead of one a visitor forged. (With `true` a visitor could dodge the login lockout and rate limits.)
- In production the panel refuses to start if `PUBLIC_PANEL_URL` is not https or the webhook secret is shorter than 32 characters.
- Fill `HETZNER_API_TOKEN` and `ALERT_WEBHOOK_URL` when you are ready; leave empty otherwise.

Create the tables and the first login. The migrate script reads `.env` in the project root, so link it:

```bash
cd ~/htdocs/panel.yourdomain.com
ln -sf ~/snbd.env .env
pnpm migrate
SEED_EMAIL=you@yourdomain.com SEED_PASSWORD='a-long-random-password' pnpm seed
```

Use your own email and a long random password. **Do not** run `pnpm seed` without them: the default is a published demo password. The seed also
prints a one-time agent token you can ignore.

## 7. Start it with PM2
```bash
cd ~/htdocs/panel.yourdomain.com
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 status            # snbd should say "online"
pm2 logs snbd --lines 30
```

Keep it running after a server reboot, as CloudPanel's docs describe: edit the Site User's crontab (`crontab -e`) and add

```
PATH=<paste the output of: echo $PATH>
@reboot pm2 resurrect &> /dev/null
```

Quick local check, still on the server: `curl -s localhost:3101/dl/VERSION` prints the agent version.

## 8. Fix the nginx vhost (uploads)
CloudPanel's Node.js template already proxies WebSockets (it sends the `Upgrade` and `Connection` headers) and sets 900-second timeouts, which suits the live
terminal and install logs. It does **not** set an upload size limit, and nginx's default is **1 MB**, which would break file uploads and agent downloads of larger files.

- [ ] Site → **Vhost** tab (the Vhost Editor). Inside the `server { ... }` block, above `location / {`, add:

```nginx
  client_max_body_size 210m;
```

- [ ] Save. CloudPanel checks the syntax and reverts the change if it is wrong.

Re-saving the vhost template later (for example after toggling a setting) can reset this line; check it again if uploads start failing with "413".

## 9. Verify
From your Mac:
- [ ] `curl -I https://panel.yourdomain.com/` → `200`, with `strict-transport-security` and `content-security-policy` headers.
- [ ] `curl https://panel.yourdomain.com/dl/VERSION` prints the agent version.
- [ ] `curl -m 5 http://<server-ip>:3101/` **fails** (port not reachable from outside).
- [ ] Open the site in a browser and sign in with the seed email and password.
- [ ] Servers → **Connect existing VPS** → the command starts with `https://panel.yourdomain.com/enroll/...`.
- [ ] Open a Terminal on a connected server (this proves WebSockets pass through nginx), and upload a 5 MB file in Files (this proves Step 8).

## 10. Move your existing VPS to the permanent address
On each VPS that was enrolled while the old tunnel or localhost address was in use, as root:

```bash
curl -fsSL https://panel.yourdomain.com/install.sh | sh
```

The agent keeps its key and only changes where it connects. A server that was never enrolled should use **Connect existing VPS** instead.
If you set up a **new** database in Step 6, existing servers are not in it; enroll them again with the Connect command.

## 11. Backups
- [ ] As the Site User: `mkdir -p ~/snbd-backups`.
- [ ] In CloudPanel, site → **Cron Jobs** → add, once a day (for example `15 3 * * *`), with the command:

```
sh -c 'set -a; . ~/snbd.env; set +a; BACKUP_DIR=$HOME/snbd-backups KEEP=14 ~/htdocs/panel.yourdomain.com/scripts/backup-db.sh'
```

  (CloudPanel's own nightly database dumps cover its MySQL databases, not PostgreSQL, so this job is needed.)
- [ ] Run it once by hand with the same command and check a file appears in `~/snbd-backups`.
- [ ] Test a restore on the server: `createdb snbd_restore` (as a role that can), then `DATABASE_URL=postgres://snbd:<password>@127.0.0.1:5432/snbd_restore ./scripts/restore-db.sh <dump>`.
- [ ] Copy the dumps off the server regularly (rclone, rsync, or a storage box). A backup on the same disk does not survive losing the server.
- [ ] Back up `~/.snbd/release-ed25519.pem` on your Mac somewhere safe, separately.

## 12. Updating later
From your Mac:
```bash
pnpm install && pnpm build && ./scripts/build-agent.sh
rsync -a --delete --exclude node_modules --exclude .env --exclude .dev-login --exclude backups --exclude .git ./ panel@<server-ip>:~/htdocs/panel.yourdomain.com/
```
On the server, as the Site User:
```bash
cd ~/htdocs/panel.yourdomain.com && pnpm install --frozen-lockfile && pnpm migrate && pm2 restart snbd
```
Agents already running keep working through a panel restart and reconnect on their own. A new agent version only reaches a VPS when you re-run `install.sh` on it.

## 13. Next
Continue with `docs/STAGING.md` from **Step 4** (first real agent), then Hetzner and WHMCS (Steps 5–8). Use `https://panel.yourdomain.com`
wherever it says the panel address, and put the same webhook secret from `~/snbd.env` into WHMCS.

## Troubleshooting
| Symptom | Check |
|---|---|
| Site shows CloudPanel's 502 | `pm2 status` and `pm2 logs snbd`; the app listens on 3101 and the Add Site form's **App Port** is 3101. |
| App exits at once | The log names the bad setting (for example `PUBLIC_PANEL_URL must be an https:// address`). |
| "Cross-site request refused" on sign-in | `PUBLIC_PANEL_URL` must exactly match the address in the browser (same host, `https`). |
| Terminal or install log never connects | Confirm nginx `Upgrade` lines are still in the vhost (do not replace the whole template). |
| Uploads fail at about 1 MB | Step 8 (`client_max_body_size`) is missing. |
| Everyone shares one rate-limit and one lockout | `TRUST_PROXY` is not set to `127.0.0.1`, so every visitor looks like the proxy. |
| `pnpm migrate` says `.env: not found` | Step 6: `ln -sf ~/snbd.env .env` in the project root. |
| `could not connect to server` from Postgres | `systemctl status postgresql`, and the password in `DATABASE_URL` matches the role. |
| App stays down after a reboot | The `@reboot pm2 resurrect` cron line and `pm2 save` (Step 7). |

## Not confirmed from CloudPanel's docs
- Which Linux user the Node.js site runs as beyond "the Site User you log in with" (the steps use that user throughout).
- CloudPanel's default firewall rules (they are shown only as a picture); Step 3 has you check 80 and 443 yourself.
- That PostgreSQL coexists cleanly with CloudPanel. It should (separate package, separate port), but CloudPanel does not document it.
- Whether the `{{settings}}` section of the vhost adds its own limits; the `client_max_body_size` line in Step 8 is the one to test.
