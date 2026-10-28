import pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AuditContext {
  ip?: string;
  userAgent?: string;
  location?: string;
}

function isPrivateIP(ip?: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (ip.startsWith('172.') && (second < 16 || second > 31)) return false;
    return true;
  }
  return false;
}

export function formatLocation(ip?: string): string {
  if (!ip) return 'Unknown';
  if (isPrivateIP(ip)) return 'Local network';
  return 'Remote';
}

export function parseDevice(ua?: string): { name: string; os: string; browser: string } {
  if (!ua) return { name: 'Unknown', os: 'Unknown', browser: 'Unknown' };
  const os = /Windows NT 10/.test(ua) ? 'Windows 10/11'
    : /Windows NT/.test(ua) ? 'Windows'
    : /Mac OS X|macOS/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /curl|wget|httpie|python-requests|node-fetch|undici/.test(ua) ? 'CLI / Script'
    : 'Browser';
  const name = browser === 'CLI / Script' ? `${os} · CLI` : `${os} · ${browser}`;
  return { name, os, browser };
}

export function requestContext(req: FastifyRequest): AuditContext {
  const ip = req.ip;
  const userAgent = String(req.headers['user-agent'] ?? '');
  return {
    ip,
    userAgent,
    location: formatLocation(ip),
  };
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});
// node-postgres emits "error" on the pool whenever an IDLE client's connection dies underneath it
// (a Postgres restart, a dropped network connection, `pg_terminate_backend`, a backend restart from
// routine OS package updates, ...). That client is simply discarded and a fresh one is opened on the
// next query - but an EventEmitter "error" with no listener is fatal in Node, so without this handler
// the entire API process crashes. This single line is the fix for that whole class of outage.
pool.on('error', (err) => {
  console.error('idle Postgres client error (pool will reconnect on next query):', err);
});

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export async function audit(clientId: string | null, serverId: string | null, action: string, meta: object = {}, via: string | null = null, ctx: AuditContext = {}, sessionId: string | null = null) {
  await pool.query(
    'insert into audit_log (client_id, server_id, action, meta, via, ip_address, user_agent, location, session_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [clientId, serverId, action, meta, via, ctx.ip ?? null, ctx.userAgent ?? null, ctx.location ?? null, sessionId],
  );
}
