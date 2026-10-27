import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, pool, sha256 } from './db.js';
import { FailureLimiter } from './hardening.js';
import { clientFromRequest } from './session.js';

const MAX_TOKENS_PER_CLIENT = 20;
export const TOKEN_PREFIX = 'snbd_';

export interface TokenAuth {
  tokenId: string;
  clientId: string;
  name: string;
  scope: 'read' | 'deploy';
  serverIds: string[] | null;
}

const badTokens = new FailureLimiter(20, 10 * 60_000);

/** Looks up "Authorization: Bearer snbd_..."; null when missing, unknown, revoked or expired. */
export async function authenticateToken(header: string | undefined, ip: string, userAgent?: string): Promise<TokenAuth | null> {
  if (badTokens.blocked(ip)) return null;
  const m = /^Bearer (snbd_[A-Za-z0-9_-]{20,100})$/.exec(header ?? '');
  if (!m) return null;
  const ua = (userAgent ?? '').slice(0, 300) || null;
  const { rows } = await pool.query(
    `select id, client_id, name, scope, server_ids from api_tokens
     where token_hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [sha256(m[1])],
  );
  if (!rows[0]) {
    // not a personal token: maybe an access token issued to a connector through OAuth
    const o = (await pool.query(
      `select g.id, g.user_client_id as client_id, g.name, 'read' as scope, g.server_ids
       from oauth_tokens t join oauth_grants g on g.id = t.grant_id
       where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now() and g.revoked_at is null and g.expires_at > now()`,
      [sha256(m[1])],
    )).rows[0];
    if (o) {
      pool.query(
        "update oauth_grants set last_used_at = now(), last_ip = $2, last_user_agent = $3 where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')",
        [o.id, ip, ua],
      ).catch(() => {});
      return { tokenId: o.id, clientId: o.client_id, name: o.name, scope: 'read', serverIds: o.server_ids };
    }
    badTokens.fail(ip);
    return null;
  }
  // last_used_at is for the person looking at the list; one write a minute per token is plenty
  pool.query(
    "update api_tokens set last_used_at = now(), last_ip = $2, last_user_agent = $3 where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')",
    [rows[0].id, ip, ua],
  ).catch(() => {});
  return { tokenId: rows[0].id, clientId: rows[0].client_id, name: rows[0].name, scope: rows[0].scope, serverIds: rows[0].server_ids };
}

// Which app is on the other end, and on what machine. Clients do not identify themselves beyond a
// user agent, so this is a best-effort label that falls back to the name the connection was given.
const CLIENTS: { kind: string; name: string; re: RegExp; ver?: RegExp }[] = [
  { kind: 'claude-code', name: 'Claude Code', re: /claude[-_ ]?code/i, ver: /claude[-_ ]?code\/([\d.]+)/i },
  { kind: 'opencode', name: 'OpenCode', re: /opencode/i, ver: /opencode\/([\d.]+)/i },
  { kind: 'codex', name: 'Codex', re: /codex/i, ver: /codex\/([\d.]+)/i },
  { kind: 'claude', name: 'Claude', re: /claude|anthropic/i, ver: /claude\/([\d.]+)/i },
  { kind: 'cursor', name: 'Cursor', re: /cursor/i, ver: /cursor\/([\d.]+)/i },
  { kind: 'windsurf', name: 'Windsurf', re: /windsurf/i },
  { kind: 'vscode', name: 'VS Code', re: /vscode|visual studio code/i },
  { kind: 'zed', name: 'Zed', re: /zed\//i },
];

export function describeClient(userAgent: string | null, fallbackName: string | null) {
  const ua = userAgent ?? '';
  const clean = (fallbackName ?? '').replace(/\s*\(connector\)$/i, '').trim();
  const hit = CLIENTS.find((c) => c.re.test(ua)) ?? CLIENTS.find((c) => c.re.test(clean));
  const os = /iphone|ipad/i.test(ua) ? 'iOS'
    : /android/i.test(ua) ? 'Android'
      : /macintosh|mac os x|darwin/i.test(ua) ? 'macOS'
        : /windows/i.test(ua) ? 'Windows'
          : /linux|x11/i.test(ua) ? 'Linux'
            : null;
  return {
    clientKind: hit?.kind ?? 'other',
    name: hit?.name ?? (clean || 'Unknown client'),
    version: (hit?.ver ? hit.ver.exec(ua)?.[1] : null) ?? null,
    os,
  };
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(['read']).default('read'), // MCP currently grants every token the full tool set; the column is kept for future limits
  serverIds: z.array(z.string().uuid()).max(100).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
});

/** Token management for the signed-in person. Tokens cannot manage tokens. */
export function registerTokens(app: FastifyInstance) {
  // What the MCP page shows: which AI clients are attached, from which machine, and how recently.
  // Raw keys are deliberately absent - names and activity are enough to recognise a connection.
  app.get('/api/mcp/connections', async (req, reply) => {
    const me = await clientFromRequest(req);
    if (!me) return reply.code(401).send({ error: 'Not signed in' });
    const [rows, servers] = await Promise.all([
      pool.query(
        `select t.id, 'token' as kind, t.name, t.scope, t.server_ids as "serverIds",
                t.last_used_at as "lastSeenAt", host(t.last_ip) as ip, t.last_user_agent as ua,
                t.created_at as "createdAt", t.expires_at as "expiresAt", null::text as "clientName"
         from api_tokens t
         where t.client_id = $1 and t.revoked_at is null and t.last_used_at is not null
           and t.name <> 'AI session'            -- the in-panel chat's short-lived keys are not a connection
         union all
         select g.id, 'connector', g.name, 'read', g.server_ids,
                g.last_used_at, host(g.last_ip), g.last_user_agent, g.created_at, g.expires_at, c.client_name
         from oauth_grants g left join oauth_clients c on c.client_id = g.oauth_client_id
         where g.user_client_id = $1 and g.revoked_at is null and g.expires_at > now()`,
        [me.id],
      ),
      pool.query('select id, name from servers where client_id = $1 and terminated_at is null order by name', [me.id]),
    ]);
    const allNames: string[] = servers.rows.map((s) => s.name);
    const now = Date.now();
    const connections = rows.rows.map((r) => {
      const c = describeClient(r.ua, r.clientName ?? r.name);
      const names = Array.isArray(r.serverIds) && r.serverIds.length
        ? servers.rows.filter((s) => r.serverIds.includes(s.id)).map((s) => s.name)
        : allNames;
      return {
        id: r.id,
        kind: r.kind,
        name: c.name,
        clientKind: c.clientKind,
        version: c.version,
        os: c.os,
        ip: r.ip,
        scope: r.kind === 'connector' ? 'read' : r.scope,
        servers: r.serverIds ? names : null, // null = every server
        serverNames: names,
        lastSeenAt: r.lastSeenAt,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        connected: r.lastSeenAt ? now - new Date(r.lastSeenAt).getTime() < 5 * 60_000 : false,
      };
    }).sort((a, b) => (Number(b.connected) - Number(a.connected)) || (+new Date(b.lastSeenAt ?? 0) - +new Date(a.lastSeenAt ?? 0)));
    const panelUrl = (process.env.PUBLIC_PANEL_URL ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
    return {
      url: `${panelUrl}/mcp`,
      connections,
      connectedCount: connections.filter((c) => c.connected).length,
    };
  });

  app.get('/api/tokens', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const { rows } = await pool.query(
      `select t.id, t.name, t.token_prefix as prefix, t.scope, t.server_ids as "serverIds", t.expires_at as "expiresAt",
              t.last_used_at as "lastUsedAt", t.created_at as "createdAt",
              coalesce((select array_agg(s.name order by s.name) from servers s where s.id = any(t.server_ids)), '{}') as "serverNames"
       from api_tokens t where t.client_id = $1 and t.revoked_at is null and t.name <> 'AI session' order by t.created_at desc`,
      [client.id],
    );
    // connectors approved through OAuth sit in the same list
    const grants = await pool.query(
      `select g.id, g.name, 'connector' as prefix, 'read' as scope, g.server_ids as "serverIds", g.expires_at as "expiresAt", g.last_used_at as "lastUsedAt", g.created_at as "createdAt",
              coalesce((select array_agg(s.name order by s.name) from servers s where s.id = any(g.server_ids)), '{}') as "serverNames"
       from oauth_grants g where g.user_client_id = $1 and g.revoked_at is null and g.expires_at > now()`, [client.id]);
    return [...rows.map((r) => ({ ...r, kind: 'token' })), ...grants.rows.map((r) => ({ ...r, kind: 'connector' }))]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  });

  app.post('/api/tokens', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
    const count = await pool.query("select count(*)::int as n from api_tokens where client_id = $1 and revoked_at is null and name <> 'AI session' and (expires_at is null or expires_at > now())", [client.id]);
    if (count.rows[0].n >= MAX_TOKENS_PER_CLIENT) return reply.code(409).send({ error: `You can have at most ${MAX_TOKENS_PER_CLIENT} active tokens. Revoke one first.` });

    let serverIds = body.data.serverIds;
    if (serverIds) {
      // only servers this client owns can be named
      const owned = await pool.query('select id from servers where client_id = $1 and terminated_at is null and id = any($2::uuid[])', [client.id, serverIds]);
      if (owned.rowCount !== new Set(serverIds).size) return reply.code(400).send({ error: 'One of the selected servers is not yours' });
      serverIds = [...new Set(serverIds)];
    }
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const { rows } = await pool.query(
      `insert into api_tokens (client_id, name, token_hash, token_prefix, scope, server_ids, expires_at)
       values ($1, $2, $3, $4, $5, $6, case when $7::int is null then null else now() + make_interval(days => $7::int) end) returning id, expires_at as "expiresAt"`,
      [client.id, body.data.name, sha256(token), token.slice(0, 12), body.data.scope, serverIds, body.data.expiresInDays],
    );
    await audit(client.id, null, 'token.create', { name: body.data.name, scope: body.data.scope });
    reply.header('cache-control', 'no-store');
    return { id: rows[0].id, token, expiresAt: rows[0].expiresAt }; // the only time the token is shown
  });

  /** Creates a short-lived deploy-scoped token for the AI chat session, restricted to one server. */
  app.post<{ Params: { id: string } }>('/api/servers/:id/ai-session', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Not found' });
    const { rows: serverRows } = await pool.query(
      'select id from servers where id = $1 and client_id = $2 and terminated_at is null',
      [req.params.id, client.id],
    );
    if (serverRows.length === 0) return reply.code(404).send({ error: 'Server not found' });
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    await pool.query(
      `insert into api_tokens (client_id, name, token_hash, token_prefix, scope, server_ids, expires_at)
       values ($1, 'AI session', $2, $3, 'deploy', $4::uuid[], now() + interval '24 hours')`,
      [client.id, sha256(token), token.slice(0, 12), [req.params.id]],
    );
    reply.header('cache-control', 'no-store');
    return { token };
  });

  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Not found' });
    let { rows } = await pool.query('update api_tokens set revoked_at = now() where id = $1 and client_id = $2 and revoked_at is null returning name', [req.params.id, client.id]);
    if (!rows[0]) ({ rows } = await pool.query('update oauth_grants set revoked_at = now() where id = $1 and user_client_id = $2 and revoked_at is null returning name', [req.params.id, client.id]));
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    await audit(client.id, null, 'token.revoke', { name: rows[0].name });
    return { ok: true };
  });
}
