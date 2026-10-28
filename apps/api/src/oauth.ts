import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, pool, sha256, requestContext } from './db.js';
import { ipLimit } from './hardening.js';
import { clientFromRequest } from './session.js';
import { TOKEN_PREFIX } from './tokens.js';

// OAuth 2.1 authorization server for MCP clients: authorization code + PKCE (S256 only), dynamic client registration, refresh
// rotation with replay detection, revocation. All clients are public (no secret); trust comes from the customer approving each one.

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86400;
const GRANT_TTL_S = 90 * 86400;      // a connection must be re-approved after 90 days, however often it refreshes
const CODE_TTL_S = 300;
const REQUEST_TTL_S = 600;
const MAX_CLIENTS = 5000;

const csv = (v: string | undefined, def: string) => (v ?? def).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Who may receive an authorization code. Registration is open, so this list is what stops a stranger
// from registering an app that sends the customer's approval to a site they control.
const allowedHosts = () => csv(process.env.OAUTH_ALLOWED_REDIRECT_HOSTS, 'claude.ai,claude.com');
const allowedSchemes = () => csv(process.env.OAUTH_ALLOWED_REDIRECT_SCHEMES, 'cursor,vscode,vscode-insiders,windsurf,claude');

export const baseUrl = (req: { protocol: string; headers: Record<string, unknown> }) =>
  (process.env.PUBLIC_PANEL_URL ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');

function redirectAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password || raw.length > 500) return false;
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return allowedHosts().includes(u.hostname.toLowerCase());
  if (scheme === 'http') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase()); // native apps (RFC 8252), any port
  return allowedSchemes().includes(scheme);
}

const rand = (bytes = 32) => randomBytes(bytes).toString('base64url');
const oauthError = (reply: FastifyReply, status: number, error: string, description: string) => reply.code(status).header('cache-control', 'no-store').header('pragma', 'no-cache').send({ error, error_description: description });

