# Staging checklist

Goal: prove the whole chain on real infrastructure before any paying client touches it:
WHMCS order → panel → Hetzner VM → agent → terminal, files, apps, reinstall, alerts, backups.
Work top to bottom. Each step has a **Pass when** line; stop and fix at the first failure.

Use a staging domain (for example `panel-staging.yourdomain.com`), a Hetzner project that exists only for this test, and
a WHMCS product that is hidden from the storefront. Expect to spend a few euros on Hetzner servers; delete them at the end.

## Things never run on real hardware yet (test these first, on purpose)
- **The amd64 agent.** Everything so far ran the arm64 build. A Hetzner `cx22` is amd64, so Step 4 is its first real run.
- Hetzner **rebuild with `user_data`**, the OS image names (`alma-9`, `rocky-9`, `fedora-41`), and server type names.
- The WHMCS module inside a real WHMCS (the "Open panel" button especially).
- systemd units, Caddy with a real certificate, a real Slack/Discord webhook.
- Hermes, OpenClaw, Docker, n8n and Ollama installs. Only Node.js and Claude Code were run for real.

---

## 0. Before you start
- [ ] A Linux server for the panel (Ubuntu 24.04, 1 vCPU / 2 GB is enough) with a public IPv4 and a DNS **A record** for the staging domain pointing at it.
- [ ] Firewall: allow 22, 80, 443 only. Port 3101 must not be reachable from outside.
- [ ] A Hetzner Cloud **throwaway project** and a read/write API token for it.
- [ ] A WHMCS you can break (a test install, or your live one with a hidden product and a test client).
- [ ] A Slack, Discord or Mattermost incoming-webhook URL for alerts.
- [ ] One non-critical existing VPS you are happy to experiment on (for Step 8).

## 1. Build on your machine
- [ ] `pnpm install && pnpm build`
- [ ] `node scripts/release.mjs keygen` (once; **back up `~/.snbd/release-ed25519.pem` now**, in a password manager, not in git).
- [ ] `./scripts/build-agent.sh` → `dist/releases/` with amd64 + arm64 binaries, `SHA256SUMS`, `.sig`, `release.pub`.
- [ ] Copy the repo and `dist/releases/` to the server at `/opt/snbd` (`rsync -a --exclude node_modules --exclude .env`).

**Pass when:** `dist/releases/` lists both binaries and `openssl pkeyutl -verify -pubin -inkey release.pub -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig` prints "Signature Verified Successfully".

## 2. Deploy the panel
On the server:
- [ ] Install Node 22+, pnpm **system-wide** (`npm i -g pnpm`; the unit uses `ProtectHome=true`, so pnpm must not live in a home directory), PostgreSQL, Caddy.
- [ ] Create the service user and give it the code: `useradd -r -s /usr/sbin/nologin snbd && chown -R snbd /opt/snbd`.
- [ ] Create the database and role: `createuser snbd && createdb -O snbd snbd_console`.
- [ ] Copy `deploy/env.production.example` to `/etc/snbd-console.env` and fill in: `PUBLIC_PANEL_URL=https://<staging domain>`, a new `WHMCS_WEBHOOK_SECRET` (`openssl rand -hex 32`), `HETZNER_API_TOKEN`, `ALERT_WEBHOOK_URL`. Set `chown root:snbd` and `chmod 640`.
- [ ] `ln -s /etc/snbd-console.env /opt/snbd/.env` (the migrate script reads `/opt/snbd/.env`).
- [ ] `cd /opt/snbd && pnpm install --frozen-lockfile && pnpm migrate`
- [ ] Put `deploy/snbd-api.service` in `/etc/systemd/system/`, `systemctl enable --now snbd-api`.
- [ ] Put the domain into `deploy/Caddyfile`, copy it to `/etc/caddy/Caddyfile`, `systemctl reload caddy`.
- [ ] **Do not run `pnpm seed` blindly.** It creates a client with a published demo password. For your first login run it with your own values: `SEED_EMAIL=you@yourdomain.com SEED_PASSWORD='<long random>' pnpm seed`, and treat that account as a staging-only test client.

**Pass when:**
- [ ] `journalctl -u snbd-api -n 50` shows it listening with no errors (if it exits at once, the message says which production setting is wrong).
- [ ] `https://<domain>/` loads the sign-in page over a valid certificate, and you can sign in.
- [ ] `curl -I https://<domain>/` shows `strict-transport-security` and `content-security-policy`.
- [ ] `curl http://<server-ip>:3101/` from your laptop **fails** (port closed).
- [ ] `curl https://<domain>/dl/VERSION` prints the agent version.

