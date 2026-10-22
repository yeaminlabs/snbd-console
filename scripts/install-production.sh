#!/usr/bin/env bash
# SNBD Console: one-shot production installer / updater for a CloudPanel (or any Debian/Ubuntu) server.
#
#   1. Upload the project to the server (including dist/releases built on your Mac), for example:
#        rsync -a --exclude node_modules --exclude .env --exclude .git ./ root@SERVER:/root/snbd-src/
#   2. On the server, as root:
#        cd /root/snbd-src && ./scripts/install-production.sh --domain panel.example.com --email you@example.com
#   3. In CloudPanel add a Node.js site for the domain with App Port 3101 (the script prints the exact steps).
#
# It installs PostgreSQL (if missing) and a PRIVATE Node 22 in /opt/snbd-node (the system Node is never changed), runs the panel
# as the `snbd` user under systemd on 127.0.0.1:3101, creates the
# database, secrets and first login, installs a daily backup timer, and checks that the panel answers.
# Safe to run again: it updates the code, applies migrations and restarts, and keeps existing secrets and data.
# It does not touch nginx, the firewall or CloudPanel.
set -Eeuo pipefail

APP_DIR=/opt/snbd
NODE_HOME=/opt/snbd-node
ENV_FILE=/etc/snbd-console.env
BACKUP_DIR=/var/backups/snbd
SVC_USER=snbd
PORT=3101
DOMAIN="" ; EMAIL="" ; NAME="Admin" ; PASSWORD="" ; HETZNER_TOKEN="" ; ALERT_URL="" ; SKIP_RELEASES=0 ; DRY_RUN=0 ; ASSUME_YES=0

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_bold=$'\033[1m'; c_off=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$c_bold" "$*" "$c_off"; }
ok()   { printf '%s ok%s  %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%swarn%s  %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%serror%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
trap 'die "failed at line $LINENO (command: $BASH_COMMAND)"' ERR

usage() { cat <<'EOF'
Usage: install-production.sh --domain panel.example.com [options]

  --domain D           public address of the panel, without https:// (required)
  --email E            create this login (needs --password or one is generated)
  --name N             display name for that login (default: Admin)
  --password P         password for that login, at least 12 characters (default: random, shown once)
  --hetzner-token T    Hetzner Cloud API token (optional, can be added later in /etc/snbd-console.env)
  --alert-webhook U    Slack/Discord/Mattermost webhook for offline alerts (optional)
  --port N             local port the panel listens on (default 3101)
  --dry-run            run the checks and show what would change, then stop (changes nothing)
  --yes                do not ask for confirmation
  --skip-releases      do not require dist/releases (agent downloads will not work until you add them)
  -h, --help           this text
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --password) PASSWORD="${2:-}"; shift 2 ;;
    --hetzner-token) HETZNER_TOKEN="${2:-}"; shift 2 ;;
    --alert-webhook) ALERT_URL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --skip-releases) SKIP_RELEASES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

# a clean PATH: root's nvm or other per-user Node installs must never leak in (systemd and the service user cannot see them)
export PATH="$NODE_HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# ---------------------------------------------------------------- preflight
step "Checking the server"
[ "$(id -u)" = 0 ] || die "run as root (sudo -i, then run this again)"
command -v apt-get >/dev/null || die "this script supports Debian and Ubuntu (apt) only"
[ -d /run/systemd/system ] || die "systemd is required"
[ -n "$DOMAIN" ] || { usage; die "--domain is required"; }
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%/}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* ]] || die "bad domain: $DOMAIN"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "bad port: $PORT"
if [ -n "$PASSWORD" ] && [ "${#PASSWORD}" -lt 12 ]; then die "--password must be at least 12 characters"; fi
if [ -n "$PASSWORD" ] && [ -z "$EMAIL" ]; then die "--password needs --email"; fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC/package.json" ] && grep -q '"name": "snbd-console"' "$SRC/package.json" || die "run this from inside the uploaded project (package.json not found in $SRC)"
if [ "$SKIP_RELEASES" = 0 ]; then
  [ -f "$SRC/dist/releases/SHA256SUMS.sig" ] || die "dist/releases is missing. On your Mac run ./scripts/build-agent.sh and upload dist/ too (or pass --skip-releases)."
fi
ok "project at $SRC"

if ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
  warn "$DOMAIN does not resolve yet. Create the DNS A record before issuing the certificate in CloudPanel."
