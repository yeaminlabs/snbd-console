import { randomBytes, randomUUID } from 'node:crypto';
import { pool, sha256 } from './db.js';

// Dev-only: fills the LOCAL panel with rich mock data for screenshots / video tours.
//   pnpm migrate && pnpm seed && pnpm --filter @snbd/api mock-demo
// Then sign in with the demo login. Every page (Servers, Overview, Activity,
// Agents/MCP, Keys, Apps job history) shows a full, lively state.
//
// LOCAL ONLY: refuses to run unless the panel URL is localhost. Nothing here
// is referenced by production code; the file is never imported by server.ts.

const panelUrl = process.env.PUBLIC_PANEL_URL ?? 'http://localhost:3101';
if (!/localhost|127\.0\.0\.1/.test(panelUrl)) {
  console.error(`Refusing to plant mock data: PUBLIC_PANEL_URL=${panelUrl} is not localhost.`);
  await pool.end();
  process.exit(1);
}

const email = process.env.SEED_EMAIL ?? 'demo@snbd.test';
const client = (await pool.query('select id from clients where email = $1', [email])).rows[0];
if (!client) {
  console.error(`No client ${email} — run "pnpm seed" first.`);
  await pool.end();
  process.exit(1);
}
const cid: string = client.id;
const now = Date.now();
const min = 60_000;
const at = (minutesAgo: number, seconds = 0) => new Date(now - minutesAgo * min - seconds * 1000);
const GB = 1024 ** 3;

// ── servers ────────────────────────────────────────────────────────────────
type Srv = [string, string, string, string | null, string | null, string, string | null];
const servers: Srv[] = [
  // name            provider    status          ip              region  plan                                       os
  ['web-01',        'hetzner',  'running',      '157.90.10.21', 'hel1', '{"vcpu":4,"ramGb":8,"diskGb":160}',      'Ubuntu 24.04'],
  ['db-01',         'hetzner',  'running',      '157.90.10.22', 'nbg1', '{"vcpu":8,"ramGb":16,"diskGb":320}',     'Debian 12'],
  ['staging-01',    'hetzner',  'agent_offline','157.90.10.23', 'fsn1', '{"vcpu":2,"ramGb":4,"diskGb":80}',       'Ubuntu 22.04'],
  ['backup-01',     'imported', 'stopped',      '203.0.113.50', null,   '{"vcpu":2,"ramGb":2,"diskGb":100}',      'Debian 11'],
  ['eu-vps-02',     'hetzner',  'provisioning', null,           'hel1', '{"vcpu":2,"ramGb":4,"diskGb":80}',       null],
];
const ids: Record<string, string> = {};
// Wipe previous mock servers first (cascades heartbeats/jobs/agent_keys;
// tokens+grants referencing them were deleted above/below by name).
await pool.query('delete from servers where client_id=$1 and name = any($2)', [cid, servers.map((s) => s[0])]);
for (const [name, provider, status, ip, region, plan, os] of servers) {
  const r = (
    await pool.query(
      `insert into servers (client_id, name, provider, status, ip, region, plan, os)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       returning id`,
      [cid, name, provider, status, ip, region, plan, os],
    )
  ).rows[0];
  ids[name] = r.id;
}
// dev-box (from pnpm seed) is the live-agent box: keep it, mark running.
const dev = (await pool.query("select id from servers where client_id=$1 and name='dev-box'", [cid])).rows[0];
if (dev) {
  ids['dev-box'] = dev.id;
  await pool.query("update servers set status='running', os=coalesce(os,'local'), ip=coalesce(ip,'127.0.0.1') where id=$1", [dev.id]);
}

// ── agent keys (version + last seen; live "connected" needs a real agent socket) ──
for (const [name, seenMinAgo, version] of [['web-01', 2, '0.5.1'], ['db-01', 4, '0.5.1'], ['staging-01', 2880, '0.4.2']] as const) {
  await pool.query(
    `insert into agent_keys (server_id, key_hash, agent_version, last_seen_at, key_set_at)
     values ($1,$2,$3,$4,now())
     on conflict (server_id) do update set agent_version=$3, last_seen_at=$4`,
    [ids[name], sha256(randomBytes(32).toString('hex')), version, at(seenMinAgo)],
  );
}

