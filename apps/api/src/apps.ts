import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AppDef {
  id: string;
  name: string;
  tag: string;
  desc: string;
  /** shell test run on the VPS; exit 0 means the app is installed */
  check: string;
}

export const APPS: AppDef[] = [
  { id: 'claude', name: 'Claude Code', tag: 'AI coding agent', desc: 'Anthropic CLI for working on code from the terminal.', check: 'command -v claude' },
  { id: 'hermes', name: 'Hermes Agent', tag: 'AI agent', desc: 'Self-hosted agent with tools and memory.', check: '[ -x /root/.local/bin/hermes ] || command -v hermes' },
  { id: 'openclaw', name: 'OpenClaw', tag: 'AI assistant', desc: 'Personal assistant gateway you can message from chat apps.', check: 'command -v openclaw' },
  { id: 'docker', name: 'Docker', tag: 'Runtime', desc: 'Docker Engine with the Compose plugin.', check: 'command -v docker' },
  { id: 'node', name: 'Node.js 22', tag: 'Runtime', desc: 'LTS runtime with npm and corepack.', check: `command -v node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]` },
  { id: 'n8n', name: 'n8n', tag: 'Automation', desc: 'Workflow automation in Docker on port 5678 of the VPS, local only. Open it through an SSH tunnel or a reverse proxy.', check: "docker ps -a --format '{{.Names}}' | grep -qx n8n" },
  { id: 'ollama', name: 'Ollama', tag: 'Local models', desc: 'Run open models on this server.', check: 'command -v ollama' },
];

export const findApp = (id: string) => APPS.find((a) => a.id === id);

// all checks in one round trip: prints "<id>=1" or "<id>=0" per app
export const CHECK_SCRIPT = APPS.map((a) => `if ( ${a.check} ) >/dev/null 2>&1; then echo "${a.id}=1"; else echo "${a.id}=0"; fi`).join('\n');

const appsDir = join(import.meta.dirname, '..', '..', '..', 'scripts', 'apps');

/** Shared helpers plus the recipe, sent to the agent as one script. */
export function loadRecipe(id: string): string | null {
  if (!findApp(id)) return null;
  try {
    return readFileSync(join(appsDir, '_lib.sh'), 'utf8') + '\n' + readFileSync(join(appsDir, `${id}.sh`), 'utf8');
  } catch {
    return null;
  }
}

/** Progress comes from "##STEP i/N text" lines the recipes print. */
export function parseProgress(log: string, done: boolean): { pct: number; step: string } {
  const matches = [...log.matchAll(/^##STEP (\d+)\/(\d+) (.*)$/gm)];
  const last = matches[matches.length - 1];
  if (!last) return { pct: done ? 100 : 0, step: '' };
  const [i, n] = [Number(last[1]), Number(last[2])];
  return { pct: done ? 100 : Math.min(95, Math.floor(((i - 1) / n) * 100)), step: last[3] };
}
