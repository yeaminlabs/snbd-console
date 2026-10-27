import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildUserData } from './cloudinit.js';
import { audit, hashPassword, pool, randomToken, sha256 } from './db.js';
import { getAdapter, ProviderError, type ProviderServer } from './providers/index.js';
import { getVmInfo, pushEnrollScript } from './providers/proxmoxClient.js';
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

const Action = z.enum(['ping', 'create', 'attach', 'suspend', 'unsuspend', 'terminate', 'changepackage', 'sso', 'info', 'resetpassword']);

const Body = z.object({
  action: Action,
  serviceId: z.number().int().positive().optional(),
  client: z
    .object({ id: z.number().int().positive(), email: z.string().email(), name: z.string().min(1).max(120) })
    .optional(),
  hostname: z.string().max(60).optional(),
  plan: Plan.optional(),
  // attach only: the already-running VM to link, and the IP WHMCS has on file for it (Proxmox
  // itself has no notion of which IP belongs to which VM, so this must come from the order)
  vmid: z.string().max(20).optional(),
  ip: z.string().max(45).optional(),
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
  ip: string | null;
  suspended_at: string | null;
  terminated_at: string | null;
}

async function findServer(serviceId: number): Promise<ServerRow | null> {
  const { rows } = await pool.query(
    `select id, client_id, name, provider, provider_ref as "providerRef", status, plan, region, os, host(ip) as ip, suspended_at, terminated_at
     from servers where whmcs_service_id = $1`,
    [serviceId],
  );
  return rows[0] ?? null;
}

/** One panel login per WHMCS client: link by WHMCS id first, then by email. */
async function upsertClient(c: NonNullable<Body['client']>): Promise<{ id: string; password?: string; email: string }> {
  const email = c.email.toLowerCase();
  const found = await pool.query('select id, email from clients where whmcs_client_id = $1 or email = $2 order by (whmcs_client_id = $1) desc limit 1', [c.id, email]);
  if (found.rows[0]) {
    await pool.query('update clients set whmcs_client_id = $2, name = $3 where id = $1', [found.rows[0].id, c.id, c.name]);
    // keep the stored address: it is the login, and WHMCS may have changed its billing email since
    return { id: found.rows[0].id, email: found.rows[0].email };
  }
  // a real password is generated so the client can also sign in directly, not only through SSO;
  // WHMCS stores it with the service and shows it in the client area
  const password = randomToken(12);
  const { rows } = await pool.query(
    'insert into clients (email, name, password_hash, whmcs_client_id) values ($1, $2, $3, $4) returning id',
    [email, c.name, await hashPassword(password), c.id],
  );
  return { id: rows[0].id, password, email };
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
    const detail = String((err as Error).message).slice(0, 200);
    await audit(server.client_id, server.id, 'provision.failed', { error: detail });
    // surface the provider's own words: "serverType required", "token not set", quota, etc.
    throw new HttpError(502, `provider failed to create the server: ${detail}`);
  }
}

// A suspend/unsuspend/resize/terminate that fails against the real hosting backend must surface
// the actual reason (quota, lock, unreachable...) to WHMCS, not a bare "internal error" — that's
// the only thing standing between an admin and a support ticket they can't do anything with.
async function providerCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProviderError) throw new HttpError(err.code === 'unsupported' ? 501 : 502, err.message);
    throw err;
  }
}

function closeTerminals(serverId: string) {
  for (const t of agents.get(serverId)?.terminals.values() ?? []) t.close(4403, 'server suspended');
}

function serviceView(server: ServerRow, webUrl: string, extra: object = {}) {
  return {
    serverId: server.id,
    server: {
      name: server.name,
      status: server.status,
      ip: server.ip,
      os: server.os,
      region: server.region,
      provider: server.provider,
      suspended: !!server.suspended_at,
      agentConnected: agents.has(server.id),
    },
    panelUrl: webUrl,
    ...extra,
  };
}

