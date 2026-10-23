import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  default: string;
  required: boolean;
  hint?: string;
}

export interface PostInstall {
  url?: string;
  note?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  tag: string;
  desc: string;
  version: string;
  type: 'script' | 'compose';
  installDir?: string;
  /** Docker container name for terminal/file access; defaults to snbd-<id> for compose apps */
  containerName?: string;
  check?: string;
  postInstall?: PostInstall;
  form?: FormField[];
}

const manifestsDir = join(import.meta.dirname, '..', '..', '..', 'manifests');

let _cache: Map<string, AppManifest> | null = null;

function loadAll(): Map<string, AppManifest> {
  if (_cache) return _cache;
  _cache = new Map();
  if (!existsSync(manifestsDir)) return _cache;
  for (const entry of readdirSync(manifestsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(manifestsDir, entry.name, 'manifest.json');
    if (!existsSync(p)) continue;
    try {
      const m = JSON.parse(readFileSync(p, 'utf8')) as AppManifest;
      _cache.set(m.id, m);
    } catch { /* skip malformed manifest */ }
  }
  return _cache;
}

export const getManifest = (id: string): AppManifest | null => loadAll().get(id) ?? null;
export const listManifests = (): AppManifest[] => [...loadAll().values()];

export function loadComposeTemplate(id: string): string | null {
  const p = join(manifestsDir, id, 'docker-compose.yml');
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** Generate a bash install script for a compose-type app from its manifest + user params. */
export function generateComposeInstallScript(manifest: AppManifest, params: Record<string, string>): string | null {
  const compose = loadComposeTemplate(manifest.id);
  if (!compose) return null;
  const dir = manifest.installDir ?? `/opt/snbd/apps/${manifest.id}`;

  // Build .env content from form defaults overridden by user params
  const envLines = (manifest.form ?? []).map((f) => {
    const val = params[f.key] ?? f.default;
    return `${f.key}=${val}`;
  });
  const envContent = envLines.join('\n') + '\n';

  const composeB64 = Buffer.from(compose, 'utf8').toString('base64');
  const envB64 = Buffer.from(envContent, 'utf8').toString('base64');
  const totalSteps = 4;

  return `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

INSTALL_DIR="${dir}"
mkdir -p "$INSTALL_DIR"

echo "##STEP 1/${totalSteps} Writing configuration..."
printf '%s' "${composeB64}" | base64 -d > "$INSTALL_DIR/docker-compose.yml"
printf '%s' "${envB64}" | base64 -d > "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

echo "##STEP 2/${totalSteps} Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. Install Docker first, then retry."
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose plugin not found."; exit 1; }

echo "##STEP 3/${totalSteps} Pulling ${manifest.name} image..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" pull 2>&1

echo "##STEP 4/${totalSteps} Starting ${manifest.name}..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d 2>&1

echo ""
echo "✓ ${manifest.name} started successfully."
${manifest.postInstall?.note ? `echo "${manifest.postInstall.note.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : ''}
`;
}

/** Generate a bash uninstall script for a compose-type app. */
export function generateComposeUninstallScript(manifest: AppManifest): string {
  const dir = manifest.installDir ?? `/opt/snbd/apps/${manifest.id}`;
  return `#!/bin/bash
set -euo pipefail

INSTALL_DIR="${dir}"
echo "##STEP 1/2 Stopping ${manifest.name}..."
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  docker compose -f "$INSTALL_DIR/docker-compose.yml" down --volumes 2>&1 || true
else
  echo "No docker-compose.yml found, skipping container stop."
fi

echo "##STEP 2/2 Removing files..."
rm -rf "$INSTALL_DIR"
echo "✓ ${manifest.name} removed."
`;
}
