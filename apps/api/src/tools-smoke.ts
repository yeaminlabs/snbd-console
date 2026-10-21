// End-to-end for files, password reset and app installs. A container plays the VPS.
// Needs Docker, the API on :3101 started with PUBLIC_PANEL_URL=http://host.docker.internal:3101, and the demo seed user.
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const base = 'http://localhost:3101';
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const sh = (cmd: string) => execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@snbd.test', password: 'demo-password' }) });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const H = { cookie, 'content-type': 'application/json' };
const api = async (path: string, init: RequestInit = {}) => { const r = await fetch(base + path, { ...init, headers: { ...H, ...(init.headers as object) } }); return { status: r.status, body: (await r.clone().json().catch(() => ({}))) as any, res: r }; };

// ---- boot a VPS container from the one-liner
const imp = await api('/api/servers/import', { method: 'POST', body: JSON.stringify({ name: 'tools-test-' + Date.now() % 10000 }) });
const sid = imp.body.serverId as string;
const vm = 'snbd-tools-vm';
sh(`docker rm -f ${vm} >/dev/null 2>&1; docker run -d --name ${vm} --add-host host.docker.internal:host-gateway snbd-vm-base sh -c "curl -fsSL http://host.docker.internal:3101/enroll/${imp.body.token} | SNBD_INSECURE=1 SNBD_SKIP_SERVICE=1 sh && set -a && . /etc/snbd/agent.env && exec /usr/local/bin/snbd-agent" >/dev/null`);
for (let i = 0; i < 40; i++) { if ((await api(`/api/servers/${sid}`)).body.agentConnected) break; await sleep(1500); }
check('VPS container enrolled', (await api(`/api/servers/${sid}`)).body.agentConnected === true);
check('agent is the new build', (await api(`/api/servers/${sid}`)).body.agent_version === sh('cat ../../agent/VERSION'));

const S = `/api/servers/${sid}`;
const q = (p: string) => encodeURIComponent(p);

// ---- files
check('list requires sign-in', (await fetch(`${base}${S}/files?path=/`)).status === 401);
check('unknown server 404', (await api('/api/servers/00000000-0000-4000-8000-000000000000/files?path=/')).status === 404);
check('relative path rejected', (await api(`${S}/files?path=etc`)).status === 400);
const root = await api(`${S}/files?path=/etc`);
check('list /etc', root.status === 200 && root.body.entries.some((e: any) => e.name === 'hostname' && e.type === 'file'));
check('dirs sorted before files', (() => { const t = root.body.entries.map((e: any) => e.type); return t.indexOf('file') === -1 || t.lastIndexOf('dir') < t.indexOf('file'); })());
check('mkdir', (await api(`${S}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: '/srv/work' }) })).status === 200);
check('mkdir twice fails cleanly', (await api(`${S}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: '/srv/work' }) })).status === 400);

const text = 'hello\nünïcödé ✓\nline3\n';
check('save text file', (await api(`${S}/files/content`, { method: 'PUT', body: JSON.stringify({ path: '/srv/work/a.txt', content: text }) })).status === 200);
check('read it back byte-exact', (await api(`${S}/files/content?path=${q('/srv/work/a.txt')}`)).body.content === text);
check('on disk matches', sh(`docker exec ${vm} cat /srv/work/a.txt`) === text.trim());
sh(`docker exec ${vm} chmod 750 /srv/work/a.txt`);
await api(`${S}/files/content`, { method: 'PUT', body: JSON.stringify({ path: '/srv/work/a.txt', content: 'v2' }) });
check('editor save keeps permissions, leaves no temp files', sh(`docker exec ${vm} sh -c "stat -c %a /srv/work/a.txt; ls -A /srv/work | grep -c snbd || true"`) === '750\n0'.replace('\n', '\n'));

const big = randomBytes(3_500_000 + 123);
const up = await fetch(`${base}${S}/files/upload?dir=${q('/srv/work')}&name=${q('big.bin')}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: big });
check('upload 3.5 MB (multi-part)', up.status === 200 && (await up.json()).size === big.length);
check('uploaded bytes identical on disk', sh(`docker exec ${vm} sha256sum /srv/work/big.bin | cut -d' ' -f1`) === sha(big));
check('no .snbd-upload leftovers', sh(`docker exec ${vm} sh -c "ls -A /srv/work | grep -c upload || true"`) === '0');
const dl = await fetch(`${base}${S}/files/download?path=${q('/srv/work/big.bin')}`, { headers: { cookie } });
const got = Buffer.from(await dl.arrayBuffer());
check('download identical + headers', dl.status === 200 && sha(got) === sha(big) && dl.headers.get('content-length') === String(big.length) && /attachment/.test(dl.headers.get('content-disposition') ?? ''));
check('empty file upload', (await fetch(`${base}${S}/files/upload?dir=/srv/work&name=empty`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: new Uint8Array(0) })).status === 200 && sh(`docker exec ${vm} stat -c %s /srv/work/empty`) === '0');
check('large file refused by editor (413)', (await api(`${S}/files/content?path=${q('/srv/work/big.bin')}`)).status === 413);
await fetch(`${base}${S}/files/upload?dir=/srv/work&name=small.bin`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100), randomBytes(2000)]) });
check('binary file refused by editor (415)', (await api(`${S}/files/content?path=${q('/srv/work/small.bin')}`)).status === 415);
check('bad upload name rejected', (await fetch(`${base}${S}/files/upload?dir=/srv/work&name=${q('../evil')}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: 'x' })).status === 400);
check('rename', (await api(`${S}/files/rename`, { method: 'POST', body: JSON.stringify({ from: '/srv/work/a.txt', to: '/srv/work/b.txt' }) })).status === 200);
check('rename onto existing refused', (await api(`${S}/files/rename`, { method: 'POST', body: JSON.stringify({ from: '/srv/work/b.txt', to: '/srv/work/empty' }) })).status === 400);
check('delete folder recursively', (await api(`${S}/files/delete`, { method: 'POST', body: JSON.stringify({ path: '/srv/work' }) })).status === 200 && sh(`docker exec ${vm} sh -c "test -e /srv/work && echo yes || echo no"`) === 'no');
for (const p of ['/', '/etc', '/usr']) check(`refuses to delete ${p}`, (await api(`${S}/files/delete`, { method: 'POST', body: JSON.stringify({ path: p }) })).status === 400);

