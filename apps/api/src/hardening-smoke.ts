// Hardening checks. API must run with: ALERT_WEBHOOK_URL=http://localhost:4020 ALERT_GRACE_SECONDS=3 MONITOR_INTERVAL_MS=1000
// KEY_ROTATE_AFTER_DAYS=30. Set AGENT_BIN to a built agent for this machine.
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from './db.js';
import { runMaintenance } from './maintenance.js';

const base = 'http://localhost:3101';
const AGENT = process.env.AGENT_BIN!;
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(500); } return false; }
const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// ---- alert receiver
const alerts: any[] = [];
const recv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { alerts.push(JSON.parse(b)); res.end('ok'); }); }).listen(4020);

// ---- login lockout
const email = `nobody-${Date.now()}@example.com`;
const codes: number[] = [];
for (let i = 0; i < 7; i++) codes.push((await post('/api/login', { email, password: 'wrong' })).status);
check('5 wrong logins -> 401, then 429', codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429 && codes[6] === 429, codes.join());
check('another email is unaffected', (await post('/api/login', { email: 'other-' + email, password: 'x' })).status === 401);

// ---- origin check + headers
const evil = await post('/api/logout', {}, { origin: 'http://evil.example' });
check('cross-site POST refused', evil.status === 403);
check('same-origin POST allowed', (await post('/api/logout', {}, { origin: 'http://localhost:3101' })).status === 200);
check('POST without Origin allowed (curl, WHMCS)', (await post('/api/logout', {})).status === 200);
const h = (await fetch(base + '/api/me')).headers;
check('security headers set', h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && h.get('referrer-policy') === 'no-referrer');

// ---- maintenance
await pool.query("insert into sessions (token_hash, client_id, expires_at) select 'old-session', id, now() - interval '1 day' from clients limit 1");
await pool.query("insert into webhook_events (key, state, created_at) values ('old-event-1', 'done', now() - interval '40 days'), ('new-event-1', 'done', now())");
const srv = (await pool.query("select id from servers limit 1")).rows[0];
if (srv) {
  await pool.query("insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, 'expired-token', now() - interval '3 days')", [srv.id]);
  await pool.query("insert into heartbeats (server_id, at, cpu, mem_used, mem_total, disk_used, disk_total, uptime) values ($1, now() - interval '45 days', 1, 1, 1, 1, 1, 1)", [srv.id]);
}
const m = await runMaintenance();
check('maintenance removes expired data', m.sessions >= 1 && m.webhookEvents >= 1 && (!srv || (m.enrollTokens >= 1 && m.heartbeats >= 1)), JSON.stringify(m));
check('maintenance keeps fresh data', (await pool.query("select 1 from webhook_events where key = 'new-event-1'")).rowCount === 1);
await pool.query("delete from webhook_events where key = 'new-event-1'");

// ---- agent: enroll, alert, rotation
const login = await post('/api/login', { email: 'demo@snbd.test', password: 'demo-password' });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const imp = await (await fetch(base + '/api/servers/import', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'hardening-test' }) })).json() as any;
const sid: string = imp.serverId;
const dir = mkdtempSync(join(tmpdir(), 'snbd-agent-'));
let proc: ChildProcess | null = null;
const logs: string[] = [];
const start = (token = '') => { proc = spawn(AGENT, [], { env: { ...process.env, PANEL_URL: 'ws://localhost:3101/agent', SNBD_STATE_DIR: dir, ENROLL_TOKEN: token } }); proc.stderr!.on('data', (d) => logs.push(String(d))); };
const stop = (sig: NodeJS.Signals = 'SIGKILL') => { proc?.kill(sig); };
const status = async () => (await pool.query('select status, offline_since, offline_alerted_at from servers where id = $1', [sid])).rows[0];
const keyOnDisk = () => JSON.parse(readFileSync(join(dir, 'agent.json'), 'utf8')).key as string;

start(imp.token);
check('agent enrolled', await until(async () => (await status()).status === 'running'));

