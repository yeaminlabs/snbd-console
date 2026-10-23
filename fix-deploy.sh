#!/usr/bin/env bash
# SNBD Console – deployment fix / resume script
# Run this DIRECTLY on the VPS as root after a failed deploy.sh run.
# Usage:  bash fix-deploy.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERR]${NC}   $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash fix-deploy.sh"

INSTALL_DIR=/opt/snbd-docker

echo -e "\n${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     SNBD Console – Fix & Resume          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}\n"

# ── 1. detect OS ───────────────────────────────────────────────────────────────
OS_ID=$(. /etc/os-release && echo "$ID")
OS_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
info "OS: ${OS_ID} ${OS_CODENAME}"

# ── 2. install base packages ───────────────────────────────────────────────────
info "Ensuring base packages are installed…"
apt-get update -qq
apt-get install -y ca-certificates curl gnupg lsb-release git dnsutils \
                   nginx certbot python3-certbot-nginx python3 util-linux

# ── 3. install Docker CE (official repo) ───────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Installing Docker CE from official repo…"

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} ${OS_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io \
                     docker-buildx-plugin docker-compose-plugin
  success "Docker CE installed: $(docker --version)"
else
  success "Docker already present: $(docker --version)"
fi

# ensure compose v2 plugin
if ! docker compose version &>/dev/null; then
  apt-get install -y docker-compose-plugin
fi

systemctl enable --now docker
systemctl enable --now nginx

# ── 4. sanity-check install dir ────────────────────────────────────────────────
[[ -d "${INSTALL_DIR}/src" ]] || die "${INSTALL_DIR}/src not found. Run deploy.sh first."
[[ -f "${INSTALL_DIR}/.env"  ]] || die "${INSTALL_DIR}/.env not found. Run deploy.sh first."
[[ -f "${INSTALL_DIR}/compose.yml" ]] || {
  info "Copying compose.yml from source…"
  cp "${INSTALL_DIR}/src/deploy/docker/compose.yml" "${INSTALL_DIR}/compose.yml"
}
[[ -f "${INSTALL_DIR}/backup.sh" ]] || {
  cp "${INSTALL_DIR}/src/deploy/docker/backup.sh" "${INSTALL_DIR}/backup.sh"
  chmod +x "${INSTALL_DIR}/backup.sh"
}

# ── 5. pull latest source ──────────────────────────────────────────────────────
info "Pulling latest source…"
git -C "${INSTALL_DIR}/src" pull --ff-only || warn "git pull failed – using existing source."

# ── 6. read domain from .env ──────────────────────────────────────────────────
DOMAIN=$(grep '^PUBLIC_PANEL_URL=' "${INSTALL_DIR}/.env" | cut -d= -f2- | sed 's|https://||')
[[ -n "$DOMAIN" ]] || die "Could not read domain from ${INSTALL_DIR}/.env"
info "Domain: ${DOMAIN}"

# ── 7. build Docker image ─────────────────────────────────────────────────────
info "Building Docker image (takes a few minutes)…"
DOCKER_BUILDKIT=0 nice -n 19 ionice -c3 \
  docker build \
    --memory 900m --memory-swap 900m --cpu-shares 64 \
    -t snbd-console:latest \
    "${INSTALL_DIR}/src"
success "Docker image built."

# ── 8. start containers ───────────────────────────────────────────────────────
info "Starting containers…"
docker compose -f "${INSTALL_DIR}/compose.yml" \
               --env-file "${INSTALL_DIR}/.env" \
               --project-directory "${INSTALL_DIR}" \
               up -d
success "Containers started."

# wait for API to be healthy
info "Waiting for API to be ready…"
for i in $(seq 1 30); do
  if docker inspect --format='{{.State.Health.Status}}' snbd-console-api 2>/dev/null | grep -q healthy; then
    success "API is healthy."
    break
  fi
  echo "  …attempt ${i}/30"
  sleep 5
done

# ── 9. configure nginx ────────────────────────────────────────────────────────
NGINX_CONF=/etc/nginx/sites-available/snbd-console

if [[ ! -f "$NGINX_CONF" ]]; then
  info "Writing nginx config…"
  cat > "$NGINX_CONF" <<NGINXEOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 210m;
    proxy_read_timeout   900s;
    proxy_send_timeout   900s;

    location ^~ /.well-known/oauth- {
        proxy_pass http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header Host              \$http_host;
        proxy_set_header X-Forwarded-For  \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass         http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection \$connection_upgrade;
        proxy_set_header   Host              \$http_host;
        proxy_set_header   X-Forwarded-For  \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/snbd-console
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t
  systemctl reload nginx
  success "nginx configured."
else
  success "nginx config already present."
  nginx -t && systemctl reload nginx
fi

# ── 10. SSL certificate ────────────────────────────────────────────────────────
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  info "Obtaining SSL certificate for ${DOMAIN}…"
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    -d "$DOMAIN"

  # patch certbot-rewritten config: add ws map + upload limit + oauth route
  python3 - "$NGINX_CONF" "$DOMAIN" <<'PYEOF'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
domain = sys.argv[2]
text = path.read_text()

if 'map $http_upgrade' not in text:
    text = """
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
""" + text

patch = """
    client_max_body_size 210m;
    proxy_read_timeout   900s;
    proxy_send_timeout   900s;

    location ^~ /.well-known/oauth- {
        proxy_pass http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header Host              $http_host;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass         http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host              $http_host;
        proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
"""

text = re.sub(r'\s*location\s*/\s*\{[^}]*\}', '', text)
text = re.sub(r'\s*location\s*\^\~\s*/\.well-known/oauth[^}]*\}', '', text, flags=re.DOTALL)
# inject after the first server_name line in an HTTPS server block
text = re.sub(r'(server_name\s[^;]+;)', r'\1' + patch, text, count=1)
path.write_text(text)
print("nginx config patched.")
PYEOF

  nginx -t && systemctl reload nginx
  success "SSL installed."
else
  success "SSL certificate already exists for ${DOMAIN}."
fi

# ── 11. create admin account ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━  Create admin login (skip if already done)  ━━━━━━━━━━━━━━━${NC}"
read -rp "Admin email (leave blank to skip): " ADMIN_EMAIL
if [[ -n "$ADMIN_EMAIL" ]]; then
  read -rsp "Admin password (min 12 chars): " ADMIN_PASSWORD; echo ""
  read -rp  "Admin name: " ADMIN_NAME
  [[ ${#ADMIN_PASSWORD} -ge 12 ]] || die "Password must be at least 12 characters."
  docker compose -f "${INSTALL_DIR}/compose.yml" \
                 --env-file "${INSTALL_DIR}/.env" \
                 --project-directory "${INSTALL_DIR}" \
    exec -e CLIENT_EMAIL="$ADMIN_EMAIL" \
         -e CLIENT_NAME="$ADMIN_NAME" \
         -e CLIENT_PASSWORD="$ADMIN_PASSWORD" \
    api node_modules/.bin/tsx src/create-client.ts
  success "Admin account created."
fi

# ── 12. backup cron ───────────────────────────────────────────────────────────
CRON_LINE="15 3 * * * ${INSTALL_DIR}/backup.sh >> ${INSTALL_DIR}/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "snbd.*backup"; echo "$CRON_LINE" ) | crontab -
success "Backup cron set."

# ── 13. final status ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  All done!                                                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Panel URL :${NC} https://${DOMAIN}/"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo -e "  ${CYAN}Useful commands:${NC}"
echo -e "    docker logs -f snbd-console-api"
echo -e "    docker compose -f ${INSTALL_DIR}/compose.yml restart api"
