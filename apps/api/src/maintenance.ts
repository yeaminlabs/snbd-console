import { pool } from './db.js';

const days = (name: string, def: number) => Number(process.env[name] ?? def);

/** Deletes data that is expired or past its retention. Returns how many rows each step removed. */
export async function runMaintenance(): Promise<Record<string, number>> {
  const steps: Record<string, [string, unknown[]]> = {
    enrollTokens: ["delete from enroll_tokens where expires_at < now() - interval '1 day' or used_at < now() - interval '7 days'", []],
    ssoTokens: ["delete from sso_tokens where expires_at < now() - interval '1 hour'", []],
    sessions: ['delete from sessions where expires_at < now()', []],
    webhookEvents: ["delete from webhook_events where created_at < now() - make_interval(days => $1)", [days('WEBHOOK_EVENT_RETENTION_DAYS', 30)]],
    heartbeats: ['delete from heartbeats where at < now() - make_interval(days => $1)', [days('HEARTBEAT_RETENTION_DAYS', 30)]],
    jobs: ["delete from jobs where status in ('done', 'failed') and created_at < now() - make_interval(days => $1)", [days('JOB_RETENTION_DAYS', 90)]],
    auditLog: ['delete from audit_log where at < now() - make_interval(days => $1)', [days('AUDIT_RETENTION_DAYS', 365)]],
  };
  const out: Record<string, number> = {};
  for (const [name, [sql, params]] of Object.entries(steps)) {
    out[name] = (await pool.query(sql, params as any[])).rowCount ?? 0;
  }
  return out;
}

export function startMaintenance(log: { info: (o: object, m: string) => void; error: (e: unknown, m: string) => void }) {
  const run = () => runMaintenance().then((r) => log.info(r, 'maintenance done'), (e) => log.error(e, 'maintenance failed'));
  setTimeout(run, 30_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
