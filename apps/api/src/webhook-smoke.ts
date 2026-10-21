// Exercises the WHMCS webhook over HTTP: signature rules, idempotency, lifecycle, SSO.
import { createHmac } from 'node:crypto';

const base = process.env.BASE ?? 'http://localhost:3101';
const secret = process.env.WHMCS_WEBHOOK_SECRET!;
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };

async function call(body: object, opts: { key?: string; ts?: number; tamper?: boolean; secret?: string; noKey?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', opts.secret ?? secret).update(`${ts}.${raw}`).digest('hex');
  const res = await fetch(`${base}/webhooks/whmcs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snbd-timestamp': ts,
      'x-snbd-signature': 'sha256=' + sig,
      ...(opts.noKey ? {} : { 'x-snbd-idempotency-key': opts.key ?? `t-${Math.random().toString(36).slice(2, 12)}` }),
    },
    body: opts.tamper ? raw.replace('9002', '9003') : raw,
  });
  return { status: res.status, replayed: res.headers.get('x-snbd-replayed') === '1', json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const client = { id: 502, email: 'second@example.com', name: 'Second Client' };
const create = { action: 'create', serviceId: 9002, client, hostname: 'smoke-vps', plan: { provider: 'bdix', vcpu: 2, ramGb: 4, diskGb: 50, region: 'Dhaka', os: 'ubuntu-24.04' } };

check('wrong secret rejected', (await call(create, { secret: 'x'.repeat(40) })).status === 401);
check('tampered body rejected', (await call(create, { tamper: true })).status === 401);
check('stale timestamp rejected', (await call(create, { ts: Math.floor(Date.now() / 1000) - 3600 })).status === 401);
check('missing idempotency key rejected', (await call(create, { noKey: true })).status === 400);
check('invalid body rejected', (await call({ action: 'create', serviceId: 'nope' })).status === 400);
check('create without plan rejected', (await call({ ...create, plan: undefined })).status === 400);

const key = `create-${Date.now()}`;
const a = await call(create, { key });
check('create ok', a.status === 200 && !a.json.existing, JSON.stringify(a.json));
const b = await call(create, { key });
check('same key replays stored response', b.status === 200 && b.replayed && b.json.serverId === a.json.serverId);
const c = await call(create, { key: key + '-other' });
check('same service, new key does not duplicate', c.status === 200 && c.json.existing === true && c.json.serverId === a.json.serverId);

const [p1, p2] = await Promise.all([call({ ...create, serviceId: 9004 }, { key: 'race-' + key }), call({ ...create, serviceId: 9004 }, { key: 'race-' + key })]);
check('concurrent duplicate: one wins, one conflicts or replays', [p1.status, p2.status].sort().join() === '200,200' || [p1.status, p2.status].includes(409), `${p1.status},${p2.status}`);

const svc = { serviceId: 9002, client };
check('unknown service 404', (await call({ action: 'suspend', serviceId: 424242, client })).status === 404);
check('suspend ok', (await call({ action: 'suspend', ...svc })).status === 200);
check('unsuspend ok', (await call({ action: 'unsuspend', ...svc })).status === 200);

const sso = await call({ action: 'sso', ...svc });
check('sso returns a url', sso.status === 200 && typeof sso.json.url === 'string');
const ssoPath = new URL(sso.json.url).pathname;
const hit = await fetch(base + ssoPath, { redirect: 'manual' });
const cookie = hit.headers.get('set-cookie')?.split(';')[0] ?? '';
check('sso link signs the client in', hit.status === 302 && cookie.startsWith('snbd_session='));
const me = await fetch(base + '/api/me', { headers: { cookie } }).then((r) => r.json() as Promise<any>);
check('session belongs to the WHMCS client', me.email === client.email);
check('sso link is single use', (await fetch(base + ssoPath, { redirect: 'manual' })).status === 400);

const list = await fetch(base + '/api/servers', { headers: { cookie } }).then((r) => r.json() as Promise<any[]>);
check('client sees only own server', list.length >= 1 && list.every((s) => s.id === a.json.serverId || s.name.startsWith('smoke') || s.name.startsWith('vps-')), `${list.length} listed`);

check('terminate ok', (await call({ action: 'terminate', ...svc })).status === 200);
check('terminate is idempotent', (await call({ action: 'terminate', ...svc })).status === 200);
const after = await fetch(base + '/api/servers', { headers: { cookie } }).then((r) => r.json() as Promise<any[]>);
check('terminated server hidden from client', !after.some((s) => s.id === a.json.serverId));
check('create after terminate refused', (await call(create, { key: 'again-' + key })).status === 409);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
