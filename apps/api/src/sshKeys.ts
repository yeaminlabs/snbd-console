import { createHash, randomBytes, generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RpcError, rpc } from './agentRpc.js';
import { audit, pool } from './db.js';
import { agents } from './registry.js';
import { clientFromRequest } from './session.js';

const MAX_KEYS_PER_CLIENT = 20;
// The console always manages root's keys on a real VPS. The env override exists only so the local
// smoke script can complete the round-trip as an unprivileged test user.
const SSH_USER = process.env.SSH_USER ?? 'root';

type Req = { cookies: Record<string, string | undefined> };

// ---- key formatting (no passphrase: the customer downloads the key and manages its own protection)

function sshString(b: Buffer | string): Buffer {
  const v = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(v.length);
  return Buffer.concat([len, v]);
}

/** SHA256:xxx fingerprint — the same shape `ssh-keygen -lf` prints. */
function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

/** Panel-generated ed25519 pair. Returns everything once; the private half is never stored. */
export function generateEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // SPKI DER ends with the raw 32-byte point
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const point = Buffer.from(der.subarray(der.length - 32));
  const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(point)]);
  const publicKeyLine = 'ssh-ed25519 ' + pubBlob.toString('base64') + ' snbd-console generated key';

  // OpenSSH container: checkints, key blob, then seed||point as the private half
  const seed = (function () {
    const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
    return Buffer.from(pkcs8.subarray(pkcs8.length - 32));
  })();
  const check = randomBytes(4);
  let privPart = Buffer.concat([
    check, Buffer.from(check), // two identical checkints
    sshString('ssh-ed25519'), sshString(point), sshString(Buffer.concat([seed, point])),
    sshString(''), // empty comment
  ]);
  let pad = 1;
  while (privPart.length % 8 !== 0) privPart = Buffer.concat([privPart, Buffer.from([pad++])]);
  const head = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString('none'), sshString('none'), sshString(''),
    (function () { const b = Buffer.alloc(4); b.writeUInt32BE(1); return b; })(),
    sshString(pubBlob), sshString(privPart),
  ]);
  const b64 = head.toString('base64');
  const pem = ['-----BEGIN OPENSSH PRIVATE KEY-----', ...(b64.match(/.{1,70}/g) ?? []), '-----END OPENSSH PRIVATE KEY-----', ''].join('\n');
  return { publicKeyLine, fingerprint: fingerprintOf(pubBlob), privateKeyPem: pem };
}

/** Validates an imported public key line; keeps only the "type base64" part and its fingerprint. */
export function parsePublicKey(line: string): { blob: Buffer; keyType: string; normalized: string; fingerprint: string } {
  line = line.trim();
  if (!line || line.length > 8192 || /[\r\n\0]/.test(line)) throw new Error('Not a valid SSH public key');
  const parts = line.split(/\s+/);
  if (parts.length < 2 || !['ssh-ed25519', 'ssh-rsa'].includes(parts[0])) throw new Error('Only ssh-ed25519 and ssh-rsa public keys can be imported');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1])) throw new Error('That key material is not valid base64');
  const blob = Buffer.from(parts[1], 'base64');
  if (blob.length < 20 || blob.length > 65536) throw new Error('That key is too short or too large to be real');
  const n = blob.readUInt32BE(0);
  if (n > blob.length - 4 || blob.subarray(4, 4 + n).toString('utf8') !== parts[0]) throw new Error('Key label does not match its contents');
  if (parts[0] === 'ssh-ed25519' && blob.length !== 4 + n + 4 + 32) throw new Error('Corrupt ssh-ed25519 key');
  return { blob, keyType: parts[0], normalized: parts.slice(0, 2).join(' '), fingerprint: fingerprintOf(blob) };
}

async function ownedKey(clientId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return (await pool.query(
    `select id, name, key_type, public_key, fingerprint from ssh_keys where id = $1 and client_id = $2`,
    [id, clientId],
  )).rows[0] ?? null;
}

