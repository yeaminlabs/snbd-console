import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { agents, type AgentConn } from './registry.js';
import { registerWhmcs } from './whmcs.js';
import { z } from 'zod';
import { AgentMessage, BrowserTermMessage } from '@snbd/proto';
import { audit, pool, randomToken, sha256, verifyPassword, requestContext } from './db.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { FailureLimiter, assertProductionConfig, ipLimit, registerHardening } from './hardening.js';
import { startMaintenance } from './maintenance.js';
import { startMonitor } from './monitor.js';
import { rotateKey } from './keys.js';
import { registerRelease } from './release.js';
import { getAdapter } from './providers/index.js';
import { SESSION_COOKIE, clientFromRequest, startSession } from './session.js';
import { registerManage } from './manage.js';
import { registerTools } from './tools.js';
import { registerTokens } from './tokens.js';
import { registerSshKeys } from './sshKeys.js';
import { registerMcp } from './mcp.js';
import { registerOAuth } from './oauth.js';
import { registerVpsPlans } from './vpsPlans.js';
import { failPending, failRunningJobs, onJobDone, onJobLog, onRpcResult } from './agentRpc.js';

const HEARTBEAT_STORE_EVERY_MS = 60_000;

assertProductionConfig();
// TRUST_PROXY: 'true' trusts every hop (only safe if the proxy overwrites X-Forwarded-For, like Caddy), or an address
// such as 127.0.0.1 to trust only that proxy, which is right for nginx because it appends to the header
function trustProxySetting(): boolean | string {
  const v = process.env.TRUST_PROXY;
  return !v || v === 'false' ? false : v === 'true' ? true : v;
}
const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist');
const app = Fastify({ logger: { level: 'info' }, trustProxy: trustProxySetting() });

// Defense in depth against the whole process going down. A rejected promise nobody awaited is
// almost always isolated (one request, one background task) - log it and keep serving everything
// else. A truly uncaught *synchronous* exception means some code ran off the rails in a way no
// try/catch here anticipated; Node's own docs say continuing after that is unsafe, so log it and
// exit - systemd's Restart=always brings a fresh, known-good process back in ~3 seconds either way.
process.on('unhandledRejection', (reason) => {
  app.log.error(reason, 'unhandled promise rejection (continuing)');
});
process.on('uncaughtException', (err) => {
  app.log.fatal(err, 'uncaught exception, exiting for a clean restart');
  process.exit(1);
});

await app.register(cookie);
await registerHardening(app);
await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

// keep the raw JSON text around: the WHMCS webhook signature covers the exact bytes sent
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  try {
    done(null, body === '' ? {} : JSON.parse(body as string));
  } catch (err) {
    (err as { statusCode?: number }).statusCode = 400;
    done(err as Error, undefined);
  }
});

registerRelease(app);
registerWhmcs(app);
registerManage(app);
registerTools(app);
registerTokens(app);
registerSshKeys(app);
registerMcp(app);
registerOAuth(app);
registerVpsPlans(app);

// ---- auth -----------------------------------------------------------------

const loginFails = new FailureLimiter(5, 15 * 60_000);
const agentFails = new FailureLimiter(10, 10 * 60_000);

