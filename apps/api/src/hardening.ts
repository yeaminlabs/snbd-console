import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { SESSION_COOKIE } from './session.js';

export const isProd = process.env.NODE_ENV === 'production';

/** Counts failures per key; after `max` within the window the key is blocked until the window ends. */
export class FailureLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private max: number, private windowMs: number) {}
  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.until < Date.now()) { this.hits.delete(key); return false; }
    return h.n >= this.max;
  }
  fail(key: string) {
    if (this.hits.size > 10_000) this.prune();
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.until < now) this.hits.set(key, { n: 1, until: now + this.windowMs });
    else h.n++;
  }
  clear(key: string) { this.hits.delete(key); }
  private prune() {
    const now = Date.now();
    for (const [k, h] of this.hits) if (h.until < now) this.hits.delete(k);
  }
}

/** Refuses to boot a production panel with settings that would leave it unsafe. */
export function assertProductionConfig() {
  if (!isProd) return;
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!/^https:\/\//.test(process.env.PUBLIC_PANEL_URL ?? '')) problems.push('PUBLIC_PANEL_URL must be an https:// address');
  const secret = process.env.WHMCS_WEBHOOK_SECRET;
  if (secret !== undefined && secret !== '' && secret.length < 32) problems.push('WHMCS_WEBHOOK_SECRET must be at least 32 characters');
  if (process.env.SNBD_INSECURE) problems.push('SNBD_INSECURE must not be set in production');
  if (problems.length) {
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}

const hostOf = (v: string) => { try { return new URL(v).host; } catch { return ''; } };

export async function registerHardening(app: FastifyInstance) {
  // cheap CSRF defence on top of SameSite cookies: a browser request that names a foreign Origin is refused
  const allowedHosts = new Set([process.env.PUBLIC_PANEL_URL, process.env.WEB_URL].filter(Boolean).map((u) => hostOf(u!)));
  // local development: the Vite dev server (a different port) is the browser's origin
  if (!isProd) allowedHosts.add('localhost:5173');
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (/^\/oauth\/(register|token|revoke)(\?|$)/.test(req.url)) return; // no cookies here: authenticated by PKCE and codes, and browser-based MCP clients call them
    const origin = req.headers.origin;
    if (!origin) return; // no Origin: not a browser cross-site request (curl, WHMCS, the agent)
    const host = hostOf(origin);
    if (host === req.headers.host || allowedHosts.has(host)) return;
    return reply.code(403).send({ error: 'Cross-site request refused' });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) reply.header('strict-transport-security', 'max-age=31536000');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) {
      reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    }
    return payload;
  });

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    timeWindow: '1 minute',
    // signed-in browsers are counted per session so people behind one office IP do not share a budget
    keyGenerator: (req: FastifyRequest) => req.cookies?.[SESSION_COOKIE]?.slice(0, 16) ?? (req.headers.authorization?.startsWith('Bearer snbd_') ? 'tok:' + req.headers.authorization.slice(7, 19) : req.ip),
    errorResponseBuilder: (_req, ctx) => ({ error: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.` }),
  });
}

/** Per-route limit keyed by IP (not by cookie, so rotating cookies does not help an attacker). */
export const ipLimit = (max: number, timeWindow = '1 minute') => ({ config: { rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.ip } } });

export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
