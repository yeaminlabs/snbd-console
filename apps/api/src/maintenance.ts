import { pool } from './db.js';

const days = (name: string, def: number) => Number(process.env[name] ?? def);

/** Deletes data that is expired or past its retention. Returns how many rows each step removed. */
export async function runMaintenance(): Promise<Record<string, number>> {
  const steps: Record<string, [string, unknown[]]> = {
    enrollTokens: ["delete from enroll_tokens where expires_at < now() - interval '1 day' or used_at < now() - interval '7 days'", []],
    ssoTokens: ["delete from sso_tokens where expires_at < now() - interval '1 hour'", []],
    sessions: ['delete from sessions where expires_at < now()', []],
    // a create response holds the generated panel password so a timed-out WHMCS call can retry;
    // keep it only long enough for that retry, then drop it from the replay cache
    webhookPasswords: [
      `update webhook_events
          set response = jsonb_set(response, '{client}', (response->'client') - 'password')
        where created_at < now() - interval '1 hour'
          and jsonb_typeof(response->'client') = 'object'
          and (response->'client') ? 'password'`,
      [],
    ],
    webhookEvents: ["delete from webhook_events where created_at < now() - make_interval(days => $1)", [days('WEBHOOK_EVENT_RETENTION_DAYS', 30)]],
    heartbeats: ['delete from heartbeats where at < now() - make_interval(days => $1)', [days('HEARTBEAT_RETENTION_DAYS', 30)]],
    jobs: ["delete from jobs where status in ('done', 'failed') and created_at < now() - make_interval(days => $1)", [days('JOB_RETENTION_DAYS', 90)]],
    oauthRequests: ['delete from oauth_requests where expires_at < now()', []],
    oauthCodes: ["delete from oauth_codes where expires_at < now() - interval '1 day'", []],
    oauthTokens: ["delete from oauth_tokens where expires_at < now() - interval '1 day'", []],
    oauthGrants: ["delete from oauth_grants where (revoked_at is not null and revoked_at < now() - interval '30 days') or expires_at < now() - interval '30 days'", []],
    oauthClients: ["delete from oauth_clients c where c.created_at < now() - interval '2 days' and not exists (select 1 from oauth_grants g where g.oauth_client_id = c.client_id)", []],
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
