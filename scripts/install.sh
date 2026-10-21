#!/bin/sh
# SNBD agent installer. Served by the panel at /install.sh and /enroll/<token>; the panel fills
# the @...@ placeholders. Safe to re-run: it upgrades the binary and keeps an existing enrollment.
#
# Optional environment:
#   SNBD_INSECURE=1          allow a plain http:// panel (testing only; the token travels in clear text)
#   SNBD_REQUIRE_SIGNATURE=1 fail instead of warn when the signature cannot be checked (needs OpenSSL 3+)
#   SNBD_SKIP_SERVICE=1      install files only, do not touch systemd (containers)
set -eu

PANEL_URL="@PANEL_URL@"
ENROLL_TOKEN="@ENROLL_TOKEN@"
CONF_DIR=/etc/snbd
ENV_FILE=$CONF_DIR/agent.env
BIN=/usr/local/bin/snbd-agent

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (try: sudo sh)"
[ "$(uname -s)" = Linux ] || die "Linux only"

# first-boot (cloud-init) writes the token to agent.env before running this script
if [ -z "$ENROLL_TOKEN" ] && [ -f "$ENV_FILE" ]; then
  ENROLL_TOKEN=$(sed -n 's/^ENROLL_TOKEN=//p' "$ENV_FILE" | head -n1)
fi

case "$PANEL_URL" in
  https://*) ;;
  http://*) [ "${SNBD_INSECURE:-}" = 1 ] || die "panel URL is plain http; set SNBD_INSECURE=1 to allow it for testing" ;;
  *) die "bad panel URL: $PANEL_URL" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "need curl or wget"
fi
if command -v sha256sum >/dev/null 2>&1; then sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "need sha256sum"; fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
NAME=snbd-agent-linux-$ARCH

say "Downloading agent ($ARCH)..."
fetch "$PANEL_URL/dl/SHA256SUMS" "$TMP/SHA256SUMS"
fetch "$PANEL_URL/dl/SHA256SUMS.sig" "$TMP/SHA256SUMS.sig"
fetch "$PANEL_URL/dl/$NAME" "$TMP/$NAME"

# 1. signature over the checksum list (key pinned in this script)
cat > "$TMP/release.pub" <<'PUBKEY'
@RELEASE_PUBKEY@
PUBKEY
verified=0
if command -v openssl >/dev/null 2>&1 && openssl version 2>/dev/null | grep -Eq '^OpenSSL [3-9]'; then
  openssl pkeyutl -verify -pubin -inkey "$TMP/release.pub" -rawin -in "$TMP/SHA256SUMS" -sigfile "$TMP/SHA256SUMS.sig" >/dev/null 2>&1 \
    || die "signature check FAILED; refusing to install"
  verified=1
fi
if [ "$verified" = 0 ]; then
  [ "${SNBD_REQUIRE_SIGNATURE:-}" != 1 ] || die "cannot verify the signature (OpenSSL 3+ needed)"
  say "warning: signature not checked (OpenSSL 3+ not found); relying on TLS and checksum only"
fi

# 2. checksum of the binary
want=$(grep " $NAME\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)
[ -n "$want" ] || die "no checksum listed for $NAME"
[ "$(sha "$TMP/$NAME")" = "$want" ] || die "checksum mismatch; refusing to install"

install -d -m 0700 "$CONF_DIR"
install -m 0755 "$TMP/$NAME" "$BIN"

# agent.env: keep the token only when this server is not enrolled yet
WS_URL=$(printf '%s' "$PANEL_URL" | sed 's#^http#ws#')/agent
{
  echo "PANEL_URL=$WS_URL"
  echo "SNBD_STATE_DIR=$CONF_DIR"
  echo "SNBD_ENV_FILE=$ENV_FILE"
  if [ ! -f "$CONF_DIR/agent.json" ]; then
    [ -n "$ENROLL_TOKEN" ] || die "no enroll token. Use the command shown in your panel."
    echo "ENROLL_TOKEN=$ENROLL_TOKEN"
  fi
} > "$ENV_FILE.new"
chmod 0600 "$ENV_FILE.new" && mv "$ENV_FILE.new" "$ENV_FILE"

if [ "${SNBD_SKIP_SERVICE:-}" = 1 ] || ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
  say "Installed $BIN. systemd not available, start it yourself:"
  say "  set -a; . $ENV_FILE; set +a; $BIN"
  exit 0
fi

cat > /etc/systemd/system/snbd-agent.service <<'UNIT'
[Unit]
Description=SNBD panel agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/snbd/agent.env
ExecStart=/usr/local/bin/snbd-agent
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable snbd-agent >/dev/null 2>&1
systemctl restart snbd-agent

if [ ! -f "$CONF_DIR/agent.json" ] || [ -n "$ENROLL_TOKEN" ]; then
  say "Waiting for the server to connect to the panel..."
  i=0
  while [ $i -lt 30 ]; do
    [ -f "$CONF_DIR/agent.json" ] && { say "Done. This server is now connected to your panel."; exit 0; }
    i=$((i + 1)); sleep 1
  done
  die "agent did not enroll in 30s. Check: journalctl -u snbd-agent -n 50"
fi
say "Agent updated and running."
