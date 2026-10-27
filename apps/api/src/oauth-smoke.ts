// OAuth for MCP: full flow with the official SDK client, then the attack cases. API on :3101 (PUBLIC_PANEL_URL=http://localhost:3101), DEMO_PASSWORD set.
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { pool } from './db.js';

const base = 'http://localhost:3101';
const CB = 'http://localhost:8123/callback';
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const j = async (path: string, init: RequestInit = {}) => { const r = await fetch(base + path, { redirect: 'manual', ...init }); return { status: r.status, body: (await r.clone().json().catch(() => ({}))) as any, headers: r.headers, res: r }; };
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const tokenPost = (o: Record<string, string>, headers: Record<string, string> = {}) => j('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(o) });

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@snbd.test', password: process.env.DEMO_PASSWORD }) });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const H = { cookie, 'content-type': 'application/json' };
const imp = async (name: string) => (await j('/api/servers/import', { method: 'POST', headers: H, body: JSON.stringify({ name }) })).body.serverId as string;
const SA = await imp('oa-alpha'), SB = await imp('oa-beta');

// ---- discovery
const prm = await j('/.well-known/oauth-protected-resource');
const asm = await j('/.well-known/oauth-authorization-server');
check('protected-resource metadata names the MCP URL and this server', prm.body.resource === `${base}/mcp` && prm.body.authorization_servers?.[0] === base);
check('authorization-server metadata: PKCE S256, public clients, registration', asm.body.code_challenge_methods_supported?.join() === 'S256' && asm.body.token_endpoint_auth_methods_supported?.join() === 'none' && asm.body.registration_endpoint === `${base}/oauth/register` && asm.body.grant_types_supported.includes('refresh_token'));
check('path-aware metadata variants exist', (await j('/.well-known/oauth-protected-resource/mcp')).status === 200 && (await j('/.well-known/oauth-authorization-server/mcp')).status === 200);
check('metadata is readable cross-origin (CORS)', prm.headers.get('access-control-allow-origin') === '*');
const un = await j('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('401 from /mcp points at the resource metadata', un.status === 401 && (un.headers.get('www-authenticate') ?? '').includes(`resource_metadata="${base}/.well-known/oauth-protected-resource"`));
check('OPTIONS preflight on token endpoint', (await j('/oauth/token', { method: 'OPTIONS' })).status === 204);

// ---- registration
const reg = (m: object) => j('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
const bad = async (uri: string) => (await reg({ client_name: 'x', redirect_uris: [uri] }));
check('rejects an arbitrary https redirect', (await bad('https://evil.example/cb')).body.error === 'invalid_redirect_uri');
check('rejects plain http to a non-local host', (await bad('http://evil.example/cb')).status === 400);
check('rejects an unknown app scheme', (await bad('evil://x')).status === 400);
check('rejects redirect with a fragment or credentials', (await bad('https://claude.ai/cb#x')).status === 400 && (await bad('https://u:p@claude.ai/cb')).status === 400);
check('rejects confidential-client auth methods', (await reg({ client_name: 'x', redirect_uris: [CB], token_endpoint_auth_method: 'client_secret_basic' })).status === 400);
check('rejects registration without redirect_uris', (await reg({ client_name: 'x' })).status === 400);
const claude = await reg({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
check('the Claude web callback is allowed', claude.status === 201 && claude.body.client_id.startsWith('snbdc_') && claude.body.token_endpoint_auth_method === 'none');
check('Cursor/VS Code schemes are allowed', (await reg({ client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-retrieve/oauth/callback'] })).status === 201);

// ---- full flow with the official SDK client
class Prov implements OAuthClientProvider {
  info: any; tok: any; verifier = ''; authUrl?: URL;
  state() { return 'st-sdk-' + randomBytes(4).toString('hex'); }
  get redirectUrl() { return CB; }
  get clientMetadata() { return { client_name: 'Test App', redirect_uris: [CB], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; }
  clientInformation() { return this.info; }
  saveClientInformation(i: any) { this.info = i; }
  tokens() { return this.tok; }
  saveTokens(t: any) { this.tok = t; }
  redirectToAuthorization(u: URL) { this.authUrl = u; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}
const approve = async (authUrl: URL, serverIds: string[] | null = null) => {
  const a = await j(authUrl.pathname + authUrl.search);
  const loc = a.headers.get('location') ?? '';
  const reqId = new URL(loc, base).hash.match(/req=([\w-]+)/)?.[1] ?? '';
  const info = await j(`/api/oauth/request/${reqId}`, { headers: { cookie } });
  const ap = await j(`/api/oauth/request/${reqId}/approve`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds }) });
  return { a, loc, reqId, info, ap, redirect: ap.body.redirect as string | undefined };
};

const prov = new Prov();
const t1 = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { authProvider: prov });
const c0 = new Client({ name: 'oauth-smoke', version: '1' });
let needsAuth = false;
try { await c0.connect(t1); } catch (e) { needsAuth = e instanceof UnauthorizedError; }
check('SDK discovers, registers itself and asks for authorization', needsAuth && !!prov.authUrl && !!prov.info?.client_id, String(prov.authUrl));
const q = prov.authUrl!.searchParams;
check('authorization URL has PKCE S256, state, and our redirect', q.get('code_challenge_method') === 'S256' && !!q.get('state') && q.get('redirect_uri') === CB && q.get('response_type') === 'code');
const ap = await approve(prov.authUrl!);
check('authorize validates and sends the browser to the approval page', ap.a.status === 302 && ap.loc.includes('/#/authorize?req='));
check('approval page data: app name and where it returns to', ap.info.body.clientName === 'Test App' && ap.info.body.returnsTo === 'localhost:8123' && ap.info.body.servers.some((s: any) => s.id === SA));
const cb = new URL(ap.redirect!);
check('approval returns a code and echoes state', cb.origin + cb.pathname === CB && !!cb.searchParams.get('code') && cb.searchParams.get('state') === q.get('state'));
await t1.finishAuth(cb.searchParams.get('code')!);
check('SDK exchanged the code for tokens', !!prov.tok?.access_token && !!prov.tok?.refresh_token && prov.tok.token_type.toLowerCase() === 'bearer');

const c1 = new Client({ name: 'oauth-smoke', version: '1' });
await c1.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { authProvider: prov }));
const ls = JSON.parse(((await c1.callTool({ name: 'list_servers', arguments: {} })) as any).content[0].text);
check('connector reaches the MCP tools with its OAuth token', ls.servers.some((s: any) => s.name === 'oa-alpha') && ls.servers.some((s: any) => s.name === 'oa-beta'));
await c1.callTool({ name: 'server_status', arguments: { server: 'oa-alpha' } });
const aud = (await pool.query("select via from audit_log where server_id = $1 and action = 'mcp.server_status'", [SA])).rows;
check('actions are audited as the connector', aud.some((r) => r.via === 'Test App (connector)'));
const listed = (await j('/api/tokens', { headers: { cookie } })).body as any[];
const grant = listed.find((t) => t.kind === 'connector' && t.name === 'Test App (connector)');
check('connector appears in the MCP connections list', !!grant && grant.prefix === 'connector');
check('connector token does not open the normal API', (await fetch(base + '/api/servers', { headers: { Authorization: `Bearer ${prov.tok.access_token}` } })).status === 401);
await c1.close();

// ---- negative cases with hand-made PKCE
const pkce = () => { const v = randomBytes(32).toString('base64url'); return { v, ch: createHash('sha256').update(v).digest('base64url') }; };
const clientId: string = prov.info.client_id;
async function newCode(opts: { serverIds?: string[] | null } = {}) {
  const { v, ch } = pkce();
  const url = new URL(`${base}/oauth/authorize`);
  Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: ch, code_challenge_method: 'S256', state: 'st-' + randomBytes(4).toString('hex') }).forEach(([k, val]) => url.searchParams.set(k, val));
  const r = await approve(url, opts.serverIds ?? null);
  return { code: new URL(r.redirect!).searchParams.get('code')!, v, reqId: r.reqId, state: url.searchParams.get('state')! };
}
const ex = (c: { code: string; v: string }, extra: Record<string, string> = {}) => tokenPost({ grant_type: 'authorization_code', code: c.code, code_verifier: c.v, client_id: clientId, redirect_uri: CB, ...extra });

const n1 = await newCode();
check('wrong PKCE verifier rejected', (await ex(n1, { code_verifier: pkce().v })).body.error === 'invalid_grant');
check('the correct verifier then works (a failed guess does not burn the code)', (await ex(n1)).status === 200);
const rep = await ex(n1);
check('a used code is rejected', rep.status === 400 && rep.body.error === 'invalid_grant');
const grantsAfterReplay = (await pool.query("select revoked_at from oauth_grants where oauth_client_id = $1 order by created_at desc limit 1", [clientId])).rows[0];
check('replaying a code revokes the grant it created', !!grantsAfterReplay.revoked_at);

const n2 = await newCode();
check('wrong redirect_uri at the token endpoint rejected', (await ex(n2, { redirect_uri: 'http://localhost:9999/cb' })).body.error === 'invalid_grant');
check('wrong client_id rejected', (await ex(n2, { client_id: claude.body.client_id })).body.error === 'invalid_grant');
await pool.query("update oauth_codes set expires_at = now() - interval '1 minute' where code_hash = encode(sha256($1::bytea), 'hex')", [n2.code]);
check('an expired code is rejected', (await ex(n2)).body.error === 'invalid_grant');
check('unsupported grant type', (await tokenPost({ grant_type: 'password', username: 'a', password: 'b' })).body.error === 'unsupported_grant_type');
check('token endpoint answers a foreign Origin (no cookies there) with CORS', (await tokenPost({ grant_type: 'nope' }, { Origin: 'https://claude.ai' })).headers.get('access-control-allow-origin') === '*');

// authorize edge cases: never redirect to an address we cannot trust
const az = (p: Record<string, string>) => j('/oauth/authorize?' + new URLSearchParams(p).toString());
const goodP = { response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: pkce().ch, code_challenge_method: 'S256', state: 's' };
const unk = await az({ ...goodP, client_id: 'snbdc_unknown' });
check('unknown client: error page, no redirect', unk.status === 400 && !unk.headers.get('location'));
const mis = await az({ ...goodP, redirect_uri: 'http://localhost:9999/cb' });
check('redirect_uri not registered: error page, no redirect', mis.status === 400 && !mis.headers.get('location'));
const noP = await az({ ...goodP, code_challenge: '' });
check('missing PKCE: error returned to the registered redirect', noP.status === 302 && (noP.headers.get('location') ?? '').startsWith(CB) && (noP.headers.get('location') ?? '').includes('error=invalid_request') && (noP.headers.get('location') ?? '').includes('state=s'));
const plain = await az({ ...goodP, code_challenge_method: 'plain' });
check('PKCE "plain" refused', (plain.headers.get('location') ?? '').includes('error=invalid_request'));
check('response_type=token refused', (await az({ ...goodP, response_type: 'token' })).headers.get('location')?.includes('unsupported_response_type') === true);

// approval API rules
check('approval needs sign-in', (await j('/api/oauth/request/abc/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401);
check('unknown request -> 404', (await j('/api/oauth/request/doesnotexist', { headers: { cookie } })).status === 404);
const n3 = await newCode();
check('an approval request is single use', (await j(`/api/oauth/request/${n3.reqId}/approve`, { method: 'POST', headers: H, body: '{}' })).status === 404);
const dUrl = new URL(`${base}/oauth/authorize`); Object.entries({ ...goodP, state: 'deny-me' }).forEach(([k, v]) => dUrl.searchParams.set(k, v));
const dloc = (await j(dUrl.pathname + dUrl.search)).headers.get('location')!; const dreq = new URL(dloc).hash.match(/req=([\w-]+)/)![1];
const den = await j(`/api/oauth/request/${dreq}/deny`, { method: 'POST', headers: H, body: '{}' });
check('deny returns access_denied with state', den.body.redirect.includes('error=access_denied') && den.body.redirect.includes('state=deny-me'));
const foreign = await newCodeForeignServer();
async function newCodeForeignServer() {
  const { ch } = pkce(); const u = new URL(`${base}/oauth/authorize`); Object.entries({ ...goodP, code_challenge: ch }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await approve(u, ['00000000-0000-4000-8000-000000000000']); return r.ap.status;
}
check('cannot approve servers that are not yours', foreign === 400);

// ---- scoped connector, refresh rotation, replay, expiry, revocation
const sc = await newCode({ serverIds: [SA] }); const scTok = (await ex(sc)).body;
const mcpCall = (tok: string, method = 'tools/call', params: object = { name: 'list_servers', arguments: {} }) => j('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
const scList = JSON.parse((await mcpCall(scTok.access_token)).body.result.content[0].text);
check('connector limited to chosen servers sees only those', scList.count === 1 && scList.servers[0].name === 'oa-alpha');

const r1 = await tokenPost({ grant_type: 'refresh_token', refresh_token: scTok.refresh_token, client_id: clientId });
check('refresh issues new access + refresh tokens', r1.status === 200 && r1.body.access_token !== scTok.access_token && !!r1.body.refresh_token && r1.body.refresh_token !== scTok.refresh_token);
check('the refreshed access token works', (await mcpCall(r1.body.access_token)).status === 200);
check('refresh with the wrong client_id fails', (await tokenPost({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: claude.body.client_id })).body.error === 'invalid_grant');
const replay = await tokenPost({ grant_type: 'refresh_token', refresh_token: scTok.refresh_token, client_id: clientId });
check('replaying an old refresh token fails', replay.body.error === 'invalid_grant');
check('...and revokes the whole connection (theft response)', (await mcpCall(r1.body.access_token)).status === 401 && (await tokenPost({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: clientId })).status === 400);

const e1 = await newCode(); const eTok = (await ex(e1)).body;
await pool.query("update oauth_tokens set expires_at = now() - interval '1 minute' where kind = 'access' and token_hash = encode(sha256($1::bytea), 'hex')", [eTok.access_token]);
check('an expired access token is refused', (await mcpCall(eTok.access_token)).status === 401);
const eRef = await tokenPost({ grant_type: 'refresh_token', refresh_token: eTok.refresh_token, client_id: clientId });
check('...but its refresh token gets a new one', eRef.status === 200 && (await mcpCall(eRef.body.access_token)).status === 200);
await pool.query("update oauth_grants set expires_at = now() - interval '1 minute' where id = (select grant_id from oauth_tokens where token_hash = encode(sha256($1::bytea), 'hex'))", [eRef.body.refresh_token]);
check('a connection past its 90-day limit must be approved again', (await mcpCall(eRef.body.access_token)).status === 401 && (await tokenPost({ grant_type: 'refresh_token', refresh_token: eRef.body.refresh_token, client_id: clientId })).status === 400);

const v1 = await newCode(); const vTok = (await ex(v1)).body;
check('before revoke: works', (await mcpCall(vTok.access_token)).status === 200);
check('RFC 7009 revoke answers 200', (await j('/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: vTok.refresh_token }) })).status === 200);
check('revoke kills the access token too', (await mcpCall(vTok.access_token)).status === 401);
check('revoking an unknown token still answers 200', (await j('/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: 'nonsense' }) })).status === 200);

const u1 = await newCode(); const uTok = (await ex(u1)).body;
const gid = ((await j('/api/tokens', { headers: { cookie } })).body as any[]).find((t) => t.kind === 'connector' && t.id && t.name === 'Test App (connector)')?.id;
check('customer can disconnect a connector from the panel', (await j(`/api/tokens/${gid}`, { method: 'DELETE', headers: { cookie } })).status === 200);
check('...and it stops working at once', (await mcpCall(uTok.access_token)).status === 401);
check('another customer-visible rule: connector tokens cannot manage tokens', (await fetch(base + '/api/tokens', { headers: { Authorization: `Bearer ${uTok.access_token}` } })).status === 401);

await pool.query("delete from servers where name like 'oa-%'; delete from oauth_clients where client_name in ('Test App','Claude','Cursor','x')");
await pool.end();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