If the service fails with a permission error, the hardening options in the unit (`ProtectHome`, `ProtectSystem=strict`) are the first suspects; loosen one at a time and note which.

## 3. Backups and alerts (do these early, they are cheap)
- [ ] `mkdir -p /var/backups/snbd && chown snbd /var/backups/snbd`, install `snbd-backup.service` and `.timer`, `systemctl enable --now snbd-backup.timer`, then `systemctl start snbd-backup`.
- [ ] Restore it into a scratch database: `createdb snbd_restore && DATABASE_URL=postgres:///snbd_restore /opt/snbd/scripts/restore-db.sh /var/backups/snbd/<file>.dump`, compare `select count(*) from clients`, then `dropdb snbd_restore`.
- [ ] Decide where dumps are copied off the machine (rclone, rsync, Hetzner Storage Box) and set that up.

**Pass when:** a dump exists with mode 600 and the restore matches. Alerts are checked in Step 8.

## 4. First real agent: a throwaway amd64 VPS (not WHMCS yet)
This isolates the agent and installer from WHMCS and Hetzner provisioning.
- [ ] Create any small Ubuntu 24.04 amd64 VPS by hand (Hetzner console is fine).
- [ ] In the panel: Servers → **Connect existing VPS** → name it → copy the command → run it as root on the VPS.
- [ ] Open the server in the panel.

**Pass when:**
- [ ] The installer ends with "Done. This server is now connected to your panel." and says nothing about a skipped signature check (Ubuntu 24.04 has OpenSSL 3).
- [ ] The server shows **Running**, the agent card says Connected, CPU and RAM numbers appear within a minute.
- [ ] Terminal opens a root shell; resizing the browser window resizes the shell.
- [ ] Files: browse `/etc`, create a folder, upload a 5 MB file, download it, edit and save a small text file.
- [ ] Apps: install **Node.js 22**, then **Claude Code**. Logs stream and both end as Installed.
- [ ] Overview → **Reset password** shows a password once; `ssh root@<ip>` with it works if SSH password login is enabled (it may not be; `getent shadow root` changing is also proof).
- [ ] `/etc/snbd/agent.env` has **no** `ENROLL_TOKEN` line; running the same command again says the token is already used.
- [ ] Activity page lists everything you just did.
- [ ] `systemctl restart snbd-api` on the panel: the VPS reconnects by itself within about a minute.

Then install the heavier apps one at a time and note failures: **Docker**, **n8n** (check `curl 127.0.0.1:5678/healthz` on the VPS), **Ollama**, **Hermes**, **OpenClaw**. Fix recipes in `scripts/apps/` as needed; they were written from official docs and never run.

## 5. Hetzner: check names before spending money
- [ ] `HETZNER_API_TOKEN=<token> pnpm hetzner:check cx22 cx32` from the repo.
- [ ] Fix any `MISSING` line: image names live in `apps/api/src/os.ts` and `scripts/hetzner-check.mjs`; use the server type names your project actually lists.

**Pass when:** every image you want to offer and both server types print `ok`.

## 6. WHMCS: module and test product
- [ ] Copy `whmcs-module/snbdpanel/` to `<whmcs>/modules/servers/snbdpanel/`.
- [ ] Setup → Servers → Add: **Hostname** = the staging domain (no `https://`), tick **Secure**, **Access Hash** = the `WHMCS_WEBHOOK_SECRET` value. Press **Test Connection**; it must report success.
- [ ] Turn on **Utilities → Logs → Module Log** so every call to the panel is recorded.
- [ ] Create a hidden product, module **SNBD Panel**, options: provider `hetzner`, vCPU/RAM/disk (informational), region `hel1` (or your choice), OS `ubuntu-24.04`, **Hetzner server type `cx22`**. Add an optional configurable option named `os`.
- [ ] Create a test client and place an order for it; accept it (or use admin "Create" on the service).

**Pass when (in order):**
- [ ] WHMCS shows the service **Active** and the module log shows `create` with a 200.
- [ ] The service has **Service Username** = the client's email and a generated **Service Password**, and the welcome email can include both.
- [ ] The panel's Servers list shows the new server as *Provisioning* with an IP.
- [ ] A VM exists in the Hetzner project with the label `snbd_server_id`.
- [ ] Within ~2 minutes the server flips to **Running** with no manual step (this proves the cloud-init user-data works on a real Hetzner image).
- [ ] Press the admin **Create** button on the service again: no second VM appears.

