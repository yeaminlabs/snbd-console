import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildUserData } from './cloudinit.js';
import { audit, hashPassword, pool, randomToken, sha256 } from './db.js';
import { getAdapter, type ProviderServer } from './providers/index.js';
import { agents } from './registry.js';
import { ipLimit } from './hardening.js';
import { startSession } from './session.js';

const MAX_CLOCK_SKEW_S = 300;
const PROVISION_TOKEN_HOURS = 24; // a VM can take a while to boot; manual imports use 30 minutes
const SSO_TTL_S = 60;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const Plan = z.object({
  provider: z.enum(['bdix', 'hetzner']),
  vcpu: z.number().int().positive().optional(),
  ramGb: z.number().positive().optional(),
  diskGb: z.number().positive().optional(),
  region: z.string().max(60).optional(),
  os: z.string().max(60).optional(),
  name: z.string().max(80).optional(),
  serverType: z.string().max(40).optional(),
});

const Body = z.object({
  action: z.enum(['create', 'suspend', 'unsuspend', 'terminate', 'changepackage', 'sso']),
  serviceId: z.number().int().positive(),
  client: z.object({ id: z.number().int().positive(), email: z.string().email(), name: z.string().min(1).max(120) }),
  hostname: z.string().max(60).optional(),
  plan: Plan.optional(),
});
type Body = z.infer<typeof Body>;

// Signature = hex HMAC-SHA256 over "<timestamp>.<raw body>", sent as "sha256=<hex>".
export function verifySignature(secret: string, timestamp: string, rawBody: string, header: string, nowS = Date.now() / 1000): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > MAX_CLOCK_SKEW_S) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const got = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

interface ServerRow extends ProviderServer {
  client_id: string;
  status: string;
  plan: object;
  region: string | null;
  os: string | null;
  terminated_at: string | null;
}

async function findServer(serviceId: number): Promise<ServerRow | null> {
  const { rows } = await pool.query(
    `select id, client_id, name, provider, provider_ref as "providerRef", status, plan, region, os, terminated_at from servers where whmcs_service_id = $1`,
    [serviceId],
  );
  return rows[0] ?? null;
}

async function upsertClient(c: Body['client']): Promise<string> {
  const email = c.email.toLowerCase();
  const found = await pool.query('select id from clients where whmcs_client_id = $1 or email = $2 order by (whmcs_client_id = $1) desc limit 1', [c.id, email]);
  if (found.rows[0]) {
    await pool.query('update clients set whmcs_client_id = $2, name = $3 where id = $1', [found.rows[0].id, c.id, c.name]);
    return found.rows[0].id;
  }
  // WHMCS clients sign in through SSO; the random password keeps password login closed until they set one
  const { rows } = await pool.query('insert into clients (email, name, password_hash, whmcs_client_id) values ($1, $2, $3, $4) returning id', [email, c.name, await hashPassword(randomToken()), c.id]);
  return rows[0].id;
}

async function provision(server: ServerRow, panelUrl: string) {
  // a fresh token each attempt; older unused ones are cleared so only one can ever enroll
  await pool.query('delete from enroll_tokens where server_id = $1 and used_at is null', [server.id]);
  const token = randomToken(24);
  await pool.query(`insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, $2, now() + make_interval(hours => $3))`, [server.id, sha256(token), PROVISION_TOKEN_HOURS]);
  try {
    const res = await getAdapter(server.provider).create({
      serverId: server.id,
      name: server.name,
      plan: server.plan,
      region: server.region ?? undefined,
      os: server.os ?? undefined,
      userData: buildUserData(panelUrl, token),
    });
    await pool.query('update servers set provider_ref = $2, ip = coalesce($3::inet, ip) where id = $1', [server.id, res.providerRef, res.ip ?? null]);
    await audit(server.client_id, server.id, 'server.provisioned');
  } catch (err) {
    await audit(server.client_id, server.id, 'provision.failed', { error: String((err as Error).message).slice(0, 300) });
    throw new HttpError(502, 'provider failed to create the server');
  }
}

function closeTerminals(serverId: string) {
  for (const t of agents.get(serverId)?.terminals.values() ?? []) t.close(4403, 'server suspended');
}

