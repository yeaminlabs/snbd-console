import type { FastifyReply } from 'fastify';
import { pool, randomToken, sha256 } from './db.js';

export const SESSION_COOKIE = 'snbd_session';
export const SESSION_DAYS = 14;

export async function startSession(reply: FastifyReply, clientId: string) {
  const token = randomToken();
  await pool.query(`insert into sessions (token_hash, client_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`, [sha256(token), clientId, SESSION_DAYS]);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clientFromRequest(req: { cookies: Record<string, string | undefined> }) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await pool.query(
    `select c.id, c.email, c.name from sessions s join clients c on c.id = s.client_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  return (rows[0] as { id: string; email: string; name: string } | undefined) ?? null;
}