fi
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${PORT}$" && ! systemctl is-active --quiet snbd-api; then
  die "port $PORT is already in use by something else (use --port)"
fi


step "What this will change on this server"
if [ -x "$NODE_HOME/bin/node" ] && [ "$("$NODE_HOME/bin/node" -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then NODE_PLAN="keep the private Node.js in $NODE_HOME"; else NODE_PLAN="download Node.js 22 from nodejs.org into $NODE_HOME (checked against its published SHA-256); the system Node ($(env -i PATH=/usr/local/bin:/usr/bin:/bin node --version 2>/dev/null || echo none)) is NOT changed"; fi
cat <<PLAN
  - apt: install postgresql, rsync, curl, openssl, iproute2 if missing (existing PostgreSQL and its databases are kept)
  - $NODE_PLAN
  - create system user '$SVC_USER', copy the project to $APP_DIR
  - PostgreSQL: create role 'snbd' and database 'snbd_console' (no other database is touched)
  - write $ENV_FILE (secrets), create tables, create the login${EMAIL:+ for $EMAIL}
  - systemd: snbd-api (127.0.0.1:$PORT), snbd-backup timer; backups in $BACKUP_DIR
  - NOT touched: nginx, CloudPanel, the firewall, other sites, other databases
PLAN
if [ "$DRY_RUN" = 1 ]; then ok "dry run: nothing was changed"; exit 0; fi
if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || die "not a terminal: re-run with --yes to confirm (or --dry-run to preview)"
  read -r -p "Continue? [y/N] " ANSWER; case "$ANSWER" in y|Y|yes|YES) ;; *) die "cancelled" ;; esac
fi

# ---------------------------------------------------------------- packages
step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-client rsync curl ca-certificates openssl iproute2 >/dev/null
systemctl enable --now postgresql >/dev/null 2>&1 || true
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done
pg_isready -q || die "PostgreSQL did not start (journalctl -u postgresql)"
ok "PostgreSQL $(psql --version | awk '{print $3}')"

step "Private Node.js 22 in $NODE_HOME"
node_major() { [ -x "$NODE_HOME/bin/node" ] && "$NODE_HOME/bin/node" -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt 22 ]; then
  case "$(uname -m)" in x86_64|amd64) NARCH=x64 ;; aarch64|arm64) NARCH=arm64 ;; *) die "unsupported CPU: $(uname -m)" ;; esac
  NTMP="$(mktemp -d)"; trap 'rm -rf "$NTMP"' EXIT
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" -o "$NTMP/SHASUMS256.txt"
  NLINE="$(grep " node-v22\.[0-9.]*-linux-${NARCH}\.tar\.gz\$" "$NTMP/SHASUMS256.txt" | head -n1)"
  [ -n "$NLINE" ] || die "could not find a Node.js 22 build for linux-$NARCH on nodejs.org"
  NFILE="${NLINE##* }"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NFILE" -o "$NTMP/$NFILE"
  ( cd "$NTMP" && grep " $NFILE\$" SHASUMS256.txt | sha256sum -c - >/dev/null ) || die "Node.js download failed its SHA-256 check; refusing to install it"
  rm -rf "$NODE_HOME.new" && mkdir -p "$NODE_HOME.new"
  tar -xzf "$NTMP/$NFILE" -C "$NODE_HOME.new" --strip-components=1
  rm -rf "$NODE_HOME" && mv "$NODE_HOME.new" "$NODE_HOME"
fi
[ "$(node_major)" -ge 22 ] || die "private Node.js 22 is not usable"
[ -x "$NODE_HOME/bin/pnpm" ] || "$NODE_HOME/bin/npm" install -g pnpm >/dev/null 2>&1
[ -x "$NODE_HOME/bin/pnpm" ] || die "pnpm did not install"
ok "Node $("$NODE_HOME/bin/node" --version) and pnpm $("$NODE_HOME/bin/pnpm" --version) in $NODE_HOME (system Node untouched)"

# ---------------------------------------------------------------- user and code
step "Putting the code in $APP_DIR"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR"
if [ "$(realpath "$SRC")" != "$(realpath "$APP_DIR")" ]; then
  rsync -a --delete \
    --exclude node_modules --exclude .env --exclude .git --exclude backups --exclude .dev-login \
    --exclude '._*' --exclude .DS_Store \
    --exclude 'dist/test' --exclude 'dist/dev-userdata' --exclude 'agent/.snbd' --exclude 'agent/snbd-agent' \
    "$SRC"/ "$APP_DIR"/
