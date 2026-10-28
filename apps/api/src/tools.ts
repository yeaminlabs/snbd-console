import { randomInt, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { APPS, CHECK_SCRIPT, findApp, loadRecipe, parseProgress } from './apps.js';
import { RpcError, rpc, sendToAgent } from './agentRpc.js';
import { audit, pool, requestContext } from './db.js';
import { ownedServer } from './manage.js';
import { clientFromRequest } from './session.js';

const EDIT_MAX = 2 * 1024 * 1024;
const UPLOAD_MAX = 200 * 1024 * 1024;
const PART = 1024 * 1024;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

const AbsPath = z.string().min(1).max(4096).startsWith('/');
const FileName = z.string().min(1).max(255).refine((n) => !n.includes('/') && n !== '.' && n !== '..' && !n.includes('\0'), 'bad file name');

type Req = { cookies: Record<string, string | undefined>; params: { id: string } };

/** Signed-in client who owns an active server, or an HTTP error already sent. */
async function guard(req: Req, reply: FastifyReply) {
  const client = await clientFromRequest(req);
  if (!client) { reply.code(401).send({ error: 'Not signed in' }); return null; }
  const server = await ownedServer(client, req.params.id);
  if (!server) { reply.code(404).send({ error: 'Not found' }); return null; }
  return { client, server };
}

const fail = (reply: FastifyReply, err: unknown) => {
  if (err instanceof RpcError) return reply.code(err.status).send({ error: err.message });
  reply.log.error(err);
  return reply.code(500).send({ error: 'Internal error' });
};

export function registerTools(app: FastifyInstance) {
  // raw file bodies arrive as a stream so large uploads are never held in memory
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  // ---- files ----------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/servers/:id/files', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const path = AbsPath.safeParse(req.query.path ?? '/');
    if (!path.success) return reply.code(400).send({ error: 'Invalid path' });
    try { return await rpc(g.server.id, 'fs.list', { path: path.data }); } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/servers/:id/files/content', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const path = AbsPath.safeParse(req.query.path);
    if (!path.success) return reply.code(400).send({ error: 'Invalid path' });
    try {
      const st = await rpc<{ size: number; dir: boolean }>(g.server.id, 'fs.stat', { path: path.data });
      if (st.dir) return reply.code(400).send({ error: 'This is a folder' });
      if (st.size > EDIT_MAX) return reply.code(413).send({ error: 'File is too large to edit here. Download it instead.' });
      const parts: Buffer[] = [];
      for (let offset = 0; offset < st.size; ) {
        const r = await rpc<{ data: string; eof: boolean }>(g.server.id, 'fs.read', { path: path.data, offset, length: PART });
        const b = Buffer.from(r.data, 'base64');
        if (!b.length) break;
        parts.push(b);
        offset += b.length;
      }
      const buf = Buffer.concat(parts);
      if (buf.subarray(0, 8192).includes(0)) return reply.code(415).send({ error: 'This looks like a binary file. Download it instead.' });
      return { path: path.data, size: st.size, content: buf.toString('utf8') };
    } catch (e) { return fail(reply, e); }
  });

  app.put<{ Params: { id: string } }>('/api/servers/:id/files/content', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const body = z.object({ path: AbsPath, content: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
    const buf = Buffer.from(body.data.content, 'utf8');
    if (buf.length > 4 * 1024 * 1024) return reply.code(413).send({ error: 'File is too large to save here' });
    try {
      await rpc(g.server.id, 'fs.writefile', { path: body.data.path, data: buf.toString('base64') });
      await audit(g.client.id, g.server.id, 'file.write', { path: body.data.path, bytes: buf.length }, null, requestContext(req));
      return { ok: true, size: buf.length };
    } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/servers/:id/files/download', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const path = AbsPath.safeParse(req.query.path);
    if (!path.success) return reply.code(400).send({ error: 'Invalid path' });
    let st: { size: number; dir: boolean };
    try { st = await rpc(g.server.id, 'fs.stat', { path: path.data }); } catch (e) { return fail(reply, e); }
    if (st.dir) return reply.code(400).send({ error: 'Folders cannot be downloaded yet' });
    const name = path.data.split('/').pop() || 'download';
    await audit(g.client.id, g.server.id, 'file.download', { path: path.data, bytes: st.size }, null, requestContext(req));
    const sid = g.server.id;
    async function* chunks() {
      for (let offset = 0; offset < st.size; ) {
        const r = await rpc<{ data: string }>(sid, 'fs.read', { path: path.data, offset, length: PART });
        const b = Buffer.from(r.data, 'base64');
        if (!b.length) return;
        offset += b.length;
        yield b;
      }
    }
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', st.size)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(Readable.from(chunks()));
  });

  app.put<{ Params: { id: string }; Querystring: { dir?: string; name?: string } }>('/api/servers/:id/files/upload', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const dir = AbsPath.safeParse(req.query.dir), name = FileName.safeParse(req.query.name);
    const stream = req.body as Readable | undefined;
    if (!dir.success || !name.success || !stream || typeof stream.on !== 'function') return reply.code(400).send({ error: 'Invalid upload' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > UPLOAD_MAX) return reply.code(413).send({ error: 'File is larger than 200 MB' });
    const path = (dir.data === '/' ? '' : dir.data.replace(/\/$/, '')) + '/' + name.data;
    let offset = 0, buffered: Buffer[] = [], size = 0;
    const flush = async (last: boolean) => {
      const data = Buffer.concat(buffered);
      buffered = []; size = 0;
      await rpc(g.server.id, 'fs.upload', { path, offset, data: data.toString('base64'), last }, 60_000);
      offset += data.length;
    };
    try {
      for await (const chunk of stream) {
        const b = chunk as Buffer;
        if (offset + size + b.length > UPLOAD_MAX) throw new RpcError(413, 'File is larger than 200 MB');
        buffered.push(b); size += b.length;
        if (size >= PART) await flush(false);
      }
      await flush(true); // the final part, possibly empty, tells the agent to move the file into place
      await audit(g.client.id, g.server.id, 'file.upload', { path, bytes: offset }, null, requestContext(req));
      return { ok: true, size: offset };
    } catch (e) { return fail(reply, e); }
  });

  const pathOps: Array<[string, z.ZodType<Record<string, string>>, (b: any) => [string, object], string]> = [
    ['mkdir', z.object({ path: AbsPath }), (b) => ['fs.mkdir', { path: b.path }], 'file.mkdir'],
    ['rename', z.object({ from: AbsPath, to: AbsPath }), (b) => ['fs.rename', { from: b.from, to: b.to }], 'file.rename'],
    ['delete', z.object({ path: AbsPath }), (b) => ['fs.delete', { path: b.path }], 'file.delete'],
  ];
  for (const [route, schema, toRpc, auditAction] of pathOps) {
    app.post<{ Params: { id: string } }>(`/api/servers/:id/files/${route}`, async (req, reply) => {
      const g = await guard(req, reply); if (!g) return;
      const body = schema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
      const [op, args] = toRpc(body.data);
      try {
        await rpc(g.server.id, op, args);
        await audit(g.client.id, g.server.id, auditAction, body.data, null, requestContext(req));
        return { ok: true };
      } catch (e) { return fail(reply, e); }
    });
  }

  // ---- apps -----------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/servers/:id/apps', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    let installed: Record<string, boolean> | null = null;
    try {
      const r = await rpc<{ out: string }>(g.server.id, 'exec', { script: CHECK_SCRIPT, timeoutMs: 30_000 }, 40_000);
      installed = Object.fromEntries(r.out.split('\n').map((l) => l.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v === '1']));
    } catch (e) {
      if (!(e instanceof RpcError) || e.status !== 503) return fail(reply, e);
    }
    const { rows } = await pool.query(
      `select id, replace(kind, 'install:', '') as app, status from jobs where server_id = $1 order by created_at desc limit 1`,
      [g.server.id],
    );
    return {
      agentConnected: installed !== null,
      apps: APPS.map((a) => ({ id: a.id, name: a.name, tag: a.tag, desc: a.desc, installed: installed ? !!installed[a.id] : null })),
      lastJob: rows[0] ?? null,
    };
  });

  app.post<{ Params: { id: string; app: string } }>('/api/servers/:id/apps/:app/install', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const def = findApp(req.params.app);
    const script = def && loadRecipe(def.id);
    if (!def || !script) return reply.code(404).send({ error: 'Unknown app' });
    let jobId = randomUUID();
    try {
      await pool.query(`insert into jobs (id, server_id, kind, status) values ($1, $2, $3, 'queued')`, [jobId, g.server.id, `install:${def.id}`]);
    } catch (e: any) {
      if (e?.code === '23505') return reply.code(409).send({ error: 'Another install is already running on this server' });
      throw e;
    }
    if (!sendToAgent(g.server.id, { type: 'job.start', jobId, script })) {
      await pool.query(`update jobs set status = 'failed', finished_at = now(), log = 'The server agent is offline' where id = $1`, [jobId]);
      return reply.code(503).send({ error: 'The server agent is offline' });
    }
    await audit(g.client.id, g.server.id, 'app.install', { app: def.id, jobId }, null, requestContext(req));
    return { jobId };
  });

  app.get<{ Params: { id: string; job: string }; Querystring: { from?: string } }>('/api/servers/:id/jobs/:job', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    if (!z.string().uuid().safeParse(req.params.job).success) return reply.code(404).send({ error: 'Not found' });
    const from = Math.max(0, Number(req.query.from ?? 0) || 0);
    const { rows } = await pool.query(
      `select status, replace(kind, 'install:', '') as app, length(log) as len, substr(log, $3 + 1) as chunk, log
       from jobs where id = $1 and server_id = $2`,
      [req.params.job, g.server.id, from],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    const { status, app: appId, len, chunk, log } = rows[0];
    const prog = parseProgress(log, status === 'done');
    reply.header('cache-control', 'no-store');
    return { status, app: appId, offset: Number(len), log: chunk, pct: prog.pct, step: prog.step };
  });

  app.post<{ Params: { id: string; job: string } }>('/api/servers/:id/jobs/:job/cancel', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    if (!z.string().uuid().safeParse(req.params.job).success) return reply.code(404).send({ error: 'Not found' });
    const { rowCount } = await pool.query(`select 1 from jobs where id = $1 and server_id = $2 and status in ('queued', 'running')`, [req.params.job, g.server.id]);
    if (!rowCount) return reply.code(409).send({ error: 'Nothing to cancel' });
    sendToAgent(g.server.id, { type: 'job.cancel', jobId: req.params.job });
    await audit(g.client.id, g.server.id, 'app.cancel', { jobId: req.params.job }, null, requestContext(req));
    return { ok: true };
  });

  // ---- password -------------------------------------------------------------
  // The new password is made here, set by the agent, shown once and never stored.
  app.post<{ Params: { id: string } }>('/api/servers/:id/password-reset', async (req, reply) => {
    const g = await guard(req, reply); if (!g) return;
    const password = Array.from({ length: 20 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
    try {
      await rpc(g.server.id, 'setpassword', { user: 'root', password });
    } catch (e) { return fail(reply, e); }
    await audit(g.client.id, g.server.id, 'password.reset', { user: 'root' }, null, requestContext(req));
    reply.header('cache-control', 'no-store');
    return { user: 'root', password };
  });
}
