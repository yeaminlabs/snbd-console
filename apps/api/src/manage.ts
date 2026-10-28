import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startAgentReinstall } from './agentReinstall.js';
import { RpcError } from './agentRpc.js';
import { buildUserData } from './cloudinit.js';
import { audit, pool, randomToken, sha256, requestContext } from './db.js';
import { OS_CATALOG, findOs } from './os.js';
import { ProviderError, getAdapter, type ProviderServer } from './providers/index.js';
import { agents } from './registry.js';
import { clientFromRequest } from './session.js';

const REINSTALL_TOKEN_HOURS = 2;
const REINSTALL_LOCK_MINUTES = 20; // a stuck reinstall can be retried after this

interface Owned extends ProviderServer {
  status: string;
  os: string | null;
}

export async function ownedServer(client: { id: string }, id: string): Promise<Owned | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { rows } = await pool.query(
    `select id, name, provider, provider_ref as "providerRef", status, os from servers
     where id = $1 and client_id = $2 and terminated_at is null and suspended_at is null`,
    [id, client.id],
  );
  return rows[0] ?? null;
}

function providerFailure(err: unknown) {
  if (err instanceof ProviderError) return { status: err.code === 'unsupported' ? 501 : 502, error: err.code === 'unsupported' ? err.message : 'The hosting provider rejected the request. Try again shortly.' };
  return { status: 500, error: 'Internal error' };
}

export function registerManage(app: FastifyInstance) {
  app.get('/api/os-images', async (req, reply) => {
    if (!(await clientFromRequest(req))) return reply.code(401).send({ error: 'Not signed in' });
    return OS_CATALOG;
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/power', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const body = z.object({ action: z.enum(['start', 'stop', 'reboot']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid action' });
    const server = await ownedServer(client, req.params.id);
    if (!server) return reply.code(404).send({ error: 'Not found' });
    const adapter = getAdapter(server.provider);
    if (!adapter.capabilities.power) return reply.code(501).send({ error: 'Power control is not available for this server' });

    try {
      await adapter.power(server, body.data.action);
    } catch (err) {
      req.log.error(err, 'power failed');
      const f = providerFailure(err);
      return reply.code(f.status).send({ error: f.error });
    }
    if (body.data.action === 'stop') await pool.query("update servers set status = 'stopped' where id = $1", [server.id]);
    if (body.data.action === 'start') await pool.query("update servers set status = 'agent_offline' where id = $1 and status = 'stopped'", [server.id]);
    await audit(client.id, server.id, `power.${body.data.action}`, {}, null, requestContext(req));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/reinstall', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const body = z.object({ os: z.string(), acknowledged: z.literal(true) }).safeParse(req.body);
    if (!body.success || !findOs(body.data.os)) return reply.code(400).send({ error: 'Choose a system and confirm that your data will be erased' });
    const server = await ownedServer(client, req.params.id);
    if (!server) return reply.code(404).send({ error: 'Not found' });
    const adapter = getAdapter(server.provider);
    const canRebuild = adapter.capabilities.rebuild;
    const canAgent = agents.has(server.id);
    if (!canRebuild && !canAgent) {
      return reply.code(501).send({ error: 'Reinstall needs the panel agent: start this server and wait for it to connect, then try again' });
    }

    // one reinstall at a time; the lock also stops a double click from wiping a half-installed disk
    const lock = await pool.query(
      `update servers set reinstall_started_at = now()
       where id = $1 and (reinstall_started_at is null or reinstall_started_at < now() - make_interval(mins => $2)) returning 1`,
      [server.id, REINSTALL_LOCK_MINUTES],
    );
    if (!lock.rowCount) return reply.code(409).send({ error: 'A reinstall is already in progress' });

    // the new token goes out inside user-data first: if the provider refuses, nothing has been touched
    await pool.query('delete from enroll_tokens where server_id = $1 and used_at is null', [server.id]);
    const token = randomToken(24);
    await pool.query(`insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, $2, now() + make_interval(hours => $3))`, [server.id, sha256(token), REINSTALL_TOKEN_HOURS]);
    const panelUrl = (process.env.PUBLIC_PANEL_URL ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');

    let rootPassword: string | undefined;
    try {
      if (canRebuild) {
        ({ rootPassword } = await adapter.rebuild(server, { image: body.data.os, userData: buildUserData(panelUrl, token) }));
      } else {
        // no provider rebuild: drive bin456789/reinstall through the agent, which re-enrolls itself
        const os = findOs(body.data.os)!;
        rootPassword = await startAgentReinstall(server.id, os.reinstallArgs, `${panelUrl}/enroll/${token}`);
      }
    } catch (err) {
      req.log.error(err, 'reinstall failed');
      await pool.query('delete from enroll_tokens where server_id = $1 and used_at is null', [server.id]);
      await pool.query('update servers set reinstall_started_at = null where id = $1', [server.id]);
      await audit(client.id, server.id, 'reinstall.failed', { os: body.data.os }, null, requestContext(req));
      if (err instanceof RpcError) return reply.code(err.status >= 500 ? 502 : err.status).send({ error: err.message });
      const f = providerFailure(err);
      return reply.code(f.status).send({ error: f.error });
    }

    // the disk is gone: the old agent and its key are dead, so cut them off
    await pool.query('delete from agent_keys where server_id = $1', [server.id]);
    await pool.query("update servers set status = 'provisioning', os = $2 where id = $1", [server.id, body.data.os]);
    const live = agents.get(server.id);
    for (const t of live?.terminals.values() ?? []) t.close(1001, 'server is being reinstalled');
    live?.socket.close(4006, 'reinstall');
    await audit(client.id, server.id, 'server.reinstall', { os: body.data.os }, null, requestContext(req));

    // shown once and never stored
    reply.header('cache-control', 'no-store');
    return { ok: true, rootPassword };
  });
}
