// End-to-end: WHMCS webhook -> Hetzner adapter (against scripts/mock-hetzner.mjs) -> VM boots from the
// user-data it was sent (a Linux container) -> power, reinstall, resize, terminate.
// Needs: mock on :4010, API started with HETZNER_API_TOKEN=test-token HETZNER_API_URL=http://localhost:4010/v1
//        PUBLIC_PANEL_URL=http://host.docker.internal:3101, Docker running.
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = 'http://localhost:3101', mock = 'http://localhost:4010';
const secret = process.env.WHMCS_WEBHOOK_SECRET!;
const testDir = resolve(import.meta.dirname, '..', '..', '..', 'dist', 'test');
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const j = (url: string, init?: RequestInit) => fetch(url, init).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as any, headers: r.headers }));

const client = { id: 601, email: 'prov@example.com', name: 'Prov Client' };
let seq = 0;
async function hook(body: object) {
  const raw = JSON.stringify({ client, ...body }); const ts = String(Math.floor(Date.now() / 1000));
  return j(base + '/webhooks/whmcs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-snbd-timestamp': ts, 'x-snbd-signature': 'sha256=' + createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex'), 'x-snbd-idempotency-key': `ps-${Date.now()}-${seq++}` }, body: raw });
}
const mockLog = async () => (await j(mock + '/_log')).body as any[];
const calls = async (re: RegExp) => (await mockLog()).filter((c) => re.test(`${c.method} ${c.path}`));

// a "VM": installs and starts the agent from the cloud-config it was given
function ensureBaseImage() {
  try { execSync('docker image inspect snbd-vm-base', { stdio: 'ignore' }); return; } catch {}
  console.log('building snbd-vm-base image (once)...');
  execSync(`docker build -q -t snbd-vm-base - <<'EOF'
FROM ubuntu:24.04
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates openssl python3-yaml >/dev/null
EOF`, { stdio: 'inherit', shell: '/bin/bash' });
}
function bootVm(name: string, userData: string) {
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, `${name}.yaml`), userData);
  writeFileSync(join(testDir, 'emulate.py'), `import yaml, os, subprocess, sys
cfg = yaml.safe_load(open(sys.argv[1]))
for f in cfg['write_files']:
    os.makedirs(os.path.dirname(f['path']), exist_ok=True)
    open(f['path'], 'w').write(f['content']); os.chmod(f['path'], int(f['permissions'], 8))
for cmd in cfg['runcmd']:
    subprocess.run(cmd, shell=isinstance(cmd, str), env={**os.environ, 'SNBD_INSECURE': '1', 'SNBD_SKIP_SERVICE': '1'}, check=True)
`);
  execSync(`docker rm -f ${name} >/dev/null 2>&1; docker run -d --name ${name} --add-host host.docker.internal:host-gateway -v "${testDir}:/t:ro" snbd-vm-base sh -c "python3 /t/emulate.py /t/${name}.yaml && set -a && . /etc/snbd/agent.env && exec /usr/local/bin/snbd-agent" >/dev/null`, { shell: '/bin/bash' });
}
const killVm = (name: string) => { try { execSync(`docker rm -f ${name}`, { stdio: 'ignore' }); } catch {} };
async function until<T>(fn: () => Promise<T | false>, ms = 60000): Promise<T | false> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1500)); }
  return false;
}

ensureBaseImage();
await j(mock + '/_reset');
const plan = { provider: 'hetzner', vcpu: 2, ramGb: 4, diskGb: 40, region: 'hel1', os: 'ubuntu-24.04', serverType: 'cx22' };

// ---- create
const created = await hook({ action: 'create', serviceId: 9101, hostname: 'My_Client VPS!', plan });
check('create ok', created.status === 200, JSON.stringify(created.body));
const post = (await calls(/^POST \/servers$/))[0];
check('POST /servers sent with bearer token', post?.auth === 'Bearer test-token');
check('hostname sanitised + unique suffix', /^my-client-vps-[0-9a-f]{8}$/.test(post?.body?.name ?? ''), post?.body?.name);
check('server_type / image / location passed', post?.body?.server_type === 'cx22' && post?.body?.image === 'ubuntu-24.04' && post?.body?.location === 'hel1');
check('label ties VM to panel server', post?.body?.labels?.snbd_server_id === created.body.serverId);
check('user_data carries enroll token + installer', /ENROLL_TOKEN=[0-9a-f]{48}/.test(post?.body?.user_data ?? '') && post.body.user_data.includes('/install.sh'));
const sso = await hook({ action: 'sso', serviceId: 9101 });
const cookie = (await fetch(base + new URL(sso.body.url).pathname, { redirect: 'manual' })).headers.get('set-cookie')!.split(';')[0];
const auth = { cookie, 'content-type': 'application/json' };
const getServer = async (id: string) => (await j(`${base}/api/servers/${id}`, { headers: auth })).body;
const sid = created.body.serverId;
let s = await getServer(sid);
check('provider id + ip stored, capabilities exposed', !!s.ip && s.capabilities?.rebuild === true && s.status === 'provisioning', JSON.stringify(s));