// ── heartbeats: 24h @ 5min for the running boxes → full metric charts ──────
for (const name of ['web-01', 'db-01', 'dev-box']) {
  if (!ids[name]) continue;
  await pool.query('delete from heartbeats where server_id=$1', [ids[name]]);
  const total = name === 'db-01' ? 16 * GB : 8 * GB;
  const disk = name === 'db-01' ? 320 * GB : 160 * GB;
  const vals: string[] = [];
  for (let i = 288; i >= 0; i--) {
    const t = new Date(now - i * 5 * min).toISOString();
    const wave = Math.sin(i / 18) * 12 + Math.sin(i / 5) * 5;
    const spike = i % 97 === 0 ? 34 : 0;
    const cpu = Math.max(2, 28 + wave + spike + (name === 'db-01' ? 14 : 0));
    const mem = Math.round(total * (0.58 + Math.sin(i / 40) * 0.06 + (288 - i) * 0.00002));
    const du = Math.round(disk * (0.31 + (288 - i) * 0.00004));
    vals.push(`('${ids[name]}','${t}',${cpu.toFixed(1)},${mem},${total},${du},${disk},${(14 * 24 * 3600 - i * 300)})`);
  }
  await pool.query(
    'insert into heartbeats (server_id, at, cpu, mem_used, mem_total, disk_used, disk_total, uptime) values ' + vals.join(','),
  );
}

// ── API tokens → Active Connections (recent last_used = live/idle w/ logos) ─
const tokenNames = ['Claude Code', 'OpenCode', 'Cursor', 'Claude', 'Codex', 'Windsurf'];
await pool.query('delete from api_tokens where client_id=$1 and name = any($2)', [cid, tokenNames]);
type Tok = [string, string, string[] | null, number, string, string, string];
const tokens: Tok[] = [
  // name           scope     servers                          seenMinAgo  ip              userAgent                              prefix
  ['Claude Code',  'deploy', null,                             2,           '203.0.113.44', 'claude-code/1.2.3 (darwin-arm64)',   'snbd_mockCC111'],
  ['OpenCode',     'read',   null,                             8,           '203.0.113.45', 'opencode/0.9.1 darwin-arm64',        'snbd_mockOC222'],
  ['Cursor',       'read',   ['web-01', 'staging-01'],         62,          '198.51.100.7',  'Cursor/0.45.0 (Mac OS; arm64)',     'snbd_mockCU333'],
  ['Claude',       'read',   null,                             185,         '203.0.113.46', 'Claude/1.3.0 (Macintosh; arm64)',   'snbd_mockCL444'],
  ['Codex',        'deploy', ['db-01'],                        1500,        '192.0.2.20',    'codex/2.1.0 (linux-x86_64)',         'snbd_mockCX555'],
  ['Windsurf',     'read',   null,                             8700,        '192.0.2.21',    'Windsurf/1.4.2 (Windows; x64)',      'snbd_mockWS666'],
];
for (const [name, scope, srvNames, seenMinAgo, ip, ua, prefix] of tokens) {
  const serverIds = srvNames ? srvNames.map((n) => ids[n]) : null;
  await pool.query(
    `insert into api_tokens (client_id, name, token_hash, token_prefix, scope, server_ids, last_used_at, last_ip, last_user_agent, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now() + interval '90 days')`,
    [cid, name, sha256(randomBytes(32).toString('hex')), prefix, scope, serverIds, at(seenMinAgo), ip, ua],
  );
}