// ---- password
const before = sh(`docker exec ${vm} sh -c "getent shadow root | cut -d: -f2"`);
const pw = await api(`${S}/password-reset`, { method: 'POST' });
check('password reset returns a 20-char password, no-store', pw.status === 200 && pw.body.password?.length === 20 && pw.res.headers.get('cache-control') === 'no-store');
const after = sh(`docker exec ${vm} sh -c "getent shadow root | cut -d: -f2"`);
// Ubuntu stores yescrypt hashes; libcrypt (via python) verifies whatever scheme the system chose
check('shadow hash changed and matches the returned password', after !== before && sh(`docker exec ${vm} python3 -c "import crypt,sys; print(crypt.crypt(sys.argv[1], sys.argv[2]) == sys.argv[2])" '${pw.body.password}' '${after}'`) === 'True', after.slice(0, 6));
check('password is not stored by the panel', (await api(`${S}`)).body.password === undefined && sh(`psql -d snbd_console -tAc "select count(*) from audit_log where meta::text like '%${pw.body.password}%'"`) === '0');

// ---- apps
const list0 = await api(`${S}/apps`);
check('app list with installed flags', list0.status === 200 && list0.body.apps.length === 7 && list0.body.apps.find((a: any) => a.id === 'node').installed === false);
async function runJob(app: string, maxMs = 300000) {
  const start = await api(`${S}/apps/${app}/install`, { method: 'POST' });
  if (start.status !== 200) return { start, final: null as any, log: '' };
  let off = 0, log = '', cur: any;
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    cur = (await api(`${S}/jobs/${start.body.jobId}?from=${off}`)).body;
    log += cur.log; off = cur.offset;
    if (cur.status === 'done' || cur.status === 'failed') break;
    await sleep(1500);
  }
  return { start, final: cur, log };
}
const node = await runJob('node');
check('node install job finished OK', node.final?.status === 'done' && node.final.pct === 100, node.final?.status + ' ' + node.log.slice(-400));
check('log streamed with step markers', /##STEP 1\/3/.test(node.log) && /Node.js is ready/.test(node.log));
check('node really installed', /^v22\./.test(sh(`docker exec ${vm} node --version`)));
check('app list now shows node installed', (await api(`${S}/apps`)).body.apps.find((a: any) => a.id === 'node').installed === true);
const claude = await runJob('claude');
check('claude code install finished OK', claude.final?.status === 'done', claude.log.slice(-400));
check('claude binary works', /Claude Code/.test(sh(`docker exec ${vm} claude --version`)));
check('unknown app 404', (await api(`${S}/apps/nope/install`, { method: 'POST' })).status === 404);

// one at a time + cancel
const d = await api(`${S}/apps/docker/install`, { method: 'POST' });
check('docker install started', d.status === 200);
check('second install while one runs -> 409', (await api(`${S}/apps/ollama/install`, { method: 'POST' })).status === 409);
await sleep(8000);
const mid = (await api(`${S}/jobs/${d.body.jobId}`)).body;
check('progress is reported mid-run', mid.status === 'running' && mid.pct >= 0 && mid.step.length > 0, JSON.stringify({ s: mid.status, p: mid.pct, st: mid.step }));
check('cancel accepted', (await api(`${S}/jobs/${d.body.jobId}/cancel`, { method: 'POST' })).status === 200);
let cj: any; for (let i = 0; i < 20; i++) { cj = (await api(`${S}/jobs/${d.body.jobId}`)).body; if (cj.status !== 'running') break; await sleep(1000); }
check('cancelled job ends as failed', cj.status === 'failed');
const stray = sh(`docker exec ${vm} sh -c "ps -eo pid,args | grep -E 'get[.]docker|apt-get|dpkg|curl' | grep -v grep | grep -v defunct || true"`);
check('no stray installer processes left', stray === '', stray);

// agent drop kills the job and the panel notices
const d2 = await api(`${S}/apps/docker/install`, { method: 'POST' });
check('install can start again after cancel', d2.status === 200, JSON.stringify(d2.body));
await sleep(4000);
sh(`docker kill ${vm}`);
await sleep(3000);
const lost = (await api(`${S}/jobs/${d2.body.jobId}`)).body;
check('dropped connection marks the job failed with a note', lost.status === 'failed' && /connection to the server was lost/.test(lost.log), JSON.stringify(lost).slice(0, 200));
check('tools refuse while agent is offline (503)', (await api(`${S}/files?path=/`)).status === 503);

sh(`docker rm -f ${vm}`);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