// ---- failure then retry
await j(mock + '/_fail/POST/servers');
const bad = await hook({ action: 'create', serviceId: 9102, plan });
check('provider failure surfaces as 502', bad.status === 502, String(bad.status));
const retry = await hook({ action: 'create', serviceId: 9102, plan });
check('retry after failure succeeds', retry.status === 200 && !!retry.body.serverId, JSON.stringify(retry.body));
check('exactly one VM per service (no duplicates)', (await calls(/^POST \/servers$/)).filter((c) => c.body?.labels?.snbd_server_id === retry.body.serverId).length === 2 /* 1 failed + 1 ok */);
check('missing serverType rejected', (await hook({ action: 'create', serviceId: 9103, plan: { ...plan, serverType: undefined } })).status === 502);

// ---- first boot from the user-data
bootVm('snbd-vm1', post.body.user_data);
const up = await until(async () => (await getServer(sid)).status === 'running');
check('VM1 booted from user-data and enrolled', !!up);

// ---- power
check('stop ok', (await j(`${base}/api/servers/${sid}/power`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'stop' }) })).status === 200);
check('stop sent shutdown to Hetzner', (await calls(/actions\/shutdown/)).length === 1);
check('status shows stopped', (await getServer(sid)).status === 'stopped');
check('start ok', (await j(`${base}/api/servers/${sid}/power`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start' }) })).status === 200);
check('reboot ok', (await j(`${base}/api/servers/${sid}/power`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'reboot' }) })).status === 200);
check('bad power action rejected', (await j(`${base}/api/servers/${sid}/power`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'format' }) })).status === 400);
const other = await j(`${base}/api/servers/${sid}/power`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
check('power needs sign-in', other.status === 401);

// ---- reinstall
const re = (body: object) => j(`${base}/api/servers/${sid}/reinstall`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
check('reinstall needs acknowledgement', (await re({ os: 'debian-12' })).status === 400);
check('reinstall rejects unknown os', (await re({ os: 'windows-95', acknowledged: true })).status === 400);
await j(mock + '/_fail/POST/servers/:id/actions/rebuild');
check('provider refusal -> 502', (await re({ os: 'debian-12', acknowledged: true })).status === 502);
await until(async () => (await getServer(sid)).status === 'running', 20000); // next heartbeat (10 s) clears the post-start state
s = await getServer(sid);
check('refusal leaves server untouched and unlocked', s.status === 'running' && s.agentConnected && !s.reinstall_started_at && s.os === 'ubuntu-24.04', JSON.stringify(s));
const ok = await re({ os: 'debian-12', acknowledged: true });
check('reinstall ok, root password returned once', ok.status === 200 && ok.body.rootPassword === 'mock-root-pw-rebuild' && ok.headers.get('cache-control') === 'no-store', JSON.stringify(ok.body));
const rebuild = (await calls(/actions\/rebuild/)).pop();
check('rebuild sent image + fresh user_data', rebuild?.body?.image === 'debian-12' && /ENROLL_TOKEN=[0-9a-f]{48}/.test(rebuild?.body?.user_data ?? '') && rebuild.body.user_data !== post.body.user_data);
s = await getServer(sid);
check('status provisioning, os updated, reinstall flagged', s.status === 'provisioning' && s.os === 'debian-12' && !!s.reinstall_started_at, JSON.stringify(s));
check('second reinstall blocked while one is running', (await re({ os: 'debian-12', acknowledged: true })).status === 409);
const oldAgentGone = await until(async () => !(await getServer(sid)).agentConnected, 15000);
check('old agent cut off', !!oldAgentGone);
killVm('snbd-vm1');

bootVm('snbd-vm2', rebuild.body.user_data);
const up2 = await until(async () => (await getServer(sid)).status === 'running');
s = await getServer(sid);
check('VM2 re-enrolled by itself, flag cleared', !!up2 && !s.reinstall_started_at && s.agentConnected, JSON.stringify(s));
killVm('snbd-vm2');

// ---- providers without support
const bdix = await hook({ action: 'create', serviceId: 9104, plan: { provider: 'bdix', vcpu: 2, region: 'Dhaka' } });
const bsso = await hook({ action: 'sso', serviceId: 9104 });
const bck = (await fetch(base + new URL(bsso.body.url).pathname, { redirect: 'manual' })).headers.get('set-cookie')!.split(';')[0];
const bre = await j(`${base}/api/servers/${bdix.body.serverId}/reinstall`, { method: 'POST', headers: { cookie: bck, 'content-type': 'application/json' }, body: JSON.stringify({ os: 'debian-12', acknowledged: true }) });
check('BDIX reinstall honestly refused (501)', bre.status === 501);
check('BDIX server reports no capabilities', (await j(`${base}/api/servers/${bdix.body.serverId}`, { headers: { cookie: bck } })).body.capabilities.rebuild === false);

// ---- resize + terminate
await j(mock + '/_log'); 
const before = (await mockLog()).length;
check('changepackage ok', (await hook({ action: 'changepackage', serviceId: 9101, plan: { ...plan, serverType: 'cx32' } })).status === 200);
const seqCalls = (await mockLog()).slice(before).map((c) => c.path.split('/').pop());
check('resize = poweroff -> change_type -> poweron', seqCalls.join() === 'poweroff,change_type,poweron', seqCalls.join());
check('change_type keeps disk (upgrade_disk=false)', (await calls(/change_type/)).pop()?.body?.upgrade_disk === false);
check('terminate ok', (await hook({ action: 'terminate', serviceId: 9101 })).status === 200);
check('terminate deleted the Hetzner server', (await calls(/^DELETE \/servers\/\d+$/)).length === 1);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