app.post('/api/login', ipLimit(20), async (req, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
  const failKey = `${req.ip}|${body.data.email.toLowerCase()}`;
  if (loginFails.blocked(failKey)) return reply.code(429).send({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const { rows } = await pool.query('select id, name, email, password_hash from clients where email = $1', [body.data.email.toLowerCase()]);
  const client = rows[0];
  // verify against a dummy hash when the account is missing so timing does not reveal which emails exist
  const ok = await verifyPassword(body.data.password, client?.password_hash ?? '00:00');
  if (!client || !ok) { loginFails.fail(failKey); return reply.code(401).send({ error: 'Wrong email or password' }); }
  loginFails.clear(failKey);
  await startSession(reply, client.id);
  await audit(client.id, null, 'login', { email: client.email }, null, requestContext(req));
  return { id: client.id, name: client.name, email: client.email };
});

app.post('/api/logout', async (req, reply) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await pool.query('delete from sessions where token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

app.get('/api/me', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  return client;
});

// ---- servers --------------------------------------------------------------

const serverCols = `s.id, s.name, s.provider, s.status, host(s.ip) as ip, s.region, s.plan, s.os, s.created_at, s.suspended_at, s.reinstall_started_at, s.whmcs_service_id`;
const latestCpu = `(select cpu from heartbeats h where h.server_id = s.id order by at desc limit 1) as cpu`;

// Where a server came from decides who owns its lifecycle:
//   whmcs    - provisioned by the WHMCS module; only WHMCS may suspend/terminate it
//   imported - connected by the client with the enroll script; safe to unlink from the panel
//   panel    - created by the panel's own provider adapter (not billing-managed)
type ManagedBy = 'whmcs' | 'imported' | 'panel';

function withSource<T extends { provider: string; whmcs_service_id: number | null }>(row: T) {
  const { whmcs_service_id: whmcsServiceId, ...rest } = row;
  const managedBy: ManagedBy = whmcsServiceId ? 'whmcs' : row.provider === 'imported' ? 'imported' : 'panel';
  return { ...rest, whmcsServiceId, managedBy };
}

async function ownedServerId(client: { id: string }, id: string): Promise<boolean> {
  if (!z.string().uuid().safeParse(id).success) return false;
  return (await pool.query('select 1 from servers where id = $1 and client_id = $2', [id, client.id])).rowCount === 1;
}

app.get('/api/servers', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  const { rows } = await pool.query(`select ${serverCols}, ${latestCpu} from servers s where s.client_id = $1 and s.terminated_at is null order by s.created_at desc`, [client.id]);
  return rows.map((r) => ({ ...withSource(r), agentConnected: agents.has(r.id) }));
});

app.get<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Not found' });
  const { rows } = await pool.query(
    `select ${serverCols}, ${latestCpu}, k.agent_version, k.last_seen_at
     from servers s left join agent_keys k on k.server_id = s.id where s.id = $1 and s.client_id = $2 and s.terminated_at is null`,
    [req.params.id, client.id],
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
  const adapter = getAdapter(rows[0].provider);
  const agentConnected = agents.has(rows[0].id);
  return {
    ...withSource(rows[0]),
    agentConnected,
    capabilities: {
      ...adapter.capabilities,
      rebuild: adapter.capabilities.rebuild || agentConnected || !!rows[0].reinstall_started_at,
    },
  };
});

// Unlink a server the client connected themselves. The machine is left untouched: this only drops
// the panel's keys and tokens and hides the server. A WHMCS service is refused - deleting it here
// would leave WHMCS billing for a server that no longer reports, so that lifecycle stays in WHMCS.
app.delete<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Not found' });
  const { rows } = await pool.query(
    'select provider, whmcs_service_id, terminated_at from servers where id = $1 and client_id = $2',
    [req.params.id, client.id],
  );
  const server = rows[0];
  if (!server || server.terminated_at) return reply.code(404).send({ error: 'Not found' });
  if (server.whmcs_service_id) {
    return reply.code(409).send({
      error: 'This server belongs to a WHMCS service. Suspend or terminate it from WHMCS — the panel follows that status and won\'t delete it here.',
    });
  }
  if (server.provider !== 'imported') {
    return reply.code(409).send({ error: 'Only servers connected from an external source can be removed from the panel.' });
  }

  agents.get(req.params.id)?.socket.close(4005, 'removed from panel');
  await pool.query('delete from agent_keys where server_id = $1', [req.params.id]);
  await pool.query('delete from enroll_tokens where server_id = $1', [req.params.id]);
  await pool.query(`update servers set terminated_at = now(), status = 'stopped', suspended_at = null where id = $1`, [req.params.id]);
  await audit(client.id, req.params.id, 'server.removed', {}, null, requestContext(req));
  return { ok: true };
});

// 24 hourly CPU averages (oldest first, null where the agent was silent) plus the latest reading.
app.get<{ Params: { id: string } }>('/api/servers/:id/metrics', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  if (!(await ownedServerId(client, req.params.id))) return reply.code(404).send({ error: 'Not found' });
  const points = await pool.query(
    `select g.t, avg(h.cpu)::float as cpu
     from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g(t)
     left join heartbeats h on h.server_id = $1 and h.at >= g.t and h.at < g.t + interval '1 hour'
     group by g.t order by g.t`,
    [req.params.id],
  );
  const latest = await pool.query(
    `select at, cpu, mem_used::float as "memUsed", mem_total::float as "memTotal", disk_used::float as "diskUsed", disk_total::float as "diskTotal", uptime::float as uptime
     from heartbeats where server_id = $1 order by at desc limit 1`,
    [req.params.id],
  );
  return { points: points.rows, latest: latest.rows[0] ?? null };
});