## 7. WHMCS lifecycle and the client login
- [ ] The client area shows the panel **email and password**. Copy them, open the panel in a private window and sign in with them. **Pass:** you land as that client, seeing only their server.
- [ ] Press **Reset panel password**. **Pass:** the old password stops working, all panel sessions are signed out, and the new password is shown and saved on the service.
- [ ] In the client area of the test client, press **Open panel**. **Pass:** you land in the panel signed in as that client, seeing only their server. If the button is missing or errors, check `snbdpanel_ClientArea`, `snbdpanel_ClientAreaAllowedFunctions` and the template against your WHMCS version and fix the module.
- [ ] In the WHMCS admin service page, follow **Log in to SNBD Panel as this client**. **Pass:** the same, without typing credentials.
- [ ] The same link used twice fails (single use, 60 seconds).
- [ ] Admin **Suspend**: Hetzner server powers off, the panel shows *Suspended*, terminals are refused. **Unsuspend**: it powers on and returns to Running.
- [ ] Panel **Power → Reboot**, then **Shut down**, then **Start**: Hetzner reflects each; status settles to Running within about 10 seconds of the agent returning.
- [ ] **Reinstall OS** to Debian 12. **Pass when:** it comes back Running by itself with the new OS (`cat /etc/os-release` in the terminal), the old agent key is gone and the new one works. If Hetzner rejects the rebuild or ignores `user_data` the server will sit in *Provisioning*: check `journalctl -u snbd-api` and the Hetzner action log, then tell me what it said.
- [ ] Admin **Change package** to `cx32`: server powers off, resizes, powers on; disk size is unchanged (by design).
- [ ] Admin **Terminate**: the VM disappears from Hetzner, the server disappears from the client's list, and the old agent can no longer connect.

## 8. Alerts, rotation, limits (on the Step 4 VPS)
- [ ] `systemctl stop snbd-agent` on the VPS. **Pass when:** after ~2 minutes your Slack/Discord channel gets one "unreachable" message and no repeats. Start the agent: one "back online" message arrives.
- [ ] `pnpm rotate-keys` on the panel. **Pass when:** the Activity page shows *Agent key rotation started* then *Agent key rotated*, and the VPS stays connected afterwards.
- [ ] Try 6 wrong sign-ins for one email: the 6th says to try again in 15 minutes.
- [ ] Pull the VPS's network cable equivalent (`iptables -A OUTPUT -d <panel ip> -j DROP`, wait about a minute, then remove the rule): the server shows *Agent offline* and then recovers by itself.

## 9. First real client VPS (low risk first)
- [ ] Pick one **BDIX** or imported server whose owner agrees, outside business-critical hours.
- [ ] Check the distro: `cat /etc/os-release`. CentOS 7 and other very old systems are unsupported (and `openssl version` below 3 means the signature check is skipped with a warning).
- [ ] Run the Connect command. Confirm Running, terminal, files. Do **not** reinstall or power-control BDIX servers: those return "not available" until the BDIX adapter exists.
- [ ] Tell the owner the agent runs as **root** and that the terminal gives full root access, and agree that is acceptable in your terms of service.

## 10. Exit criteria
Go live for a small group only if all of these are true:
- [ ] Steps 4 and 6–8 passed on real infrastructure with no manual database edits.
- [ ] A backup restored successfully and dumps are copied off the machine.
- [ ] You received at least one real offline alert.
- [ ] `~/.snbd/release-ed25519.pem` is backed up.
- [ ] You know who gets the alerts and what they do when one arrives.

## Known gaps to decide on before opening to everyone
- **No staff/admin screen.** Client logins are created by WHMCS orders (email + generated password, saved on the service); support work is still done in WHMCS or the database.
- **Hetzner root password is discarded at creation.** A new server has no known password until the client uses **Reset password** in the panel (works once the agent is connected). Consider telling clients this in the welcome email.
- **BDIX:** no hypervisor adapter; create/power/reinstall are stubs until you choose one (Proxmox is the likely path).
- **CloudPanel and CyberPanel** one-click installs are not included.
- **Login lockout is in memory** and resets when the API restarts.
- Agents older than 0.4.0 do not rotate keys or detect dead links; re-run the installer on them to upgrade.
