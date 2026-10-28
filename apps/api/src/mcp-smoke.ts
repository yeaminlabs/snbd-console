// MCP + API token checks. Needs the API on :3101, the demo login (DEMO_PASSWORD) and AGENT_BIN (an agent binary for this machine).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pool } from './db.js';

const base = 'http://localhost:3101';
const AGENT = process.env.AGENT_BIN!;
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(400); } return false; }
const j = async (path: string, init: RequestInit = {}) => { const r = await fetch(base + path, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as any, headers: r.headers }; };

// ---- session, two servers, one agent online
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@snbd.test', password: process.env.DEMO_PASSWORD }) });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const H = { cookie, 'content-type': 'application/json' };
const imp = async (name: string) => (await j('/api/servers/import', { method: 'POST', headers: H, body: JSON.stringify({ name }) })).body;
const A = await imp('mcp-alpha'), B = await imp('mcp-beta');
const dir = mkdtempSync(join(tmpdir(), 'snbd-mcp-'));
const proc: ChildProcess = spawn(AGENT, [], { env: { ...process.env, PANEL_URL: 'ws://localhost:3101/agent', SNBD_STATE_DIR: dir, ENROLL_TOKEN: A.token } });
check('agent for mcp-alpha online', await until(async () => (await pool.query("select status from servers where id = $1", [A.serverId])).rows[0].status === 'running'));

// ---- token management (signed-in only)
check('token list needs sign-in', (await j('/api/tokens')).status === 401);
const t1 = await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Claude laptop', scope: 'deploy' }) });
check('token created, shown once, snbd_ prefix', t1.status === 200 && /^snbd_[A-Za-z0-9_-]{40,}$/.test(t1.body.token) && t1.headers.get('cache-control') === 'no-store');
const tok = t1.body.token as string;
check('only the hash is stored', (await pool.query('select count(*)::int n from api_tokens where token_hash = $1', [tok])).rows[0].n === 0);
check("deploy scope is persisted", (await pool.query('select scope from api_tokens where id = $1', [t1.body.id])).rows[0].scope === 'deploy');
const list1 = await j('/api/tokens', { headers: { cookie } });
check('list shows prefix, never the token', list1.body.some((t: any) => t.name === 'Claude laptop' && tok.startsWith(t.prefix)) && !JSON.stringify(list1.body).includes(tok));
check('cannot scope a token to a server that is not yours', (await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'x', serverIds: ['00000000-0000-4000-8000-000000000000'] }) })).status === 400);
check('scope defaults to read when omitted', (await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'x' }) })).body.id && (await pool.query("select scope from api_tokens where name = 'x'")).rows[0].scope === 'read');
const t2 = await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Only alpha', serverIds: [A.serverId], expiresInDays: 7 }) });
check('scoped token created', t2.status === 200);