async function handle(body: Body, panelUrl: string, webUrl: string): Promise<object> {
  if (body.action === 'ping') return { ok: true, panelUrl: webUrl };

  if (body.action === 'create') {
    if (!body.plan) throw new HttpError(400, 'plan is required for create');
    if (!body.client) throw new HttpError(400, 'client is required for create');
    let server = await findServer(body.serviceId!);
    if (server?.terminated_at) throw new HttpError(409, 'service was terminated');
    if (server) {
      // retry of a create whose provider call failed
      const failed = await pool.query(`select action from audit_log where server_id = $1 and action in ('provision.failed', 'server.provisioned') order by id desc limit 1`, [server.id]);
      if (failed.rows[0]?.action === 'provision.failed') await provision(server, panelUrl);
      server = (await findServer(body.serviceId!)) ?? server;
      const { rows } = await pool.query('select email from clients where id = $1', [server.client_id]);
      return serviceView(server, webUrl, { existing: true, client: { email: rows[0]?.email } });
    }
    const account = await upsertClient(body.client);
    const { provider, region, os, ...specs } = body.plan;
    const inserted = await pool.query(
      `insert into servers (client_id, name, provider, status, region, os, plan, whmcs_service_id)
       values ($1, $2, $3, 'provisioning', $4, $5, $6, $7)
       on conflict (whmcs_service_id) do nothing returning id`,
      [account.id, body.hostname || `vps-${body.serviceId}`, provider, region ?? null, os ?? null, specs, body.serviceId],
    );
    server = await findServer(body.serviceId!);
    if (!server) throw new HttpError(500, 'could not create server');
    if (inserted.rowCount === 0) return serviceView(server, webUrl, { existing: true, client: { email: account.email } });
    await audit(account.id, server.id, 'server.created', { source: 'whmcs', serviceId: body.serviceId });
    await provision(server, panelUrl);
    // the password is only in this answer: the panel stores a hash, WHMCS keeps it with the service
    return serviceView((await findServer(body.serviceId!)) ?? server, webUrl, {
      existing: false,
      client: { email: account.email, password: account.password },
    });
  }

  if (body.action === 'attach') {
    if (!body.plan || body.plan.provider !== 'bdix') throw new HttpError(400, 'attach is only for bdix servers');
    if (!body.client) throw new HttpError(400, 'client is required');
    if (!body.serviceId) throw new HttpError(400, 'serviceId is required');
    if (!body.vmid) throw new HttpError(400, 'vmid is required — the Proxmox VMID of the already-running VPS');
    if (!body.ip) throw new HttpError(400, "ip is required — set the service's Dedicated IP in WHMCS first");

    let server = await findServer(body.serviceId);
    if (server?.terminated_at) throw new HttpError(409, 'service was terminated');

    // ground truth comes from Proxmox, never from the form: a VMID that does not exist must fail loudly
    let vm;
    try {
      vm = await getVmInfo(body.vmid);
    } catch (err) {
      throw new HttpError(502, `could not find VMID ${body.vmid} on Proxmox: ${(err as Error).message}`);
    }
    const specs = { vcpu: vm.cores, ramGb: vm.ramGb, ...(vm.diskGb ? { diskGb: vm.diskGb } : {}) };

    const account = await upsertClient(body.client);
    if (!server) {
      await pool.query(
        `insert into servers (client_id, name, provider, status, os, plan, whmcs_service_id)
         values ($1, $2, 'bdix', 'agent_offline', $3, $4, $5)
         on conflict (whmcs_service_id) do nothing`,
        [account.id, body.hostname || vm.name, body.plan.os ?? null, specs, body.serviceId],
      );
      server = await findServer(body.serviceId);
    }
    if (!server) throw new HttpError(500, 'could not create server record');

    await pool.query(
      `update servers set provider_ref = $2, ip = $3::inet, plan = $4,
         status = case when status in ('running', 'provisioning') then status else 'agent_offline' end
       where id = $1`,
      [server.id, body.vmid, body.ip, specs],
    );
    await audit(account.id, server.id, 'server.attached', { source: 'whmcs', vmid: body.vmid, serviceId: body.serviceId });

    // fresh enroll token; a previous unused one from an earlier attempt must not linger
    await pool.query('delete from enroll_tokens where server_id = $1 and used_at is null', [server.id]);
    const token = randomToken(24);
    await pool.query(`insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, $2, now() + make_interval(hours => $3))`, [server.id, sha256(token), PROVISION_TOKEN_HOURS]);
    const enrollUrl = `${panelUrl}/enroll/${token}`;

    // best-effort: push the install over the guest-agent channel, but never make the webhook wait
    // the 1-3 minutes it takes to finish — the server flips to "running" on its own once connected
    const agentPushStarted = await pushEnrollScript(body.vmid, enrollUrl).catch(() => false);

    server = (await findServer(body.serviceId)) ?? server;
    return serviceView(server, webUrl, {
      existing: !!server,
      client: { email: account.email },
      agentPushStarted,
      manualCommand: agentPushStarted ? undefined : `curl -fsSL ${enrollUrl} | sh`,
    });
  }

  if (!body.serviceId) throw new HttpError(400, 'serviceId is required');
  const server = await findServer(body.serviceId);
  if (body.action === 'terminate' && (!server || server.terminated_at)) return { ok: true, note: 'already gone' };
  if (!server || server.terminated_at) throw new HttpError(404, 'unknown service');

  switch (body.action) {
    case 'suspend':
      await providerCall(() => getAdapter(server.provider).suspend(server));
      await pool.query('update servers set suspended_at = coalesce(suspended_at, now()) where id = $1', [server.id]);
      closeTerminals(server.id);
      await audit(server.client_id, server.id, 'server.suspended');
      return { ok: true };
    case 'unsuspend':
      await providerCall(() => getAdapter(server.provider).unsuspend(server));
      await pool.query('update servers set suspended_at = null where id = $1', [server.id]);
      await audit(server.client_id, server.id, 'server.unsuspended');
      return { ok: true };
    case 'changepackage': {
      if (!body.plan) throw new HttpError(400, 'plan is required for changepackage');
      const { provider: _p, region: _r, os: _o, ...specs } = body.plan;
      await providerCall(() => getAdapter(server.provider).resize(server, specs));
      await pool.query('update servers set plan = $2 where id = $1', [server.id, specs]);
      await audit(server.client_id, server.id, 'server.resized', specs);
      return { ok: true };
    }
    case 'terminate':
      await providerCall(() => getAdapter(server.provider).destroy(server));
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
    case 'info': {
      const { rows } = await pool.query('select email from clients where id = $1', [server.client_id]);
      return serviceView(server, webUrl, { client: { email: rows[0]?.email } });
    }
    case 'resetpassword': {
      const { rows } = await pool.query('select email from clients where id = $1', [server.client_id]);
      const password = randomToken(12);
      await pool.query('update clients set password_hash = $2 where id = $1', [server.client_id, await hashPassword(password)]);
      // a reset means the old password must stop working everywhere
      await pool.query('delete from sessions where client_id = $1', [server.client_id]);
      await audit(server.client_id, server.id, 'client.password_reset', { source: 'whmcs' });
      return { email: rows[0]?.email, password };
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

    const panelUrl = (process.env.PUBLIC_PANEL_URL ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
    const webUrl = (process.env.WEB_URL ?? panelUrl).replace(/\/$/, '');

    // reads are answered fresh and never cached: a status check must not replay a minute-old reply
    if (parsed.data.action === 'info' || parsed.data.action === 'ping') {
      try {
        return await handle(parsed.data, panelUrl, webUrl);
      } catch (err) {
        if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
        req.log.error(err, 'whmcs webhook failed');
        return reply.code(500).send({ error: 'internal error' });
      }
    }

    // claim the key; a repeat gets the stored answer, a concurrent duplicate gets 409
    const claim = await pool.query(`insert into webhook_events (key, state) values ($1, 'processing') on conflict do nothing returning key`, [key]);
    if (claim.rowCount === 0) {
      const { rows } = await pool.query('select state, http_status, response from webhook_events where key = $1', [key]);
      if (rows[0]?.state === 'done') return reply.code(rows[0].http_status).header('x-snbd-replayed', '1').send(rows[0].response);
      return reply.code(409).send({ error: 'request in progress' });
    }

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