export function registerSshKeys(app: FastifyInstance) {
  app.get('/api/keys', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const keys = (await pool.query(
      `select k.id, k.name, k.key_type, k.public_key, k.fingerprint, k.private_generated as "privateGenerated", k.created_at as "createdAt",
              coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name) order by s.name)
                 from ssh_key_servers ks join servers s on s.id = ks.server_id
                 where ks.key_id = k.id), '[]') as servers
       from ssh_keys k where k.client_id = $1 order by k.created_at desc`,
      [client.id],
    )).rows as { id: string; name: string; key_type: string; public_key: string; fingerprint: string; privateGenerated: boolean; createdAt: string; servers: { id: string; name: string }[] }[];
    return { keys: keys.map((k) => ({ ...k, servers: k.servers.map((s) => ({ ...s, agentOnline: agents.has(s.id) })) })) };
  });

  app.post('/api/keys', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const count = (await pool.query('select count(*)::int as c from ssh_keys where client_id = $1', [client.id])).rows[0].c;
    if (count >= MAX_KEYS_PER_CLIENT) return reply.code(409).send({ error: `You already have ${MAX_KEYS_PER_CLIENT} keys. Remove one first.` });

    const body = z.object({
      name: z.string().trim().min(1).max(64),
      mode: z.enum(['generate', 'import']),
      publicKey: z.string().max(8192).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the key a name' });

    let publicKey: string, fingerprint: string, keyType: string, privateKeyPem: string | null = null;
    try {
      if (body.data.mode === 'generate') {
        const pair = generateEd25519();
        publicKey = pair.publicKeyLine;
        fingerprint = pair.fingerprint;
        keyType = 'ssh-ed25519';
        privateKeyPem = pair.privateKeyPem;
      } else {
        const parsed = parsePublicKey(body.data.publicKey ?? '');
        publicKey = parsed.normalized;
        fingerprint = parsed.fingerprint;
        keyType = parsed.keyType;
      }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Invalid key' });
    }
    if ((await pool.query('select 1 from ssh_keys where client_id = $1 and fingerprint = $2', [client.id, fingerprint])).rowCount) {
      return reply.code(409).send({ error: 'This key is already saved' });
    }

    const key = (await pool.query(
      `insert into ssh_keys (client_id, name, key_type, public_key, fingerprint, private_generated)
       values ($1, $2, $3, $4, $5, $6) returning id, name, key_type as "keyType", public_key as "publicKey", fingerprint, private_generated as "privateGenerated"`,
      [client.id, body.data.name, keyType, publicKey, fingerprint, body.data.mode === 'generate'],
    )).rows[0];
    await audit(client.id, null, body.data.mode === 'generate' ? 'ssh.key.create' : 'ssh.key.import', { name: body.data.name });
    return { key, privateKey: privateKeyPem }; // private half this one time, only for generated keys
  });

  app.delete<{ Params: { id: string } }>('/api/keys/:id', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const key = await ownedKey(client.id, req.params.id);
    if (!key) return reply.code(404).send({ error: 'Not found' });

    const installed = (await pool.query(
      `select s.id, s.name from ssh_key_servers ks join servers s on s.id = ks.server_id
       where ks.key_id = $1 and s.terminated_at is null order by s.name`,
      [key.id],
    )).rows as { id: string; name: string }[];

    // Honest refusal: if any machine holding the key cannot be reached, delete nothing.
    const offline = installed.filter((s) => !agents.has(s.id));
    if (offline.length) {
      return reply.code(409).send({
        error: `The key is still installed on ${offline.map((s) => s.name).join(', ')} whose agent is offline. Reconnect them first, then delete.`,
      });
    }
    for (const srv of installed) {
      try {
        await rpc(srv.id, 'ssh.removekey', { user: SSH_USER, key: key.public_key });
      } catch (err) {
        const msg = err instanceof RpcError ? err.message : 'the agent failed to remove the key';
        return reply.code(502).send({ error: `Could not remove the key from ${srv.name} (${msg}). Nothing was deleted.` });
      }
    }
    await pool.query('delete from ssh_keys where id = $1', [key.id]); // join rows and install record cascade
    await audit(client.id, null, 'ssh.key.delete', { name: key.name });
    return { ok: true, removedFrom: installed.map((s) => s.name) };
  });

  app.post<{ Params: { id: string } }>('/api/keys/:id/install', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const key = await ownedKey(client.id, req.params.id);
    if (!key) return reply.code(404).send({ error: 'Not found' });
    const body = z.object({ serverIds: z.array(z.string().uuid()).max(100) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'No server selected' });

    const servers = (await pool.query(
      `select id, name from servers where client_id = $1 and terminated_at is null and suspended_at is null and id = any($2::uuid[])`,
      [client.id, body.data.serverIds],
    )).rows as { id: string; name: string }[];
    if (servers.length !== new Set(body.data.serverIds).size) return reply.code(400).send({ error: 'One of the selected servers is not yours' });

    const failed: string[] = [];
    for (const srv of servers) {
      try {
        await rpc(srv.id, 'ssh.addkey', { user: SSH_USER, key: key.public_key });
      } catch (err) {
        const msg = err instanceof RpcError ? err.message : 'the agent failed to install the key';
        failed.push(`${srv.name} (${msg})`);
        continue;
      }
      await pool.query('insert into ssh_key_servers (key_id, server_id) values ($1, $2) on conflict do nothing', [key.id, srv.id]);
      await audit(client.id, srv.id, 'ssh.key.install', { keyName: key.name, keyId: key.id });
    }
    if (failed.length) return reply.code(502).send({ error: `Installed where possible; failed on ${failed.join(', ')}.` });
    return { ok: true, installedOn: servers.map((s) => s.name) };
  });

  app.post<{ Params: { id: string } }>('/api/keys/:id/uninstall', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const key = await ownedKey(client.id, req.params.id);
    if (!key) return reply.code(404).send({ error: 'Not found' });
    const body = z.object({ serverIds: z.array(z.string().uuid()).max(100) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'No server selected' });

    const servers = (await pool.query(
      `select s.id, s.name from ssh_key_servers ks join servers s on s.id = ks.server_id
       where ks.key_id = $1 and s.id = any($2::uuid[]) and s.client_id = $3`,
      [key.id, body.data.serverIds, client.id],
    )).rows as { id: string; name: string }[];

    const failed: string[] = [];
    for (const srv of servers) {
      try {
        await rpc(srv.id, 'ssh.removekey', { user: SSH_USER, key: key.public_key });
      } catch (err) {
        const msg = err instanceof RpcError ? err.message : 'the agent failed to remove the key';
        failed.push(`${srv.name} (${msg})`);
        continue;
      }
      await pool.query('delete from ssh_key_servers where key_id = $1 and server_id = $2', [key.id, srv.id]);
      await audit(client.id, srv.id, 'ssh.key.uninstall', { keyName: key.name, keyId: key.id });
    }
    if (failed.length) return reply.code(502).send({ error: `Removed where possible; failed on ${failed.join(', ')}.` });
    return { ok: true };
  });
}
