import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

// Dev-only: plants realistic Activity rows (agent sessions + human actions) for the
// seeded demo client so the Activity page can be viewed locally.
// Run:  pnpm migrate && pnpm seed && pnpm --filter @snbd/api mock-activity
// Then sign in with the demo login and open Activity.

const email = process.env.SEED_EMAIL ?? 'demo@snbd.test';

const client = (await pool.query('select id from clients where email = $1', [email])).rows[0];
if (!client) {
  console.error(`No client ${email} — run "pnpm seed" first.`);
  await pool.end();
  process.exit(1);
}
const server = (
  await pool.query("select id, name from servers where client_id = $1 and terminated_at is null order by name = 'dev-box' desc, created_at limit 1", [client.id])
).rows[0];
if (!server) {
  console.error('No server for the demo client — run "pnpm seed" first.');
  await pool.end();
  process.exit(1);
}

// Idempotent: wipe previous mock rows (tagged meta.mock) before re-inserting.
await pool.query("delete from audit_log where client_id = $1 and meta->>'mock' = 'true'", [client.id]);

const sessionA = randomUUID(); // Claude laptop
const sessionB = randomUUID(); // Cursor
const now = Date.now();
const min = 60_000;
const at = (minutesAgo: number, seconds = 0) => new Date(now - minutesAgo * min - seconds * 1000);

type Row = [string | null, string, object, string | null, string | null, string | null, string | null, Date];
//            serverId        action  meta    via         ip            userAgent    location      at
const rows: Row[] = [
  // ── human: signed in this morning ──
  [null, 'login', { mock: true, email }, null, '203.0.113.10', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Remote', at(300)],
  [null, 'token.create', { mock: true, name: 'Claude laptop', scope: 'read' }, null, '203.0.113.10', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Remote', at(290)],
  // ── session A: Claude laptop fixed nginx ~3h ago ──
  [server.id, 'mcp.server_status', { mock: true }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(180)],
  [server.id, 'mcp.view_logs', { mock: true, source: 'unit:nginx', lines: 100 }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(178, 40)],
  [server.id, 'mcp.read_file', { mock: true, path: '/etc/nginx/nginx.conf' }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(177, 10)],
  [server.id, 'mcp.write_file', { mock: true, path: '/etc/nginx/conf.d/app.conf', bytes: 412 }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(175, 30)],
  [server.id, 'mcp.run_command', { mock: true, command: 'nginx -t && systemctl reload nginx', exitCode: 0 }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(174)],
  [server.id, 'mcp.restart_service', { mock: true, service: 'nginx.service', action: 'restart' }, 'Claude laptop', '203.0.113.44', null, 'Remote', at(172, 20)],
  // ── human: edited motd in between ──
  [server.id, 'file.write', { mock: true, path: '/etc/motd', bytes: 128 }, null, '203.0.113.10', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Remote', at(90)],
  // ── session B: Cursor poked at logs ~20 min ago, one command failed ──
  [server.id, 'mcp.list_files', { mock: true, path: '/var/www', count: 14 }, 'Cursor', '198.51.100.7', null, 'Remote', at(22)],
  [server.id, 'mcp.run_command', { mock: true, command: 'tail -n 200 /var/log/app.log | grep -i error', exitCode: 1 }, 'Cursor', '198.51.100.7', null, 'Remote', at(20, 30)],
  [server.id, 'mcp.run_command', { mock: true, command: 'df -h / && free -m', exitCode: 0 }, 'Cursor', '198.51.100.7', null, 'Remote', at(19)],
  [server.id, 'mcp.run_command', { mock: true, command: 'journalctl -u app --no-pager -n 50', error: 'The panel agent on "dev-box" is offline right now' }, 'Cursor', '198.51.100.7', null, 'Remote', at(18)],
  // ── human: reboot yesterday ──
  [server.id, 'power.reboot', { mock: true }, null, '203.0.113.10', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Remote', at(1500)],
];

const sessionFor = (via: string | null, action: string): string | null => {
  if (!via) return null;
  if (via === 'Claude laptop') return sessionA;
  if (via === 'Cursor') return sessionB;
  return null;
};

for (const [sid, action, meta, via, ip, ua, loc, time] of rows) {
  await pool.query(
    'insert into audit_log (client_id, server_id, action, meta, via, ip_address, user_agent, location, session_id, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [client.id, sid, action, meta, via, ip, ua, loc, sessionFor(via, action), time],
  );
}

console.log(`mocked ${rows.length} activity rows for ${email} on server "${server.name}" (${server.id})`);
console.log(`  session A (${sessionA}): Claude laptop, 6 actions`);
console.log(`  session B (${sessionB}): Cursor, 4 actions (incl. 1 failed command)`);
console.log('open Activity in the panel to see the grouped sessions. Re-run to reset.');
await pool.end();