fi
chown -R "$SVC_USER":"$SVC_USER" "$APP_DIR"
ok "code synced"

# ---------------------------------------------------------------- env file and database
step "Database and settings"
kv_get() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n1; }
kv_set() {  # kv_set KEY VALUE: replace or append, without sed-escaping problems
  local k="$1" v="$2" tmp; tmp="$(mktemp)"
  { grep -v "^$k=" "$ENV_FILE" 2>/dev/null || true; printf '%s=%s\n' "$k" "$v"; } > "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
FIRST_RUN=0
if [ ! -f "$ENV_FILE" ]; then FIRST_RUN=1; : > "$ENV_FILE"; fi
chmod 640 "$ENV_FILE"; chown root:"$SVC_USER" "$ENV_FILE"

DB_PASS="$(kv_get DATABASE_URL | sed -n 's#^postgres://snbd:\([^@]*\)@.*#\1#p')"
[ -n "$DB_PASS" ] || DB_PASS="$(openssl rand -hex 24)"
if runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname='snbd'" | grep -q 1; then
  runuser -u postgres -- psql -qc "alter role snbd with password '$DB_PASS'"
else
  runuser -u postgres -- psql -qc "create role snbd login password '$DB_PASS'"
fi
runuser -u postgres -- psql -tAc "select 1 from pg_database where datname='snbd_console'" | grep -q 1 || runuser -u postgres -- createdb -O snbd snbd_console

kv_set NODE_ENV production
kv_set HOST 127.0.0.1
kv_set PORT "$PORT"
kv_set TRUST_PROXY 127.0.0.1
kv_set DATABASE_URL "postgres://snbd:${DB_PASS}@127.0.0.1:5432/snbd_console"
kv_set PUBLIC_PANEL_URL "https://${DOMAIN}"
[ -n "$(kv_get WHMCS_WEBHOOK_SECRET)" ] || kv_set WHMCS_WEBHOOK_SECRET "$(openssl rand -hex 32)"
[ -z "$HETZNER_TOKEN" ] || kv_set HETZNER_API_TOKEN "$HETZNER_TOKEN"
[ -z "$ALERT_URL" ] || kv_set ALERT_WEBHOOK_URL "$ALERT_URL"
[ -n "$(kv_get HETZNER_API_TOKEN)" ] || kv_set HETZNER_API_TOKEN ""
[ -n "$(kv_get ALERT_WEBHOOK_URL)" ] || kv_set ALERT_WEBHOOK_URL ""
ln -sfn "$ENV_FILE" "$APP_DIR/.env"   # the migrate and create-client scripts read ./.env
ok "settings in $ENV_FILE (mode 640, readable by root and $SVC_USER only)"

# ---------------------------------------------------------------- build, migrate, first login
step "Installing dependencies and building the web app"
as_svc() { runuser -u "$SVC_USER" -- env HOME="$APP_DIR" PATH="$PATH" "$@"; }  # PATH starts with $NODE_HOME/bin
( cd "$APP_DIR" && as_svc pnpm install --frozen-lockfile >/dev/null && as_svc pnpm build >/dev/null )
ok "built"

step "Database tables"
if ! MIG_OUT="$(cd "$APP_DIR" && as_svc pnpm migrate 2>&1)"; then
  printf '%s\n' "$MIG_OUT" | tail -n 20
  die "database migration failed (output above); nothing was started"
fi
printf '%s\n' "$MIG_OUT" | grep '^applied' | sed 's/^/    /' || true
ok "migrations up to date"

FIRST_LOGIN_NOTE=""
if [ -n "$EMAIL" ]; then
  step "First login"
  GENERATED=0
  if [ -z "$PASSWORD" ]; then PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"; GENERATED=1; fi
  if ! FULL="$(cd "$APP_DIR" && as_svc env CLIENT_EMAIL="$EMAIL" CLIENT_NAME="$NAME" CLIENT_PASSWORD="$PASSWORD" pnpm create-client 2>&1)"; then
    printf '%s\n' "$FULL" | tail -n 10
    die "could not create the first login (output above)"
  fi
  OUT="$(printf '%s\n' "$FULL" | tail -n1)"
  echo "    $OUT"
  case "$OUT" in
    *"created"*)
      if [ "$GENERATED" = 1 ]; then
        umask 077; printf 'email: %s\npassword: %s\n' "$EMAIL" "$PASSWORD" > /root/snbd-first-login.txt
        FIRST_LOGIN_NOTE="Sign in with $EMAIL and the password saved in /root/snbd-first-login.txt (delete that file after you store it)."
      else
        FIRST_LOGIN_NOTE="Sign in with $EMAIL and the password you gave."
      fi ;;
    *"already exists"*) FIRST_LOGIN_NOTE="$EMAIL already existed; its password was not changed." ;;
  esac