async function handle(body: Body, panelUrl: string, webUrl: string): Promise<object> {
  if (body.action === 'create') {
    if (!body.plan) throw new HttpError(400, 'plan is required for create');
    let server = await findServer(body.serviceId);
    if (server?.terminated_at) throw new HttpError(409, 'service was terminated');
    if (server) {
      // retry of a create whose provider call failed
      const failed = await pool.query(`select action from audit_log where server_id = $1 and action in ('provision.failed', 'server.provisioned') order by id desc limit 1`, [server.id]);
      if (failed.rows[0]?.action === 'provision.failed') await provision(server, panelUrl);
      return { serverId: server.id, existing: true };
    }
    const clientId = await upsertClient(body.client);
    const { provider, region, os, ...specs } = body.plan;
    const inserted = await pool.query(
      `insert into servers (client_id, name, provider, status, region, os, plan, whmcs_service_id)
       values ($1, $2, $3, 'provisioning', $4, $5, $6, $7)
       on conflict (whmcs_service_id) do nothing returning id`,
      [clientId, body.hostname || `vps-${body.serviceId}`, provider, region ?? null, os ?? null, specs, body.serviceId],
    );
    server = await findServer(body.serviceId);
    if (!server) throw new HttpError(500, 'could not create server');
    if (inserted.rowCount === 0) return { serverId: server.id, existing: true };
    await audit(clientId, server.id, 'server.created', { source: 'whmcs', serviceId: body.serviceId });
    await provision(server, panelUrl);
    return { serverId: server.id, existing: false };
  }

  const server = await findServer(body.serviceId);
  if (body.action === 'terminate' && (!server || server.terminated_at)) return { ok: true, note: 'already gone' };
  if (!server || server.terminated_at) throw new HttpError(404, 'unknown service');

  switch (body.action) {
    case 'suspend':
      await getAdapter(server.provider).suspend(server);
      await pool.query('update servers set suspended_at = coalesce(suspended_at, now()) where id = $1', [server.id]);
      closeTerminals(server.id);
      await audit(server.client_id, server.id, 'server.suspended');
      return { ok: true };
    case 'unsuspend':
      await getAdapter(server.provider).unsuspend(server);
      await pool.query('update servers set suspended_at = null where id = $1', [server.id]);
      await audit(server.client_id, server.id, 'server.unsuspended');
      return { ok: true };
    case 'changepackage': {
      if (!body.plan) throw new HttpError(400, 'plan is required for changepackage');
      const { provider: _p, region: _r, os: _o, ...specs } = body.plan;
      await getAdapter(server.provider).resize(server, specs);
      await pool.query('update servers set plan = $2 where id = $1', [server.id, specs]);
      await audit(server.client_id, server.id, 'server.resized', specs);
      return { ok: true };
    }
    case 'terminate':
      await getAdapter(server.provider).destroy(server);
      await pool.query('update servers set terminated_at = now(), status = $2 where id = $1', [server.id, 'stopped']);
      // cut the live connection and make sure no key or token can bring the agent back
      agents.get(server.id)?.socket.close(4005, 'server terminated');
      await pool.query('delete from agent_keys where server_id = $1', [server.id]);
      await pool.query('delete from enroll_tokens where server_id = $1', [server.id]);
      await audit(server.client_id, server.id, 'server.terminated');
      return { ok: true };
    case 'sso': {
      const token = randomToken(24);
      await pool.query(`insert into sso_tokens (token_hash, client_id, expires_at) values ($1, $2, now() + make_interval(secs => $3))`, [sha256(token), server.client_id, SSO_TTL_S]);
      return { url: `${webUrl}/sso/${token}`, expiresInSeconds: SSO_TTL_S };
    }
    default:
      throw new HttpError(400, 'unsupported action');
  }
}

export function registerWhmcs(app: FastifyInstance) {
  app.post('/webhooks/whmcs', ipLimit(120), async (req, reply) => {
    const secret = process.env.WHMCS_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) return reply.code(503).send({ error: 'webhook not configured' });

    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    const ts = String(req.headers['x-snbd-timestamp'] ?? '');
    const sig = String(req.headers['x-snbd-signature'] ?? '');
    const key = String(req.headers['x-snbd-idempotency-key'] ?? '');
    if (!verifySignature(secret, ts, raw, sig)) return reply.code(401).send({ error: 'bad signature' });
    if (!/^[\w:.-]{8,120}$/.test(key)) return reply.code(400).send({ error: 'idempotency key required' });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });

    // claim the key; a repeat gets the stored answer, a concurrent duplicate gets 409
    const claim = await pool.query(`insert into webhook_events (key, state) values ($1, 'processing') on conflict do nothing returning key`, [key]);
    if (claim.rowCount === 0) {
      const { rows } = await pool.query('select state, http_status, response from webhook_events where key = $1', [key]);
      if (rows[0]?.state === 'done') return reply.code(rows[0].http_status).header('x-snbd-replayed', '1').send(rows[0].response);
      return reply.code(409).send({ error: 'request in progress' });
    }

    const panelUrl = (process.env.PUBLIC_PANEL_URL ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
    const webUrl = (process.env.WEB_URL ?? panelUrl).replace(/\/$/, '');
    try {
      const result = await handle(parsed.data, panelUrl, webUrl);
      await pool.query(`update webhook_events set state = 'done', http_status = 200, response = $2 where key = $1`, [key, result]);
      return result;
    } catch (err) {
      // a failed attempt must stay retryable under the same key
      await pool.query('delete from webhook_events where key = $1', [key]);
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      req.log.error(err, 'whmcs webhook failed');
      return reply.code(500).send({ error: 'internal error' });
    }
  });

  app.get<{ Params: { token: string } }>('/sso/:token', ipLimit(20), async (req, reply) => {
    const { rows } = await pool.query(
      'update sso_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning client_id',
      [sha256(req.params.token)],
    );
    if (!rows[0]) return reply.code(400).type('text/plain').send('This sign-in link has expired. Open the panel again from your client area.');
    await startSession(reply, rows[0].client_id);
    return reply.redirect('/');
  });
}
