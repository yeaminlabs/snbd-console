#!/bin/sh
# Cross-compiles the agent for Linux, writes SHA256SUMS and signs it.
# Output: dist/releases/ (served by the panel under /dl/).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist/releases"
VERSION=$(cat "$ROOT/agent/VERSION")
rm -rf "$OUT" && mkdir -p "$OUT"
cd "$ROOT/agent"
for arch in amd64 arm64; do
  echo "building linux/$arch"
  GOOS=linux GOARCH=$arch CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$OUT/snbd-agent-linux-$arch" .
done
cd "$OUT"
shasum -a 256 snbd-agent-linux-* > SHA256SUMS
echo "$VERSION" > VERSION
node "$ROOT/scripts/release.mjs" sign "$OUT"
echo "release $VERSION ready in $OUT"