// Full history for the Activity page, newest first, paged by id. Only the client's own servers.
app.get<{ Querystring: { server?: string; before?: string; limit?: string } }>('/api/audit', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  const server = req.query.server && z.string().uuid().safeParse(req.query.server).success ? req.query.server : null;
  if (req.query.server && !server) return reply.code(400).send({ error: 'Invalid server' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = Number(req.query.before) || null;
  const { rows } = await pool.query(
    `select a.id, a.action, a.at, a.meta, a.client_id is null as system, a.via, a.ip_address, a.user_agent, a.location,
        s.id as "serverId", coalesce(s.name, 'Account') as server
     from audit_log a left join servers s on s.id = a.server_id
     where (s.client_id = $1 or (s.id is null and a.client_id = $1)) and ($2::uuid is null or s.id = $2) and ($3::bigint is null or a.id < $3)
     order by a.id desc limit $4`,
    [client.id, server, before, limit + 1],
  );
  const page = rows.slice(0, limit).map((r) => ({ ...r, id: Number(r.id) }));
  return { items: page, next: rows.length > limit ? page[page.length - 1].id : null };
});

app.get('/api/activity', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  const { rows } = await pool.query(
    `select a.id, a.action, a.at, a.ip_address, a.user_agent, a.location, a.via, s.name as server
     from audit_log a join servers s on s.id = a.server_id
     where s.client_id = $1 and a.action in ('server.import', 'agent.connected', 'terminal.open')
     order by a.at desc limit 6`,
    [client.id],
  );
  return rows;
});

// "Connect existing VPS": creates an imported server plus a one-time token valid for 30 minutes.
app.post('/api/servers/import', async (req, reply) => {
  const client = await clientFromRequest(req);
  if (!client) return reply.code(401).send({ error: 'Not signed in' });
  const body = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
  const { rows } = await pool.query(`insert into servers (client_id, name, provider, status) values ($1, $2, 'imported', 'provisioning') returning id`, [client.id, body.data.name]);
  const token = randomToken(24);
  await pool.query(`insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, $2, now() + interval '30 minutes')`, [rows[0].id, sha256(token)]);
  await audit(client.id, rows[0].id, 'server.import', {}, null, requestContext(req));
  return { serverId: rows[0].id, token, expiresInMinutes: 30, panelUrl: process.env.PUBLIC_PANEL_URL ?? '' };
});

// ---- agent websocket ------------------------------------------------------

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

async function enroll(token: string, version: string): Promise<{ serverId: string; key: string } | null> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    // single-use: only an unused, unexpired token flips used_at, so a replay finds no row
    const t = await db.query(
      `update enroll_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning server_id`,
      [sha256(token)],
    );
    if (!t.rows[0]) {
      await db.query('rollback');
      return null;
    }
    const serverId = t.rows[0].server_id as string;
    const key = randomToken();
    await db.query(
      `insert into agent_keys (server_id, key_hash, agent_version) values ($1, $2, $3)
       on conflict (server_id) do update set key_hash = excluded.key_hash, agent_version = excluded.agent_version, created_at = now()`,
      [serverId, sha256(key), version],
    );
    await db.query('commit');
    return { serverId, key };
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    db.release();
  }
}

async function authenticate(serverId: string, key: string, version: string): Promise<boolean> {
  const { rows } = await pool.query('select key_hash, next_key_hash from agent_keys where server_id = $1', [serverId]);
  if (!rows[0]) return false;
  const presented = sha256(key);
  const matches = (h: string | null) => !!h && h.length === presented.length && timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(presented, 'hex'));
  if (matches(rows[0].next_key_hash)) {
    // the agent stored the replacement key: it becomes the only valid one
    await pool.query('update agent_keys set key_hash = next_key_hash, next_key_hash = null, key_set_at = now(), agent_version = $2 where server_id = $1', [serverId, version]);
    await audit(null, serverId, 'agent.key_rotated');
    return true;
  }
  if (!matches(rows[0].key_hash)) return false;
  await pool.query('update agent_keys set agent_version = $2 where server_id = $1', [serverId, version]);
  return true;
}

