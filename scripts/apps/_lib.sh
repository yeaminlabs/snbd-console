# Shared helpers, prepended to every app recipe by the panel. Runs as root on the VPS via the agent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
TOTAL_STEPS=1

step() { echo "##STEP $1/$TOTAL_STEPS $2"; }
die() { echo "error: $*" >&2; exit 1; }

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then PM=apt
  elif command -v dnf >/dev/null 2>&1; then PM=dnf
  elif command -v yum >/dev/null 2>&1; then PM=yum
  else die "unsupported system: no apt, dnf or yum found"; fi
}

pkg_install() {
  case "$PM" in
    apt) apt-get update -qq && apt-get install -y -qq "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
  esac
}

ensure_basics() {
  detect_pm
  for c in curl; do command -v "$c" >/dev/null 2>&1 || pkg_install "$c"; done
  [ -e /etc/ssl/certs/ca-certificates.crt ] || [ -e /etc/pki/tls/certs/ca-bundle.crt ] || pkg_install ca-certificates
}

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }

install_node22() {
  if [ "$(node_major)" -ge 22 ]; then echo "Node.js $(node --version) already installed"; return; fi
  echo "Adding the NodeSource repository for Node.js 22"
  if [ "$PM" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    "$PM" install -y -q nodejs
  fi
  echo "Installed Node.js $(node --version)"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then echo "Docker $(docker --version) already installed"; return; fi
  echo "Running the official Docker install script (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker --version
}