// ── OAuth connectors → "Approved app" chips ─────────────────────────────────
await pool.query(
  `insert into oauth_clients (client_id, client_name, redirect_uris) values
     ('claude-ai-app','Claude',array['https://claude.ai/api/mcp/auth_callback']),
     ('opencode-app','OpenCode',array['http://127.0.0.1:0/cb'])
   on conflict (client_id) do nothing`,
);
await pool.query('delete from oauth_grants where user_client_id=$1 and name = any($2)', [cid, ['Claude (connector)', 'OpenCode (connector)']]);
const grants: [string, string, string, string[] | null, number, string, string][] = [
  ['Claude (connector)', 'claude-ai-app', 'deploy', null, 3, '203.0.113.44', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Claude/1.3.0'],
  ['OpenCode (connector)', 'opencode-app', 'read', ['web-01'], 1560, '203.0.113.45', 'opencode/0.9.1 darwin-arm64'],
];
for (const [name, ocid, scope, srvNames, seenMinAgo, ip, ua] of grants) {
  await pool.query(
    `insert into oauth_grants (user_client_id, oauth_client_id, name, server_ids, scope, expires_at, last_used_at, last_ip, last_user_agent)
     values ($1,$2,$3,$4,$5,now() + interval '180 days',$6,$7,$8)`,
    [cid, ocid, name, srvNames ? srvNames.map((n) => ids[n]) : null, scope, at(seenMinAgo), ip, ua],
  );
}

// ── SSH keys ────────────────────────────────────────────────────────────────
await pool.query('delete from ssh_keys where client_id=$1 and name = any($2)', [cid, ['MacBook Pro', 'CI deploy key']]);
const keys: [string, string, string, string, boolean, string[]][] = [
  ['MacBook Pro', 'ssh-ed25519', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG1vY2tkZW1vZm9yc2NyZWVuc2hvdHMgbW9jaw demo@macbook', 'SHA256:mockmacbookprodemo0000000000000001', false, ['web-01', 'db-01', 'staging-01']],
  ['CI deploy key', 'ssh-rsa', 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCtbW9ja2RlbW9mb3JzY3JlZW5zaG90cw ci@runner', 'SHA256:mockcideploykeydemo00000000000000002', false, ['web-01']],
];
for (const [name, ktype, pub, fp, priv, srvNames] of keys) {
  const r = (await pool.query(
    'insert into ssh_keys (client_id, name, key_type, public_key, fingerprint, private_generated) values ($1,$2,$3,$4,$5,$6) returning id',
    [cid, name, ktype, pub, fp, priv],
  )).rows[0];
  for (const n of srvNames) {
    if (ids[n]) await pool.query('insert into ssh_key_servers (key_id, server_id) values ($1,$2) on conflict do nothing', [r.id, ids[n]]);
  }
}

// ── app install jobs (last-job panel + history on web-01) ───────────────────
await pool.query("delete from jobs where server_id = any($1)", [servers.map((s) => ids[s[0]])])
const jobLog = (app: string) =>
  [`[mock] installing ${app} on web-01`, '[mock] apt-get update && apt-get install -y', `[mock] ${app} installed successfully`, 'done'].join('\n');
for (const [kind, status, agoMin, log] of [
  ['install:node', 'done', 300, jobLog('node')],
  ['install:docker', 'done', 1400, jobLog('docker')],
  ['install:n8n', 'failed', 60, '[mock] installing n8n on web-01\n[mock] npm install -g n8n\n[mock] ERROR: out of memory during build\nfailed'],
] as const) {
  await pool.query(
    "insert into jobs (server_id, kind, status, log, created_at, finished_at) values ($1,$2,$3,$4,$5::timestamptz,case when $3 in ('done','failed') then $5::timestamptz + interval '4 minutes' end)",
    [ids['web-01'], kind, status, log, at(agoMin)],
  );
}

// ── activity (sessions + human actions across the fleet) ─────────────────────
await pool.query("delete from audit_log where client_id=$1 and meta->>'mock'='true'", [cid]);
const sessA = randomUUID(); // Claude Code on web-01
const sessB = randomUUID(); // OpenCode on db-01
const sessC = randomUUID(); // Cursor on staging-01
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
type Row = [string | null, string, object, string | null, string | null, string | null, string | null, string | null, Date];
const rows: Row[] = [
  [null, 'login', { mock: true, email }, null, '203.0.113.10', UA, 'Remote', null, at(300)],
  [null, 'token.create', { mock: true, name: 'Claude Code', scope: 'deploy' }, null, '203.0.113.10', UA, 'Remote', null, at(295)],
  [null, 'oauth.approve', { mock: true, app: 'Claude' }, null, '203.0.113.10', UA, 'Remote', null, at(294)],
  [null, 'ssh.key.install', { mock: true, keyName: 'MacBook Pro' }, null, '203.0.113.10', UA, 'Remote', null, at(280)],
  [ids['web-01'], 'server.import', { mock: true }, null, '203.0.113.10', UA, 'Remote', null, at(288)],
  [ids['web-01'], 'agent.connected', { mock: true, version: '0.5.1' }, null, '157.90.10.21', null, null, null, at(287)],
  [ids['web-01'], 'mcp.server_status', { mock: true }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(180)],
  [ids['web-01'], 'mcp.view_logs', { mock: true, source: 'unit:nginx', lines: 100 }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(178, 40)],
  [ids['web-01'], 'mcp.read_file', { mock: true, path: '/etc/nginx/nginx.conf' }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(177, 10)],
  [ids['web-01'], 'mcp.write_file', { mock: true, path: '/etc/nginx/conf.d/app.conf', bytes: 412 }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(175, 30)],
  [ids['web-01'], 'mcp.run_command', { mock: true, command: 'nginx -t && systemctl reload nginx', exitCode: 0 }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(174)],
  [ids['web-01'], 'mcp.restart_service', { mock: true, service: 'nginx.service', action: 'restart' }, 'Claude Code', '203.0.113.44', null, 'Remote', sessA, at(172, 20)],
  [ids['db-01'], 'agent.connected', { mock: true, version: '0.5.1' }, null, '157.90.10.22', null, null, null, at(200)],
  [ids['db-01'], 'mcp.run_command', { mock: true, command: 'pg_dump app | gzip > /backups/app.sql.gz', exitCode: 0 }, 'OpenCode', '203.0.113.45', null, 'Remote', sessB, at(40)],
  [ids['db-01'], 'mcp.server_status', { mock: true }, 'OpenCode', '203.0.113.45', null, 'Remote', sessB, at(38)],
  [ids['db-01'], 'file.write', { mock: true, path: '/etc/motd', bytes: 128 }, null, '203.0.113.10', UA, 'Remote', null, at(90)],
  [ids['staging-01'], 'agent.disconnected', { mock: true }, null, '157.90.10.23', null, null, null, at(2900)],
  [ids['staging-01'], 'mcp.list_files', { mock: true, path: '/var/www', count: 14 }, 'Cursor', '198.51.100.7', null, 'Remote', sessC, at(22)],
  [ids['staging-01'], 'mcp.run_command', { mock: true, command: 'tail -n 200 /var/log/app.log | grep -i error', exitCode: 1 }, 'Cursor', '198.51.100.7', null, 'Remote', sessC, at(20, 30)],
  [ids['staging-01'], 'mcp.run_command', { mock: true, command: 'df -h / && free -m', exitCode: 0 }, 'Cursor', '198.51.100.7', null, 'Remote', sessC, at(19)],
  [ids['staging-01'], 'mcp.run_command', { mock: true, command: 'journalctl -u app --no-pager -n 50', error: 'The panel agent on "staging-01" is offline right now' }, 'Cursor', '198.51.100.7', null, 'Remote', sessC, at(18)],
  [ids['backup-01'], 'power.stop', { mock: true }, null, '203.0.113.10', UA, 'Remote', null, at(700)],
  [ids['web-01'], 'power.reboot', { mock: true }, null, '203.0.113.10', UA, 'Remote', null, at(1500)],
  [ids['eu-vps-02'], 'server.created', { mock: true }, null, '203.0.113.10', UA, 'Remote', null, at(15)],
];
for (const [sid, action, meta, via, ip, ua, loc, sess, time] of rows) {
  await pool.query(
    'insert into audit_log (client_id, server_id, action, meta, via, ip_address, user_agent, location, session_id, at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [cid, sid, action, meta, via, ip, ua, loc, sess, time],
  );
}

console.log(`mock demo data planted for ${email}:`);
console.log(`  servers: web-01 + db-01 (running, metrics), staging-01 (offline), backup-01 (stopped), eu-vps-02 (provisioning), dev-box (live agent box)`);
console.log(`  tokens: ${tokenNames.join(', ')} (2 live, 4 idle — all with logos on the MCP page)`);
console.log(`  connectors: Claude (connector, full access), OpenCode (connector, web-01 only)`);
console.log(`  ssh keys: MacBook Pro (3 servers), CI deploy key (web-01)`);
console.log(`  jobs: node+docker done, n8n failed on web-01 · activity: ${rows.length} rows in 3 MCP sessions + human actions`);
console.log('Re-run anytime to reset. For a LIVE agent on dev-box (terminal/files/apps live):');
console.log('  pnpm seed   # prints a fresh enroll token, then:');
console.log('  cd agent && PANEL_URL=ws://localhost:3101/agent ENROLL_TOKEN=<token> go run .');
await pool.end();