app.get('/agent', { websocket: true, ...ipLimit(300) }, (socket, req) => {
  let conn: AgentConn | null = null;
  const ip = req.ip;
  if (agentFails.blocked(ip)) return socket.close(4008, 'too many failed attempts');
  // a half-open connection (cable pulled, NAT dropped) never sends a close: ping, and cut the line if no pong comes back
  let alive = true;
  socket.on('pong', () => { alive = true; });
  const pinger = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 25_000);
  const authTimer = setTimeout(() => socket.close(4001, 'auth timeout'), 10_000);

  const attach = async (serverId: string) => {
    clearTimeout(authTimer);
    const old = agents.get(serverId);
    if (old) old.socket.close(4002, 'replaced by newer connection');
    conn = { socket, serverId, terminals: new Map(), pending: new Map(), lastStored: 0 };
    agents.set(serverId, conn);
    await pool.query(`update servers set status = 'running', reinstall_started_at = null where id = $1 and status in ('provisioning', 'agent_offline', 'stopped')`, [serverId]);
    await pool.query('update servers set reinstall_started_at = null where id = $1', [serverId]);
    await pool.query('update servers set last_seen_ip = $2::inet where id = $1', [serverId, ip]).catch(() => {});
    // an imported server has no provider-reported address; the IP it actually dials in from is the real one
    await pool.query('update servers set ip = $2::inet where id = $1 and ip is null', [serverId, ip]).catch(() => {});
    await audit(null, serverId, 'agent.connected');
    send(socket, { type: 'ready' });
    await pool.query('update servers set offline_since = null where id = $1', [serverId]);
    const k = await pool.query(`select 1 from agent_keys where server_id = $1 and key_set_at < now() - make_interval(days => $2)`, [serverId, Number(process.env.KEY_ROTATE_AFTER_DAYS ?? 30)]);
    if (k.rowCount) await rotateKey(conn!);
  };

  const handleMessage = async (raw: import('ws').RawData) => {
    let msg;
    try {
      msg = AgentMessage.parse(JSON.parse(raw.toString()));
    } catch {
      return socket.close(4003, 'bad message');
    }
    try {
      if (!conn) {
        if (msg.type === 'hello') {
          const res = await enroll(msg.token, msg.version);
          if (!res) {
            agentFails.fail(ip);
            send(socket, { type: 'error', message: 'Invalid, used or expired enroll token' });
            return socket.close(4004, 'enroll rejected');
          }
          send(socket, { type: 'enrolled', serverId: res.serverId, key: res.key });
          await attach(res.serverId);
        } else if (msg.type === 'auth') {
          if (!(await authenticate(msg.serverId, msg.key, msg.version))) {
            agentFails.fail(ip);
            send(socket, { type: 'error', message: 'Bad credentials' });
            return socket.close(4004, 'auth rejected');
          }
          await attach(msg.serverId);
        } else {
          socket.close(4003, 'must authenticate first');
        }
        return;
      }

      switch (msg.type) {
        case 'heartbeat': {
          const now = Date.now();
          await pool.query('update agent_keys set last_seen_at = now() where server_id = $1', [conn.serverId]);
          await pool.query("update servers set status = 'running' where id = $1 and status in ('stopped', 'agent_offline') and suspended_at is null", [conn.serverId]);
          if (now - conn.lastStored >= HEARTBEAT_STORE_EVERY_MS) {
            conn.lastStored = now;
            await pool.query(
              `insert into heartbeats (server_id, cpu, mem_used, mem_total, disk_used, disk_total, uptime) values ($1,$2,$3,$4,$5,$6,$7)`,
              [conn.serverId, msg.cpu, msg.memUsed, msg.memTotal, msg.diskUsed, msg.diskTotal, msg.uptime],
            );
          }
          break;
        }
        case 'sysinfo': {
          // os always refreshes (a manual reinstall changes it); vcpu/ramGb/diskGb only fill gaps so a
          // provider-provisioned plan (the authoritative, billed spec) is never overwritten by a measurement.
          const ramGb = msg.ramTotal ? msg.ramTotal / 1024 ** 3 : null;
          const diskGb = msg.diskTotal ? msg.diskTotal / 1024 ** 3 : null;
          await pool.query(
            `update servers set
               os = coalesce($2, os),
               plan = plan || jsonb_strip_nulls(jsonb_build_object(
                 'vcpu', case when plan ? 'vcpu' then null else $3::int end,
                 'ramGb', case when plan ? 'ramGb' then null else $4::numeric end,
                 'diskGb', case when plan ? 'diskGb' then null else $5::numeric end
               ))
             where id = $1`,
            [conn.serverId, msg.os || null, msg.vcpu ?? null, ramGb, diskGb],
          );
          break;
        }
        case 'term.out': {
          const browser = conn.terminals.get(msg.sid);
          if (browser?.readyState === browser?.OPEN) browser?.send(Buffer.from(msg.data, 'base64'), { binary: true });
          break;
        }
        case 'term.exit': {
          const browser = conn.terminals.get(msg.sid);
          conn.terminals.delete(msg.sid);
          browser?.close(1000, 'shell exited');
          break;
        }
        case 'rpc.result':
          onRpcResult(conn, msg);
          break;
        case 'job.log':
          await onJobLog(conn, msg.jobId, msg.data);
          break;
        case 'job.done':
          await onJobDone(conn, msg.jobId, msg.code);
          break;
        default:
          break;
      }
    } catch (err) {
      app.log.error(err, 'agent message failed');
      socket.close(1011, 'server error');
    }
  };
  // one at a time, in arrival order: a job.done must never overtake the job.log lines before it
  let queue: Promise<void> = Promise.resolve();
  socket.on('message', (raw) => {
    queue = queue.then(() => handleMessage(raw));
  });

  socket.on('close', async () => {
    clearTimeout(authTimer);
    clearInterval(pinger);
    if (!conn) return;
    for (const browser of conn.terminals.values()) browser.close(1001, 'agent disconnected');
    failPending(conn);
    await failRunningJobs(conn.serverId).catch(() => {});
    // a newer connection may already have replaced this one
    if (agents.get(conn.serverId) === conn) {
      agents.delete(conn.serverId);
      await pool.query(`update servers set status = 'agent_offline', offline_since = now() where id = $1 and status = 'running'`, [conn.serverId]).catch(() => {});
      await audit(null, conn.serverId, 'agent.disconnected').catch(() => {});
    }
  });
});

