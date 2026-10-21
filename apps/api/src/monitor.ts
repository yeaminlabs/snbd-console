import { agents } from './registry.js';
import { audit, pool } from './db.js';
import { rotateKey } from './keys.js';

const GRACE_S = Number(process.env.ALERT_GRACE_SECONDS ?? 120);
const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS ?? 30_000);
const ROTATE_AFTER_DAYS = Number(process.env.KEY_ROTATE_AFTER_DAYS ?? 30);

async function notify(event: string, text: string, server: { id: string; name: string }): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    // "text" is read by Slack and Mattermost, "content" by Discord; generic receivers get the structured fields
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, event, serverId: server.id, serverName: server.name }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function monitorTick(log: { error: (e: unknown, m: string) => void; warn: (m: string) => void }) {
  // 1. servers whose agent has been gone longer than the grace period
  const down = await pool.query(
    `select id, name, client_id, extract(epoch from now() - offline_since)::int as secs from servers
     where status = 'agent_offline' and offline_since < now() - make_interval(secs => $1)
       and offline_alerted_at is null and suspended_at is null and terminated_at is null`,
    [GRACE_S],
  );
  for (const s of down.rows) {
    if (!process.env.ALERT_WEBHOOK_URL) break;
    const ok = await notify('agent.offline', `⚠️ Server "${s.name}" has been unreachable for ${Math.round(s.secs / 60)} min (agent offline).`, s);
    if (ok) {
      await pool.query('update servers set offline_alerted_at = now() where id = $1', [s.id]);
      await audit(s.client_id, s.id, 'alert.offline', { minutes: Math.round(s.secs / 60) });
    } else log.warn(`alert delivery failed for ${s.name}; will retry`);
  }

  // 2. recovery notices for servers that were alerted
  const up = await pool.query(`select id, name, client_id from servers where offline_alerted_at is not null and status = 'running'`);
  for (const s of up.rows) {
    const ok = await notify('agent.online', `✅ Server "${s.name}" is back online.`, s);
    if (ok || !process.env.ALERT_WEBHOOK_URL) {
      await pool.query('update servers set offline_alerted_at = null, offline_since = null where id = $1', [s.id]);
      if (ok) await audit(s.client_id, s.id, 'alert.recovered');
    }
  }

  // 3. connected agents whose key is old get a fresh one
  const stale = await pool.query(`select server_id from agent_keys where key_set_at < now() - make_interval(days => $1)`, [ROTATE_AFTER_DAYS]);
  for (const r of stale.rows) {
    const conn = agents.get(r.server_id);
    if (conn) await rotateKey(conn).catch((e) => log.error(e, 'key rotation failed'));
  }
}

export function startMonitor(log: { error: (e: unknown, m: string) => void; warn: (m: string) => void }) {
  setInterval(() => monitorTick(log).catch((e) => log.error(e, 'monitor tick failed')), INTERVAL_MS).unref();
}