stop();
check('disconnect marks offline_since', await until(async () => !!(await status()).offline_since, 8000));
check('alert webhook fired after grace period', await until(async () => alerts.some((a) => a.event === 'agent.offline' && a.serverId === sid), 15000), JSON.stringify(alerts));
check('alert text names the server', alerts.find((a) => a.serverId === sid)?.text.includes('hardening-test'));
const n = alerts.length; await sleep(4000);
check('no repeat alert while still offline', alerts.length === n);
start();
check('recovery notice sent when it returns', await until(async () => alerts.some((a) => a.event === 'agent.online' && a.serverId === sid), 15000));
check('alert state cleared after recovery', await until(async () => { const s = await status(); return !s.offline_alerted_at && !s.offline_since; }, 8000));

// rotation
const before = keyOnDisk();
copyFileSync(join(dir, 'agent.json'), join(dir, 'old-state.json'));
await pool.query("update agent_keys set key_set_at = now() - interval '40 days' where server_id = $1", [sid]);
check('agent receives and stores a new key', await until(async () => keyOnDisk() !== before, 15000), logs.join('').slice(-200));
check('panel holds the pending key', (await pool.query('select next_key_hash is not null as p from agent_keys where server_id = $1', [sid])).rows[0].p === true);
stop(); await sleep(500); start();
check('new key promoted on next connect', await until(async () => (await pool.query('select next_key_hash is null as done from agent_keys where server_id = $1', [sid])).rows[0].done === true, 15000));
check('rotation audited', Number((await pool.query("select count(*) from audit_log where server_id = $1 and action = 'agent.key_rotated'", [sid])).rows[0].count) === 1);
stop();

// the lockout-safety case: agent loses the new key and still holds the old one
await pool.query("update agent_keys set key_set_at = now() - interval '40 days' where server_id = $1", [sid]);
copyFileSync(join(dir, 'agent.json'), join(dir, 'pre-rotation.json'));
start();
await until(async () => keyOnDisk() !== JSON.parse(readFileSync(join(dir, 'pre-rotation.json'), 'utf8')).key, 15000);
stop(); await sleep(500);
copyFileSync(join(dir, 'pre-rotation.json'), join(dir, 'agent.json')); // "message lost": agent comes back with the OLD key
start();
check('old key still works while a rotation is pending', await until(async () => (await status()).status === 'running', 12000));
stop();

// wrong key rejected and IP-limited
{
  const bad = join(dir, 'agent.json');
  execSync(`printf '{"serverId":"${sid}","key":"deadbeef"}' > ${bad}`);
  start();
  await sleep(3000);
  check('wrong key is rejected', (await status()).status !== 'running');
  stop();
}

// ---- dead connection detection (agent frozen, TCP still open)
execSync(`cp ${join(dir, 'pre-rotation.json')} ${join(dir, 'agent.json')}`);
await pool.query('delete from agent_keys where server_id = $1', [sid]);
const t2 = await (await fetch(base + '/api/servers/import', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'hardening-freeze' }) })).json() as any;
const dir2 = mkdtempSync(join(tmpdir(), 'snbd-agent-'));
proc = spawn(AGENT, [], { env: { ...process.env, PANEL_URL: 'ws://localhost:3101/agent', SNBD_STATE_DIR: dir2, ENROLL_TOKEN: t2.token } });
check('second agent enrolled', await until(async () => (await pool.query('select status from servers where id = $1', [t2.serverId])).rows[0].status === 'running'));
proc.kill('SIGSTOP');
check('frozen agent detected by ping timeout (~50 s)', await until(async () => (await pool.query('select status from servers where id = $1', [t2.serverId])).rows[0].status === 'agent_offline', 75000));
proc.kill('SIGKILL');

// ---- audit API
const au = await (await fetch(base + '/api/audit?limit=5', { headers: { cookie } })).json() as any;
check('audit API returns newest first with a cursor', au.items.length === 5 && au.items[0].id > au.items[4].id && au.next === au.items[4].id);
const au2 = await (await fetch(base + `/api/audit?limit=5&before=${au.next}`, { headers: { cookie } })).json() as any;
check('audit paging does not repeat items', au2.items.every((i: any) => i.id < au.next));
const filtered = await (await fetch(base + `/api/audit?server=${sid}&limit=100`, { headers: { cookie } })).json() as any;
check('audit filter by server', filtered.items.length > 3 && filtered.items.every((i: any) => i.serverId === sid));
check('audit needs sign-in / valid id', (await fetch(base + '/api/audit')).status === 401 && (await fetch(base + '/api/audit?server=nope', { headers: { cookie } })).status === 400);

await pool.query("delete from servers where name like 'hardening-%'");
recv.close();
await pool.end();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