fi

# ---------------------------------------------------------------- services
step "Services (systemd)"
install -m 0644 "$APP_DIR/deploy/snbd-api.service" /etc/systemd/system/snbd-api.service
install -m 0644 "$APP_DIR/deploy/snbd-backup.service" /etc/systemd/system/snbd-backup.service
install -m 0644 "$APP_DIR/deploy/snbd-backup.timer" /etc/systemd/system/snbd-backup.timer
mkdir -p "$BACKUP_DIR" && chown "$SVC_USER":"$SVC_USER" "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
systemctl daemon-reload
systemctl enable snbd-api snbd-backup.timer >/dev/null 2>&1
systemctl restart snbd-api
systemctl start snbd-backup.timer

printf '    waiting for the panel to answer'
UP=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/dl/VERSION" 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/me" 2>/dev/null | grep -q 401; then UP=1; break; fi
  printf '.'; sleep 1
done
echo
if [ "$UP" != 1 ]; then
  journalctl -u snbd-api -n 40 --no-pager || true
  die "the panel did not start; the log above says why"
fi
ok "panel is running on 127.0.0.1:${PORT}"

step "Running a backup now to prove it works"
if systemctl start snbd-backup && ls "$BACKUP_DIR"/snbd-*.dump >/dev/null 2>&1; then ok "backup written to $BACKUP_DIR (daily at about 03:15)"; else warn "backup failed: journalctl -u snbd-backup"; fi

# ---------------------------------------------------------------- self-checks
step "Self-checks"
HDRS="$(curl -sI "http://127.0.0.1:${PORT}/" || true)"
echo "$HDRS" | grep -qi '^content-security-policy' && ok "web app is served with security headers" || warn "web app did not answer with headers (is apps/web/dist built?)"
ss -ltn | awk '{print $4}' | grep -E ":${PORT}$" | grep -q '^127\.0\.0\.1:' && ok "panel listens on localhost only" || warn "panel is not bound to 127.0.0.1 only"
ss -ltn | awk '{print $4}' | grep -E ':5432$' | grep -vqE '^(127\.0\.0\.1|\[::1\]):' && warn "PostgreSQL is listening on a public address; check listen_addresses" || ok "PostgreSQL is not exposed publicly"

# ---------------------------------------------------------------- what to do next
step "Done. Now finish in CloudPanel"
cat <<EOF

  1. Sites -> Add Site -> Create a Node.js Site
       Domain Name: ${DOMAIN}     Node.js Version: 22     App Port: ${PORT}
     (CloudPanel only proxies to the port; the panel is already running here under systemd.
      Do not start anything under PM2 for this site.)
  2. Open the site -> SSL/TLS -> Actions -> New Let's Encrypt Certificate -> Create and Install.
  3. Open the site -> Vhost. Inside server { ... }, above "location / {", add:
         client_max_body_size 210m;
     and Save (without it file uploads fail at 1 MB).
  4. Firewall (CloudPanel -> Admin Area -> Security): keep 80 and 443 open; never open ${PORT} or 5432.
  5. Check:   curl -I https://${DOMAIN}/        (should answer 200 with security headers)

  WHMCS secret (Access Hash in the WHMCS server entry):
         grep WHMCS_WEBHOOK_SECRET ${ENV_FILE}
EOF
[ -z "$FIRST_LOGIN_NOTE" ] || printf '\n  %s\n' "$FIRST_LOGIN_NOTE"
[ -n "$EMAIL" ] || printf '\n  No login was created. Make one with:\n    cd %s && CLIENT_EMAIL=you@example.com CLIENT_PASSWORD="a-long-password" pnpm create-client\n' "$APP_DIR"
cat <<EOF

  Useful:   journalctl -u snbd-api -f          logs
            systemctl restart snbd-api         restart
            run this script again              update to a newly uploaded version
            VPS already enrolled elsewhere?    on each, as root:  curl -fsSL https://${DOMAIN}/install.sh | sh

EOF