// ---- official MCP client
const connect = async (token: string) => {
  const c = new Client({ name: 'smoke', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
};
const text = (r: any) => r.content?.[0]?.text as string;
const call = async (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;

const c1 = await connect(tok);
check('initialize: server info + instructions', c1.getServerVersion()?.name === 'snbd-console' && (c1.getInstructions() ?? '').includes('ask which one'));
const tools = (await c1.listTools()).tools;
check('nine tools: six read and three write', tools.map((t) => t.name).sort().join() === 'get_public_ip,list_files,list_servers,read_file,restart_service,run_command,server_status,view_logs,write_file');
check('read tools are marked read-only', tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort().join() === 'restart_service,run_command,write_file');

// ---- file tools must move bytes, not base64 strings
const testFile = join(tmpdir(), `snbd-mcp-write-${process.pid}.txt`);
const sample = 'hello from MCP\nsecond line — ünïcode\n';
const wf = await call(c1, 'write_file', { server: 'mcp-alpha', path: testFile, content: sample });
check('write_file decodes the agent response and writes UTF-8', wf.isError !== true && readFileSync(testFile, 'utf8') === sample, text(wf));
const rf = await call(c1, 'read_file', { server: 'mcp-alpha', path: testFile });
check('read_file returns decoded text', rf.isError !== true && text(rf).includes(sample.trim()), text(rf));
unlinkSync(testFile);

const ls = JSON.parse(text(await call(c1, 'list_servers', {})));
const alpha = ls.servers.find((s: any) => s.name === 'mcp-alpha'), beta = ls.servers.find((s: any) => s.name === 'mcp-beta');
check('list_servers shows both, alpha online, beta offline', !!alpha && !!beta && alpha.agentOnline === true && beta.agentOnline === false);

const st = JSON.parse(text(await call(c1, 'server_status', { server: 'MCP-ALPHA' })));
check('server_status by name (case-insensitive), agent online', st.id === A.serverId && st.agentOnline === true);
check('server_status by id', JSON.parse(text(await call(c1, 'server_status', { server: B.serverId }))).agentOnline === false);
const missing = await call(c1, 'server_status', { server: 'nope' });
check('unknown server is a tool error with guidance', missing.isError === true && text(missing).includes('list_servers'));

const ip = JSON.parse(text(await call(c1, 'get_public_ip', { server: 'mcp-alpha' })));
check('get_public_ip returns detected + panel-seen address', typeof ip.addressForDnsARecord === 'string' && ip.panelSawAgentIp === '127.0.0.1' && Array.isArray(ip.notes), JSON.stringify(ip));
const off = await call(c1, 'get_public_ip', { server: 'mcp-beta' });
check('offline server: honest error, no guessing', off.isError === true && /offline/.test(text(off)));

const logs = await call(c1, 'view_logs', { server: 'mcp-alpha', source: 'system', lines: 5 });
check('view_logs system returns text', logs.isError !== true && text(logs).includes('on "mcp-alpha"'));
for (const bad of ["system; rm -rf /", "unit:foo'bar", "unit:a b", "docker:../x", "docker:-v", "file:/etc/shadow", ""]) {
  const r = await call(c1, 'view_logs', { server: 'mcp-alpha', source: bad });
  check(`rejects log source ${JSON.stringify(bad)}`, r.isError === true && /source must be/.test(text(r)));
}
check('rejects lines out of range', (await call(c1, 'view_logs', { server: 'mcp-alpha', lines: 0 })).isError === true && (await call(c1, 'view_logs', { server: 'mcp-alpha', lines: 501 })).isError === true);
check('rejects unexpected arguments', (await call(c1, 'server_status', { server: 'mcp-alpha', extra: 1 })).isError === true);
check('docker source on a machine without Docker is a clean message', /not installed|No such|Error|Cannot connect|daemon/i.test(text(await call(c1, 'view_logs', { server: 'mcp-alpha', source: 'docker:web' }))));
await c1.close();

// ---- scoped token
const c2 = await connect(t2.body.token);
const ls2 = JSON.parse(text(await call(c2, 'list_servers', {})));
check('scoped token sees only its server', ls2.count === 1 && ls2.servers[0].name === 'mcp-alpha');
check('scoped token cannot reach another server', (await call(c2, 'server_status', { server: 'mcp-beta' })).isError === true);
await c2.close();

// ---- read-only scope is enforced
const t4 = await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Read only', scope: 'read' }) });
check('read-only token created', t4.status === 200);
const c4 = await connect(t4.body.token);
const roTools = (await c4.listTools()).tools.map((t) => t.name).sort();
check('read-only connection is not even offered the deploy tools', roTools.join() === 'get_public_ip,list_files,list_servers,read_file,server_status,view_logs');
const denied = await call(c4, 'run_command', { server: 'mcp-alpha', command: 'echo hi' });
check('read-only token is refused a deploy tool', denied.isError === true && /read-only/i.test(text(denied)), text(denied));
check('read-only token can still use a read tool', (await call(c4, 'list_servers', {})).isError !== true);
await c4.close();
check('scope denial is audited', (await pool.query("select 1 from audit_log where server_id = $1 and action = 'mcp.run_command' and meta->>'error' = 'scope denied'", [A.serverId])).rowCount! > 0);

// ---- raw protocol
const post = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${tok}` }, raw = false) =>
  fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ? (body as string) : JSON.stringify(body) });
check('notification -> 202 no body', (await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status === 202);
const batch = await (await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }])).json() as any[];
check('batch answered in one array', Array.isArray(batch) && batch.length === 2 && batch[0].id === 1);
check('unknown method -> JSON-RPC -32601', ((await (await post({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).json()) as any).error?.code === -32601);
check('unknown tool -> JSON-RPC -32602', ((await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } })).json()) as any).error?.code === -32602);
check('unknown protocol version falls back to a supported one', ((await (await post({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json()) as any).result.protocolVersion === '2025-06-18');
check('malformed JSON -> 400', (await post('{not json', { Authorization: `Bearer ${tok}` }, true)).status === 400);
check('GET /mcp -> 405', (await fetch(base + '/mcp', { headers: { Authorization: `Bearer ${tok}` } })).status === 405);

// ---- authentication edges
const noAuth = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {});
check('no token -> 401 with WWW-Authenticate', noAuth.status === 401 && (noAuth.headers.get('www-authenticate') ?? '').startsWith('Bearer'));
check('session cookie does not open /mcp', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { cookie })).status === 401);
check('API token does not open the normal API', (await fetch(base + '/api/servers', { headers: { Authorization: `Bearer ${tok}` } })).status === 401);
check('API token cannot manage tokens', (await fetch(base + '/api/tokens', { headers: { Authorization: `Bearer ${tok}` } })).status === 401);
check('foreign Origin refused', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${tok}`, Origin: 'http://evil.example' })).status === 403);

// ---- audit trail and activity API
const audit = (await pool.query("select action, via from audit_log where server_id = $1 and action like 'mcp.%' order by id", [A.serverId])).rows;
check('every server-level call is audited with the token name', ['mcp.server_status', 'mcp.get_public_ip', 'mcp.view_logs'].every((a) => audit.some((r) => r.action === a && r.via === 'Claude laptop')), JSON.stringify(audit.slice(0, 3)));
const act = await j(`/api/audit?server=${A.serverId}&limit=100`, { headers: { cookie } });
check('Activity API exposes via', act.body.items.some((i: any) => i.via === 'Claude laptop'));

// ---- revoke and expiry
const tid = list1.body.find((t: any) => t.name === 'Claude laptop').id;
check('revoke ok', (await j(`/api/tokens/${tid}`, { method: 'DELETE', headers: { cookie } })).status === 200);
check('revoked token -> 401 immediately', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status === 401);
await pool.query("update api_tokens set expires_at = now() - interval '1 minute' where id = $1", [t2.body.id]);
check('expired token -> 401', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${t2.body.token}` })).status === 401);

// ---- brute force: last, because it blocks this IP's token logins for a while
let last = 0;
for (let i = 0; i < 25; i++) last = (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer snbd_' + 'x'.repeat(30 + (i % 5)) })).status;
const t3 = await j('/api/tokens', { method: 'POST', headers: H, body: JSON.stringify({ name: 'after-blocked' }) });
check('repeated bad tokens are throttled (even a good token is refused for a while)', last === 401 && (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${t3.body.token}` })).status === 401);

proc.kill('SIGKILL');
await pool.query("delete from servers where name like 'mcp-%'; delete from api_tokens where name in ('Claude laptop', 'Only alpha', 'Read only', 'after-blocked', 'x')");
await pool.end();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
