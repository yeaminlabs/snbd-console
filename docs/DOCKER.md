# Run SNBD Console in Docker (with CloudPanel in front)

Two containers, `snbd-console-api` (the panel and web app) and `snbd-console-db` (its own PostgreSQL), run from one folder,
`/opt/snbd-docker`. The panel is published on **`127.0.0.1:3199` only** (`PANEL_PORT` in `.env`); CloudPanel's nginx proxies your domain to it. Nothing else on the
server is touched: no other site, container, database, nginx file or firewall rule.

## What is where (on the server)
```
/opt/snbd-docker/
  compose.yml      the two containers (project name "snbd-console")
  .env             secrets, mode 600: DB password, WHMCS webhook secret, panel URL
  releases/        signed agent files served to your VPS (read-only inside the container)
  src/             the project source the image was built from
  backup.sh        database dump into ./backups (newest 14 kept)
```
Docker objects it created: image `snbd-console:latest`, network `snbd-console-net`, volume `snbd-console-pgdata`.
Memory: about 75 MB (panel) + 45 MB (database) at rest, hard limits 512 MB and 384 MB.

## Add the site in CloudPanel (console.deltadns.xyz)
The DNS record must already point at the server (`dig +short console.deltadns.xyz` shows `5.75.180.184`).

1. **Sites → Add Site → Create a Node.js Site**
   - Domain Name: `console.deltadns.xyz`
   - Node.js Version: any (22 is fine; it is not used)
   - **App Port: `3199`**. CloudPanel refuses a port that is already in use, so create the site while 3199 is still free, then make the container use it:
     set `PANEL_PORT=3199` in `/opt/snbd-docker/.env` and run `docker compose up -d` there (restarts only the panel container; the first start uses 3101).
   - Create. CloudPanel makes a Site User for it; you never need to log in as that user.
   - **Do not start anything under PM2 and do not upload files to this site.** The panel is already running in Docker; CloudPanel only proxies to the panel's port.
2. **Certificate:** open the new site → **SSL/TLS** → Actions → **New Let's Encrypt Certificate** → Create and Install.
3. **Upload size:** open the site → **Vhost**. Inside `server { ... }`, above `location / {`, add this line and Save:
   ```nginx
     client_max_body_size 210m;
   ```
   Without it, file uploads above 1 MB fail. (CloudPanel's template already passes WebSockets and allows 900-second connections, which the terminal needs.)
   **For the Claude app connector (OAuth),** also add this block in the same place. CloudPanel's template has its own `location ~ /.well-known` rule that
   answers 404 for everything under `/.well-known/`, which hides the panel's sign-in discovery address. This more specific block takes priority only for
   `/.well-known/oauth-...`; certificate renewal paths (`/.well-known/acme-challenge`) are not affected:
   ```nginx
     location ^~ /.well-known/oauth- {
       proxy_pass http://127.0.0.1:3199;
       proxy_http_version 1.1;
       proxy_set_header Host $http_host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   ```
   Check: `curl -s https://console.deltadns.xyz/.well-known/oauth-authorization-server` prints JSON (not a 404 page).
4. **Check** from any computer: `https://console.deltadns.xyz/` shows the sign-in page, and `curl -I https://console.deltadns.xyz/` answers 200.
5. **Firewall:** keep 80 and 443 open. Never open the panel port (it is bound to localhost anyway).

## Create your login (nothing exists until you do this)
```bash
ssh root@5.75.180.184
cd /opt/snbd-docker
docker compose exec -e CLIENT_EMAIL='you@example.com' -e CLIENT_NAME='Your Name' -e CLIENT_PASSWORD='a-long-password-12+' api node_modules/.bin/tsx src/create-client.ts
```
Sign in at `https://console.deltadns.xyz/`. Use `RESET=1` (add `-e RESET=1`) to change the password of an existing login.

## WHMCS and other settings
- WHMCS secret (the "Access Hash" in the WHMCS server entry): `grep WHMCS_WEBHOOK_SECRET /opt/snbd-docker/.env`.
- Hetzner token and the alert webhook go in the same `.env`. After editing: `cd /opt/snbd-docker && docker compose up -d` (it recreates the panel only).
- Logs: `docker logs -f snbd-console-api`. Restart: `docker compose restart api`. Stop everything: `docker compose down` (data stays in the volume).

## Backups
`/opt/snbd-docker/backup.sh` writes `backups/snbd-<time>.sql.gz`. To run it daily, add a line to root's crontab (`crontab -e`) yourself:
```
15 3 * * * /opt/snbd-docker/backup.sh >> /opt/snbd-docker/backups/backup.log 2>&1
```
Restore into the running database: `gunzip -c backups/<file>.sql.gz | docker exec -i snbd-console-db psql -U snbd -d snbd_console` (restore into an empty database).
Copy the dumps off the server, and keep `~/.snbd/release-ed25519.pem` (the agent signing key) backed up on your Mac.

## Updating
On your Mac: `pnpm install && ./scripts/build-agent.sh`, then upload the new source and releases to the same folders (as before, into `/opt/snbd-docker/src` and
`/opt/snbd-docker/releases`). On the server:
```bash
cd /opt/snbd-docker/src
DOCKER_BUILDKIT=0 nice -n 19 ionice -c3 docker build --memory 900m --memory-swap 900m --cpu-shares 64 -t snbd-console:latest .
cd .. && docker compose up -d
```
The limits keep the build from starving the other sites. New database tables are applied automatically when the panel container starts.
Servers already connected keep their link through a panel restart, and a new agent version reaches a VPS only when you re-run its `install.sh` line.

## Undo everything
`cd /opt/snbd-docker && docker compose down -v && cd / && rm -rf /opt/snbd-docker && docker rmi snbd-console:latest`
(`-v` also deletes the database volume; leave it out to keep the data.) Then delete the CloudPanel site.
