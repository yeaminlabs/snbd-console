import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pool, sha256 } from './db.js';
import { ipLimit } from './hardening.js';

const releasesDir = resolve(process.env.RELEASES_DIR ?? join(import.meta.dirname, '..', '..', '..', 'dist', 'releases'));
const scriptPath = join(import.meta.dirname, '..', '..', '..', 'scripts', 'install.sh');

// only these names are ever served from the releases directory
const DOWNLOADS = new Set(['SHA256SUMS', 'SHA256SUMS.sig', 'VERSION', 'release.pub', 'snbd-agent-linux-amd64', 'snbd-agent-linux-arm64']);

function panelUrl(req: { protocol: string; headers: Record<string, unknown> }): string {
  const configured = process.env.PUBLIC_PANEL_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.headers.host}`;
}

function renderInstaller(url: string, token: string): string {
  const pubPath = join(releasesDir, 'release.pub');
  if (!existsSync(pubPath)) throw new Error('release.pub missing; run scripts/build-agent.sh');
  return readFileSync(scriptPath, 'utf8')
    .replace('@PANEL_URL@', url)
    .replace('@ENROLL_TOKEN@', token)
    .replace('@RELEASE_PUBKEY@', readFileSync(pubPath, 'utf8').trim());
}

const failScript = (msg: string) => `#!/bin/sh\necho "error: ${msg}" >&2\nexit 1\n`;

export function registerRelease(app: FastifyInstance) {
  // First-boot installer: the token comes from /etc/snbd/agent.env (written by cloud-init).
  app.get('/install.sh', ipLimit(30), async (req, reply) => {
    reply.type('text/x-shellscript').header('cache-control', 'no-store');
    return renderInstaller(panelUrl(req), '');
  });

  // `curl -fsSL <panel>/enroll/<token> | sh`. A bad token returns a script that explains itself,
  // so the person sees a message instead of a bare curl failure.
  app.get<{ Params: { token: string } }>('/enroll/:token', ipLimit(20), async (req, reply) => {
    reply.type('text/x-shellscript').header('cache-control', 'no-store');
    const token = req.params.token;
    if (!/^[0-9a-f]{32,128}$/.test(token)) return failScript('invalid enroll token');
    const { rowCount } = await pool.query('select 1 from enroll_tokens where token_hash = $1 and used_at is null and expires_at > now()', [sha256(token)]);
    if (!rowCount) return failScript('this enroll token is invalid, already used or expired. Generate a new one in your panel.');
    return renderInstaller(panelUrl(req), token);
  });

  app.get<{ Params: { name: string } }>('/dl/:name', ipLimit(60), async (req, reply) => {
    const { name } = req.params;
    const file = join(releasesDir, name);
    if (!DOWNLOADS.has(name) || !existsSync(file)) return reply.code(404).send('not found');
    reply.type('application/octet-stream').header('content-length', statSync(file).size).header('cache-control', 'no-cache');
    return reply.send(createReadStream(file));
  });
}
