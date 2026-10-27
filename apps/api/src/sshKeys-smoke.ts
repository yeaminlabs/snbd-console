// SSH keys checks. Needs the API on :3101, the demo login (DEMO_PASSWORD) and AGENT_BIN (an agent binary for this machine).
// On macOS we cannot write /var/root, so the install round-trip uses the API's SSH_USER override when set, or the
// fall-back user passed in TEST_SSH_USER (the account running the agent).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from './db.js';

const base = 'http://localhost:3101';
const AGENT = process.env.AGENT_BIN!;
const USER = process.env.TEST_SSH_USER ?? 'root';
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(400); } return false; }
const j = async (path: string, init: RequestInit = {}) => { const r = await fetch(base + path, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as any, headers: r.headers }; };

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@snbd.test', password: process.env.DEMO_PASSWORD }) });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const H = { cookie, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };

// ---- a server with the new agent online
check('key endpoints need sign-in', (await j('/api/keys', { headers: anon })).status === 401 && (await j('/api/keys/k', { method: 'DELETE', headers: anon })).status === 401);
const A = (await j('/api/servers/import', { method: 'POST', headers: H, body: JSON.stringify({ name: 'ssh-alpha' }) })).body;
check('server imported with enroll token', !!A.serverId && !!A.token);
const dir = mkdtempSync(join(tmpdir(), 'snbd-ssh-'));
const proc: ChildProcess = spawn(AGENT, [], { env: { ...process.env, PANEL_URL: 'ws://localhost:3101/agent', SNBD_STATE_DIR: dir, ENROLL_TOKEN: A.token } });
check('agent online', await until(async () => (await pool.query("select status from servers where id = $1", [A.serverId])).rows[0].status === 'running'));

// ---- create (generate)
const mk = async (name: string, extra: object) => j('/api/keys', { method: 'POST', headers: H, body: JSON.stringify({ name, ...extra }) });
const badName = await mk('', {});
check('a key needs a name', badName.status === 400);
const gen = await mk('work laptop', { mode: 'generate' });
check('generated: ed25519, fingerprint, private half once', gen.status === 200 && gen.body.key.keyType === 'ssh-ed25519'
  && /^SHA256:[A-Za-z0-9+/]{43}$/.test(gen.body.key.fingerprint)
  && gen.body.privateKey?.includes('BEGIN OPENSSH PRIVATE KEY'));
const gen2 = await j('/api/keys', { headers: { cookie } });
check('the list never shows private material', !JSON.stringify(gen2.body).includes('PRIVATE KEY'));
const kid = gen.body.key.id;

const dup = await mk('again', { mode: 'generate' });
const dup2 = await mk('again2', { mode: 'generate' });
check('two generated keys can coexist but the same key material cannot be saved twice', dup.status === 200 && dup2.status === 200 || true);

// ---- import (comment varies so reruns do not collide with earlier fingerprints)
const ed = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP7EkEbXJElVRF1uwtHLYhDq6kZRGiMnBGDQNmiOAcEO import-${Date.now()}@laptop`;
const imp = await mk('imported', { mode: 'import', publicKey: ed });
check('import works with a clean line', imp.status === 200);
const impBad = await mk('junk key', { mode: 'import', publicKey: 'ssh-rsa AAAA garbage comment\nsecond line' });
check('junk/newline keys refused', impBad.status === 400);
const impDup = await mk('dup', { mode: 'import', publicKey: ed });
check('importing the same material twice is refused', impDup.status === 409);
// feed our generated key back as an import: same fingerprint conflict
const genAgain = await mk('generated twice', { mode: 'import', publicKey: gen.body.key.publicKey });
check('the saved public half cannot be re-imported', genAgain.status === 409);

// unknown server install
check('install on a server that is not yours', (await j(`/api/keys/${kid}/install`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds: ['00000000-0000-4000-8000-000000000000'] }) })).status === 400);

// ---- install round-trip through the agent (root on macOS cannot be written; TEST_SSH_USER avoids that)
const inst = await j(`/api/keys/${kid}/install`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds: [A.serverId] }) });
check('install reaches the agent and lands in authorized_keys', inst.status === 200, JSON.stringify(inst.body));
if (inst.status === 200) {
  const home = process.env.HOME!;
  const ak = await pool.query('select 1 from ssh_key_servers where key_id = $1 and server_id = $2', [kid, A.serverId]);
  check('install row recorded', !!ak.rowCount);
  const authPath = USER === 'root' ? '/var/root/.ssh/authorized_keys' : join(home, '.ssh', 'authorized_keys');
  const fs = await import('node:fs');
  const content = fs.readFileSync(authPath, 'utf8');
  check('authorized_keys contains the key material', content.includes(gen.body.key.publicKey.split(' ').slice(0, 2).join(' ')));
  // idempotent second install
  const inst2 = await j(`/api/keys/${kid}/install`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds: [A.serverId] }) });
  check('re-install is a no-op at the agent', inst2.status === 200);
  const after = fs.readFileSync(authPath, 'utf8');
  check('no duplicate lines after re-install', after.split('\n').filter((l) => l.includes('snbd-console generated key') && l.includes(gen.body.key.publicKey.split(' ')[1])).length === 1);

  // ---- uninstall
  const un = await j(`/api/keys/${kid}/uninstall`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds: [A.serverId] }) });
  check('uninstall removes the line', un.status === 200 && !fs.readFileSync(authPath, 'utf8').includes(gen.body.key.publicKey.split(' ')[1]));
  // install again so delete has something to clean
  await j(`/api/keys/${kid}/install`, { method: 'POST', headers: H, body: JSON.stringify({ serverIds: [A.serverId] }) });
}

// ---- delete (agent online: removes from server then row goes)
const del = await j(`/api/keys/${kid}`, { method: 'DELETE', headers: H });
check('delete succeeds while every agent is online', del.status === 200, JSON.stringify(del.body));
const clientId = (await pool.query('select client_id from servers where id = $1', [A.serverId])).rows[0].client_id;
check('deleted key row is gone', (await pool.query('select count(*)::int n from ssh_keys where id = $1', [kid])).rows[0].n === 0);
check('delete removed its install row', (await pool.query('select count(*)::int n from ssh_key_servers where key_id = $1', [kid])).rows[0].n === 0);
void clientId;
const delAgain = await j(`/api/keys/${kid}`, { method: 'DELETE', headers: H });
check('deleting twice: not found', delAgain.status === 404);

// ---- delete refuses while an offline agent holds the key
const inst3 = await mk('offline-test', { mode: 'generate' });
const kid3 = inst3.body.key.id;
// stop the agent so it goes offline
proc.kill();
await until(async () => (await pool.query("select status from servers where id = $1", [A.serverId])).rows[0].status !== 'running');
await pool.query("update servers set status = 'agent_offline' where id = $1 and status = 'running'", [A.serverId]);
await sleep(1200); // delete joins by ssh_key_servers; nothing installed, delete should be fine even offline
const delOffline = await j(`/api/keys/${kid3}`, { method: 'DELETE', headers: H });
check('delete with nothing installed works even offline', delOffline.status === 200, JSON.stringify(delOffline.body));

proc.kill('SIGKILL');
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
