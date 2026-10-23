#!/usr/bin/env bash
# SNBD Console – one-shot VPS deployment
# Tested on Ubuntu 22.04 / 24.04, Debian 12 / 13.
# Run as root:  bash deploy.sh

set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERR]${NC}   $*" >&2; exit 1; }

# ── root check ─────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Please run as root:  sudo bash deploy.sh"

INSTALL_DIR=/opt/snbd-docker
REPO_URL="https://github.com/yeaminlabs/snbd-console.git"

# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       SNBD Console – Deployment          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}\n"

# ── 1. collect domain ──────────────────────────────────────────────────────────
read -rp "$(echo -e "${BOLD}Enter your domain name${NC} (e.g. panel.example.com): ")" DOMAIN
[[ -n "$DOMAIN" ]] || die "Domain cannot be empty."

# ── 2. detect public IP ────────────────────────────────────────────────────────
SERVER_IP=$(curl -4 -fsSL https://ifconfig.me 2>/dev/null || curl -4 -fsSL https://icanhazip.com 2>/dev/null || true)
[[ -n "$SERVER_IP" ]] || die "Could not detect server public IP. Check your internet connection."

# ── 3. DNS instructions ────────────────────────────────────────────────────────
echo -e "\n${BOLD}━━━  DNS Setup Required  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Add the following ${BOLD}A record${NC} in your DNS provider:\n"
echo -e "    ${CYAN}Type :${NC} A"
echo -e "    ${CYAN}Name :${NC} ${DOMAIN}"
echo -e "    ${CYAN}Value:${NC} ${SERVER_IP}"
echo -e "    ${CYAN}TTL  :${NC} 300 (or lowest available)\n"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

read -rp "Press ENTER once the A record is saved (DNS can take a few minutes to propagate)…"

# ── 4. wait for DNS propagation ────────────────────────────────────────────────
info "Checking DNS propagation for ${DOMAIN} → ${SERVER_IP} …"
MAX_ATTEMPTS=30
ATTEMPT=0
while true; do
  RESOLVED=$(dig +short "$DOMAIN" @1.1.1.1 2>/dev/null | tail -1 || true)
  if [[ "$RESOLVED" == "$SERVER_IP" ]]; then
    success "DNS resolved: ${DOMAIN} → ${RESOLVED}"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  if [[ $ATTEMPT -ge $MAX_ATTEMPTS ]]; then
    warn "DNS still not resolving after $((MAX_ATTEMPTS * 10))s (resolved: '${RESOLVED:-nothing}')."
    warn "Continuing anyway — Let's Encrypt will fail if DNS is not pointing here yet."
    break
  fi
  echo -e "  …waiting (${ATTEMPT}/${MAX_ATTEMPTS}) – resolved '${RESOLVED:-nothing}', expected '${SERVER_IP}'"
  sleep 10
done

# ── 5. optional extras ─────────────────────────────────────────────────────────
echo ""
read -rp "$(echo -e "${BOLD}Hetzner Cloud API token${NC} (leave blank to skip): ")" HETZNER_API_TOKEN
read -rp "$(echo -e "${BOLD}WHMCS webhook secret${NC}  (leave blank to skip): ")" WHMCS_WEBHOOK_SECRET
read -rp "$(echo -e "${BOLD}Alert webhook URL${NC}     (Slack/Discord, blank to skip): ")" ALERT_WEBHOOK_URL
echo ""

# ── 6. install system packages ─────────────────────────────────────────────────
info "Updating package lists…"
apt-get update -qq

# base tools
PKGS_NEEDED=()
command -v curl    &>/dev/null || PKGS_NEEDED+=(curl)
command -v git     &>/dev/null || PKGS_NEEDED+=(git)
command -v dig     &>/dev/null || PKGS_NEEDED+=(dnsutils)
command -v nginx   &>/dev/null || PKGS_NEEDED+=(nginx)
command -v certbot &>/dev/null || PKGS_NEEDED+=(certbot python3-certbot-nginx)
command -v python3 &>/dev/null || PKGS_NEEDED+=(python3)

if [[ ${#PKGS_NEEDED[@]} -gt 0 ]]; then
  info "Installing base packages: ${PKGS_NEEDED[*]}"
  apt-get install -y "${PKGS_NEEDED[@]}"
fi

# Docker CE (official repo – more reliable than docker.io across distros)
if ! command -v docker &>/dev/null; then
  info "Installing Docker CE from the official repository…"
  apt-get install -y ca-certificates gnupg lsb-release

  # detect distro for the correct repo URL
  OS_ID=$(. /etc/os-release && echo "$ID")          # ubuntu | debian
  OS_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} ${OS_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  success "Docker CE installed."
else
  success "Docker already installed: $(docker --version)"
fi

# ensure docker compose v2 plugin is available
if ! docker compose version &>/dev/null; then
  info "Installing docker-compose-plugin…"
  apt-get install -y docker-compose-plugin
fi

systemctl enable --now docker
systemctl enable --now nginx
success "System packages ready."

# ── 7. generate secrets ────────────────────────────────────────────────────────
DB_PASSWORD=$(openssl rand -hex 32)
info "Generated a secure database password."

# ── 8. clone / update source ───────────────────────────────────────────────────
info "Setting up source in ${INSTALL_DIR}/src …"
mkdir -p "${INSTALL_DIR}/src" "${INSTALL_DIR}/releases" "${INSTALL_DIR}/backups"

if [[ -d "${INSTALL_DIR}/src/.git" ]]; then
  info "Existing checkout found – pulling latest…"
  git -C "${INSTALL_DIR}/src" pull --ff-only
else
  git clone "$REPO_URL" "${INSTALL_DIR}/src"
fi
success "Source ready."

# ── 9. copy compose file ───────────────────────────────────────────────────────
cp "${INSTALL_DIR}/src/deploy/docker/compose.yml" "${INSTALL_DIR}/compose.yml"
cp "${INSTALL_DIR}/src/deploy/docker/backup.sh"   "${INSTALL_DIR}/backup.sh"
chmod +x "${INSTALL_DIR}/backup.sh"

# ── 10. write .env ─────────────────────────────────────────────────────────────
cat > "${INSTALL_DIR}/.env" <<EOF
DB_PASSWORD=${DB_PASSWORD}
PUBLIC_PANEL_URL=https://${DOMAIN}
PANEL_PORT=3199
TRUST_PROXY=172.16.0.0/12,192.168.0.0/16,10.0.0.0/8
WHMCS_WEBHOOK_SECRET=${WHMCS_WEBHOOK_SECRET}
HETZNER_API_TOKEN=${HETZNER_API_TOKEN}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL}
EOF
chmod 600 "${INSTALL_DIR}/.env"
success ".env written."

# ── 11. build Docker image ─────────────────────────────────────────────────────
info "Building Docker image (this takes a few minutes)…"

# install util-linux (provides ionice) if missing
command -v ionice &>/dev/null || apt-get install -y -qq util-linux

DOCKER_BUILDKIT=0 nice -n 19 ionice -c3 \
  docker build \
    --memory 900m --memory-swap 900m --cpu-shares 64 \
    -t snbd-console:latest \
    "${INSTALL_DIR}/src"
success "Docker image built."

# ── 12. configure nginx (HTTP only, for certbot challenge) ─────────────────────
info "Writing nginx configuration…"
NGINX_CONF="/etc/nginx/sites-available/snbd-console"

cat > "$NGINX_CONF" <<'NGINXEOF'
# SNBD Console – managed by deploy.sh
# SSL block is added after certbot runs.

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN_PLACEHOLDER;

    # Certbot will replace this block with an HTTPS redirect once certs are issued.
    # Temporary: proxy everything so the health-check works pre-SSL.

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
}
NGINXEOF

# inject actual domain
sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" "$NGINX_CONF"

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/snbd-console
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl reload nginx
success "nginx configured."

# ── 13. start containers ───────────────────────────────────────────────────────
info "Starting containers…"
docker compose -f "${INSTALL_DIR}/compose.yml" --env-file "${INSTALL_DIR}/.env" \
  --project-directory "${INSTALL_DIR}" up -d
success "Containers started."

# ── 14. obtain Let's Encrypt certificate ───────────────────────────────────────
info "Obtaining SSL certificate for ${DOMAIN}…"
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  -d "$DOMAIN"

# Patch the certbot-generated HTTPS block:
# restore client_max_body_size, timeouts, ws upgrade map, and oauth well-known
NGINX_SSL_CONF="/etc/nginx/sites-available/snbd-console"

# certbot rewrites the file; patch the server{} blocks it left
python3 - "$NGINX_SSL_CONF" "$DOMAIN" <<'PYEOF'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
domain = sys.argv[2]
text = path.read_text()

# 1 – ensure the map block is present (outside server{})
map_block = """
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
"""
if 'map $http_upgrade' not in text:
    text = map_block + text

# 2 – patch every server{} block that proxies to us
patch = f"""
    client_max_body_size 210m;
    proxy_read_timeout   900s;
    proxy_send_timeout   900s;

    location ^~ /.well-known/oauth- {{
        proxy_pass http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header Host              $http_host;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location / {{
        proxy_pass         http://127.0.0.1:3199;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host              $http_host;
        proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }}
"""

# replace any existing bare location / block that certbot left
text = re.sub(r'\s*location\s*/\s*\{[^}]*\}', '', text)
text = re.sub(r'\s*location\s*\^\~\s*/\.well-known/oauth[^}]*\}', '', text, flags=re.DOTALL)
text = re.sub(r'(server_name\s[^;]+;)', r'\1' + patch, text, count=1)

path.write_text(text)
print("nginx config patched.")
PYEOF

nginx -t && systemctl reload nginx
success "SSL certificate installed and nginx reloaded."

# ── 15. create admin account ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━  Create your admin login  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
read -rp "Admin email:    " ADMIN_EMAIL
read -rsp "Admin password (min 12 chars): " ADMIN_PASSWORD; echo ""
read -rp "Admin name:     " ADMIN_NAME

[[ ${#ADMIN_PASSWORD} -ge 12 ]] || die "Password must be at least 12 characters."

docker compose -f "${INSTALL_DIR}/compose.yml" --env-file "${INSTALL_DIR}/.env" \
  --project-directory "${INSTALL_DIR}" \
  exec -e CLIENT_EMAIL="$ADMIN_EMAIL" \
       -e CLIENT_NAME="$ADMIN_NAME" \
       -e CLIENT_PASSWORD="$ADMIN_PASSWORD" \
  api node_modules/.bin/tsx src/create-client.ts

success "Admin account created."

# ── 16. setup daily backup cron ───────────────────────────────────────────────
CRON_LINE="15 3 * * * ${INSTALL_DIR}/backup.sh >> ${INSTALL_DIR}/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "snbd.*backup"; echo "$CRON_LINE" ) | crontab -
success "Daily backup cron added (03:15)."

# ── 17. summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║              Deployment complete!                           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Panel URL :${NC} https://${DOMAIN}/"
echo -e "  ${GREEN}Login     :${NC} ${ADMIN_EMAIL}"
echo -e "  ${GREEN}Files     :${NC} ${INSTALL_DIR}/"
echo ""
echo -e "  ${CYAN}Useful commands:${NC}"
echo -e "    docker logs -f snbd-console-api"
echo -e "    docker compose -f ${INSTALL_DIR}/compose.yml restart api"
echo -e "    ${INSTALL_DIR}/backup.sh"
echo ""
echo -e "  ${YELLOW}Keep this safe (not in Git):${NC}"
echo -e "    ${INSTALL_DIR}/.env  (contains DB password)"
echo ""