function authorizeErrorPage(reply: FastifyReply, message: string) {
  // when the client or redirect cannot be trusted we must NOT redirect anywhere: show the problem here
  const safe = message.replace(/[<>&"]/g, '');
  return reply.code(400).type('text/html').send(`<!doctype html><meta charset="utf-8"><title>Cannot connect</title><body style="font:16px system-ui;max-width:520px;margin:80px auto;padding:0 20px"><h1 style="font-size:22px">Cannot connect this app</h1><p>${safe}</p><p>Close this tab and check the app's connector settings.</p></body>`);
}

const cors = (reply: FastifyReply) => reply.header('access-control-allow-origin', '*').header('access-control-allow-headers', 'content-type, authorization, mcp-protocol-version').header('access-control-allow-methods', 'GET, POST, OPTIONS');

/** Records the connection and issues the first access + refresh token. */
async function issueTokens(grantId: string) {
  const access = TOKEN_PREFIX + rand(), refresh = TOKEN_PREFIX + 'r_' + rand();
  await pool.query(`insert into oauth_tokens (token_hash, grant_id, kind, expires_at) values ($1, $2, 'access', now() + make_interval(secs => $3)), ($4, $2, 'refresh', now() + make_interval(secs => $5))`,
    [sha256(access), grantId, ACCESS_TTL_S, sha256(refresh), REFRESH_TTL_S]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'full' };
}

const RegisterBody = z.object({
  client_name: z.string().trim().min(1).max(80).default('MCP client'),
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
}).passthrough();

export function registerOAuth(app: FastifyInstance) {
  // token and registration bodies come form-encoded
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // ---- discovery
  const resourceMeta = (req: FastifyRequest, reply: FastifyReply) => {
    cors(reply).header('cache-control', 'public, max-age=300');
    const b = baseUrl(req);
    return { resource: `${b}/mcp`, authorization_servers: [b], bearer_methods_supported: ['header'], scopes_supported: ['full'], resource_name: 'SNBD Console' };
  };
  app.get('/.well-known/oauth-protected-resource', async (req, reply) => resourceMeta(req, reply));
  app.get('/.well-known/oauth-protected-resource/mcp', async (req, reply) => resourceMeta(req, reply));

  const serverMeta = async (req: FastifyRequest, reply: FastifyReply) => {
    cors(reply).header('cache-control', 'public, max-age=300');
    const b = baseUrl(req);
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['full'],
    };
  };
  app.get('/.well-known/oauth-authorization-server', serverMeta);
  app.get('/.well-known/oauth-authorization-server/mcp', serverMeta);

  for (const path of ['/oauth/register', '/oauth/token', '/oauth/revoke', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/mcp']) {
    app.options(path, async (_req, reply) => cors(reply).header('access-control-max-age', '600').code(204).send());
  }

  // ---- dynamic client registration (RFC 7591)
  app.post('/oauth/register', ipLimit(20, '1 hour'), async (req, reply) => {
    cors(reply);
    const body = RegisterBody.safeParse(req.body);
    if (!body.success) return oauthError(reply, 400, 'invalid_client_metadata', 'redirect_uris (1 to 5) are required');
    const m = body.data;
    if (m.token_endpoint_auth_method && m.token_endpoint_auth_method !== 'none') return oauthError(reply, 400, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
    if (m.grant_types && !m.grant_types.every((g) => ['authorization_code', 'refresh_token'].includes(g))) return oauthError(reply, 400, 'invalid_client_metadata', 'Unsupported grant_types');
    const bad = m.redirect_uris.find((u) => !redirectAllowed(u));
    if (bad) req.log.warn({ redirect: bad.slice(0, 200), client: m.client_name }, 'oauth: registration refused, redirect address not allowed (see OAUTH_ALLOWED_REDIRECT_HOSTS)');
    if (bad) return oauthError(reply, 400, 'invalid_redirect_uri', 'This redirect address is not allowed. Allowed: the Claude apps, localhost, and a few editors (the operator can add more).');
    const count = await pool.query('select count(*)::int as n from oauth_clients');
    if (count.rows[0].n >= MAX_CLIENTS) return oauthError(reply, 503, 'temporarily_unavailable', 'Too many registered clients; try again later');
    const clientId = 'snbdc_' + rand(18);
    await pool.query('insert into oauth_clients (client_id, client_name, redirect_uris) values ($1, $2, $3)', [clientId, m.client_name, m.redirect_uris]);
    return reply.code(201).header('cache-control', 'no-store').send({
      client_id: clientId, client_name: m.client_name, redirect_uris: m.redirect_uris, token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000),
    });
  });

  // ---- authorization request: validate, park it, send the browser to the panel's approval page
  app.get<{ Querystring: Record<string, string | undefined> }>('/oauth/authorize', ipLimit(60), async (req, reply) => {
    const q = req.query;
    const client = q.client_id ? (await pool.query('select client_id, client_name, redirect_uris from oauth_clients where client_id = $1', [q.client_id])).rows[0] : null;
    if (!client) return authorizeErrorPage(reply, 'The app is not registered with this panel.');
    if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri) || !redirectAllowed(q.redirect_uri)) return authorizeErrorPage(reply, 'The return address does not match what the app registered.');
    const back = (error: string, description: string) => {
      const u = new URL(q.redirect_uri!);
      u.searchParams.set('error', error); u.searchParams.set('error_description', description);
      if (q.state) u.searchParams.set('state', q.state);
      return reply.redirect(u.toString());
    };
    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
    if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    if (q.state && q.state.length > 500) return back('invalid_request', 'state is too long');
    const id = rand(24);
    await pool.query(`insert into oauth_requests (id, client_id, redirect_uri, code_challenge, state, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [id, client.client_id, q.redirect_uri, q.code_challenge, q.state ?? null, REQUEST_TTL_S]);
    return reply.header('cache-control', 'no-store').redirect(`${baseUrl(req)}/#/authorize?req=${id}`);
  });

  // ---- the approval page's API (signed-in customer)
  const loadRequest = async (id: string) => (await pool.query(
    `select r.id, r.redirect_uri, r.state, c.client_id, c.client_name from oauth_requests r join oauth_clients c on c.client_id = r.client_id where r.id = $1 and r.expires_at > now()`, [id])).rows[0];
  const withState = (uri: string, params: Record<string, string>, state: string | null) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (state) u.searchParams.set('state', state);
    return u.toString();
  };

  app.get<{ Params: { id: string } }>('/api/oauth/request/:id', async (req, reply) => {
    const me = await clientFromRequest(req);
    if (!me) return reply.code(401).send({ error: 'Not signed in' });
    const r = await loadRequest(req.params.id);
    if (!r) return reply.code(404).send({ error: 'This approval request has expired. Start the connection again in the app.' });
    const servers = (await pool.query('select id, name from servers where client_id = $1 and terminated_at is null order by name', [me.id])).rows;
    const u = new URL(r.redirect_uri);
    return { clientName: r.client_name, returnsTo: u.protocol === 'http:' || u.protocol === 'https:' ? u.host : `${u.protocol}//`, servers, access: 'Read status, logs and files. Tick full access below to also run commands, write files and restart services.' };
  });

  const ApproveBody = z.object({ serverIds: z.array(z.string().uuid()).max(100).nullable().default(null), scope: z.enum(['read', 'deploy']).default('read') });
  app.post<{ Params: { id: string } }>('/api/oauth/request/:id/approve', async (req, reply) => {
    const me = await clientFromRequest(req);
    if (!me) return reply.code(401).send({ error: 'Not signed in' });
    const body = ApproveBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
    // single use: whoever deletes the row is the one allowed to approve it
    const taken = await pool.query('delete from oauth_requests where id = $1 and expires_at > now() returning client_id, redirect_uri, code_challenge, state', [req.params.id]);
    const r = taken.rows[0];
    if (!r) return reply.code(404).send({ error: 'This approval request has expired. Start the connection again in the app.' });
    let serverIds = body.data.serverIds;
    if (serverIds) {
      const owned = await pool.query('select id from servers where client_id = $1 and terminated_at is null and id = any($2::uuid[])', [me.id, serverIds]);
      if (owned.rowCount !== new Set(serverIds).size) return reply.code(400).send({ error: 'One of the selected servers is not yours' });
      serverIds = [...new Set(serverIds)];
    }
    const client = (await pool.query('select client_name from oauth_clients where client_id = $1', [r.client_id])).rows[0];
    const grant = (await pool.query(
      `insert into oauth_grants (user_client_id, oauth_client_id, name, server_ids, scope, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) returning id`,
      [me.id, r.client_id, `${client.client_name} (connector)`, serverIds, body.data.scope, GRANT_TTL_S])).rows[0];
    const code = rand();
    await pool.query(`insert into oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at) values ($1, $2, $3, $4, now() + make_interval(secs => $5))`, [sha256(code), grant.id, r.redirect_uri, r.code_challenge, CODE_TTL_S]);
    await audit(me.id, null, 'oauth.approve', { app: client.client_name, scope: body.data.scope }, null, requestContext(req));
    return { redirect: withState(r.redirect_uri, { code }, r.state) };
  });

  app.post<{ Params: { id: string } }>('/api/oauth/request/:id/deny', async (req, reply) => {
    const me = await clientFromRequest(req);
    if (!me) return reply.code(401).send({ error: 'Not signed in' });
    const r = (await pool.query('delete from oauth_requests where id = $1 returning redirect_uri, state', [req.params.id])).rows[0];
    if (!r) return reply.code(404).send({ error: 'This approval request has expired.' });
    return { redirect: withState(r.redirect_uri, { error: 'access_denied', error_description: 'The customer declined' }, r.state) };
  });

  // ---- token endpoint
  app.post('/oauth/token', ipLimit(60), async (req, reply) => {
    cors(reply);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    if (b.grant_type === 'authorization_code') {
      if (!b.code || !b.code_verifier || !b.client_id || !b.redirect_uri) return oauthError(reply, 400, 'invalid_request', 'code, code_verifier, client_id and redirect_uri are required');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier)) return oauthError(reply, 400, 'invalid_grant', 'Bad code_verifier');
      const row = (await pool.query(
        `select c.grant_id, c.redirect_uri, c.code_challenge, c.used_at, c.expires_at > now() as fresh, g.oauth_client_id, g.revoked_at
         from oauth_codes c join oauth_grants g on g.id = c.grant_id where c.code_hash = $1`, [sha256(b.code)])).rows[0];
      if (!row) return oauthError(reply, 400, 'invalid_grant', 'Unknown or expired code');
      if (row.used_at) {
        // a code is single use; seeing it twice means it leaked, so everything issued from it is revoked
        await pool.query('update oauth_grants set revoked_at = coalesce(revoked_at, now()) where id = $1', [row.grant_id]);
        return oauthError(reply, 400, 'invalid_grant', 'This code was already used');
      }
      if (!row.fresh || row.revoked_at) return oauthError(reply, 400, 'invalid_grant', 'Unknown or expired code');
      if (row.oauth_client_id !== b.client_id || row.redirect_uri !== b.redirect_uri) return oauthError(reply, 400, 'invalid_grant', 'client_id or redirect_uri does not match the authorization request');
      if (createHash('sha256').update(b.code_verifier).digest('base64url') !== row.code_challenge) return oauthError(reply, 400, 'invalid_grant', 'PKCE verification failed');
      const used = await pool.query('update oauth_codes set used_at = now() where code_hash = $1 and used_at is null', [sha256(b.code)]);
      if (!used.rowCount) return oauthError(reply, 400, 'invalid_grant', 'This code was already used');
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(await issueTokens(row.grant_id));
    }

    if (b.grant_type === 'refresh_token') {
      if (!b.refresh_token || !b.client_id) return oauthError(reply, 400, 'invalid_request', 'refresh_token and client_id are required');
      const t = (await pool.query(
        `select t.grant_id, t.used_at, t.expires_at > now() as fresh, g.oauth_client_id, g.revoked_at, g.expires_at > now() as grant_fresh
         from oauth_tokens t join oauth_grants g on g.id = t.grant_id where t.token_hash = $1 and t.kind = 'refresh'`, [sha256(b.refresh_token)])).rows[0];
      if (!t || t.oauth_client_id !== b.client_id) return oauthError(reply, 400, 'invalid_grant', 'Unknown refresh token');
      if (t.used_at) {
        await pool.query('update oauth_grants set revoked_at = coalesce(revoked_at, now()) where id = $1', [t.grant_id]); // replay: assume theft
        return oauthError(reply, 400, 'invalid_grant', 'Refresh token was already used; the connection was revoked for safety. Connect again.');
      }
      if (!t.fresh || t.revoked_at || !t.grant_fresh) return oauthError(reply, 400, 'invalid_grant', 'Refresh token expired or revoked');
      const used = await pool.query('update oauth_tokens set used_at = now() where token_hash = $1 and used_at is null', [sha256(b.refresh_token)]);
      if (!used.rowCount) return oauthError(reply, 400, 'invalid_grant', 'Refresh token was already used');
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(await issueTokens(t.grant_id));
    }
    return oauthError(reply, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  });

  // ---- revocation (RFC 7009): always answers 200
  app.post('/oauth/revoke', ipLimit(60), async (req, reply) => {
    cors(reply);
    const token = ((req.body ?? {}) as Record<string, string | undefined>).token;
    if (token && token.length < 200) {
      await pool.query('update oauth_grants set revoked_at = coalesce(revoked_at, now()) where id = (select grant_id from oauth_tokens where token_hash = $1)', [sha256(token)]);
    }
    return reply.code(200).send({});
  });
}