// ---- browser terminal relay ----------------------------------------------

app.get<{ Params: { id: string } }>('/ws/terminal/:id', { websocket: true }, async (socket, req) => {
  // messages that arrive while we authorize are buffered, then replayed
  const early: Buffer[] = [];
  const buffer = (raw: Buffer) => early.push(raw);
  socket.on('message', buffer);

  const client = await clientFromRequest(req);
  const serverId = req.params.id;
  const owns =
    client && z.string().uuid().safeParse(serverId).success
      ? (await pool.query('select 1 from servers where id = $1 and client_id = $2 and suspended_at is null and terminated_at is null', [serverId, client.id])).rowCount === 1
      : false;
  if (!client || !owns) return socket.close(4403, 'forbidden');
  const agent = agents.get(serverId);
  if (!agent) return socket.close(4404, 'agent offline');

  const sid = randomUUID();
  const termCtx = requestContext(req);
  agent.terminals.set(sid, socket);
  await audit(client.id, serverId, 'terminal.open', { sid }, null, termCtx);
  let opened = false;

  const handle = (raw: Buffer) => {
    let msg;
    try {
      msg = BrowserTermMessage.parse(JSON.parse(raw.toString()));
    } catch {
      return;
    }
    if (msg.type === 'resize') {
      if (!opened) {
        opened = true;
        send(agent.socket, { type: 'term.open', sid, cols: msg.cols, rows: msg.rows });
      } else {
        send(agent.socket, { type: 'term.resize', sid, cols: msg.cols, rows: msg.rows });
      }
    } else if (opened) {
      send(agent.socket, { type: 'term.in', sid, data: msg.data });
    }
  };

  socket.off('message', buffer);
  socket.on('message', handle);
  for (const raw of early) handle(raw);

  socket.on('close', () => {
    if (agent.terminals.delete(sid)) send(agent.socket, { type: 'term.close', sid });
    audit(client.id, serverId, 'terminal.close', { sid }, null, termCtx).catch(() => {});
  });
});

// production: the API also serves the built web app, so one process and one origin handle everything
if (process.env.SERVE_WEB === 'true' || process.env.NODE_ENV === 'production') {
  if (!existsSync(join(webDist, 'index.html'))) { console.error('web app is not built: run pnpm --filter @snbd/web build'); process.exit(1); }
  await app.register(fastifyStatic, { root: webDist, wildcard: false, setHeaders: (res, path) => { if (path.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable'); } });
  app.setNotFoundHandler((req, reply) => {
    const api = /^\/(api|dl|ws|agent|webhooks|enroll|sso|mcp|oauth|\.well-known|install\.sh)(\/|$)/.test(req.url);
    if (req.method === 'GET' && !api) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
}

// a restart loses every agent connection, so no job can still be running
await pool.query("update jobs set status = 'failed', finished_at = now() where status in ('queued', 'running')");

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
startMaintenance(app.log);
startMonitor(app.log);
