import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { agents, type AgentConn } from './registry.js';

const JOB_LOG_MAX = 10_000_000;
const TRUNCATION_NOTE = '\n[log truncated — output exceeds 10 MB]\n';

export class RpcError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Calls an operation on the agent inside a VPS and waits for its answer. */
export function rpc<T = any>(serverId: string, op: string, args: object = {}, timeoutMs = 30_000): Promise<T> {
  const conn = agents.get(serverId);
  if (!conn) return Promise.reject(new RpcError(503, 'The server agent is offline'));
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new RpcError(504, 'The server did not answer in time'));
    }, timeoutMs);
    conn.pending.set(id, { resolve, reject, timer });
    conn.socket.send(JSON.stringify({ type: 'rpc', id, op, args }), (err) => {
      if (err) {
        clearTimeout(timer);
        conn.pending.delete(id);
        reject(new RpcError(503, 'The server agent is offline'));
      }
    });
  });
}

export function onRpcResult(conn: AgentConn, msg: { id: string; ok: boolean; data?: unknown; error?: string }) {
  const p = conn.pending.get(msg.id);
  if (!p) return;
  conn.pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.data);
  else p.reject(new RpcError(400, msg.error || 'Operation failed'));
}

export function failPending(conn: AgentConn) {
  for (const p of conn.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new RpcError(503, 'The server agent disconnected'));
  }
  conn.pending.clear();
}

export async function onJobLog(conn: AgentConn, jobId: string, data: string) {
  // once the cap is hit, append a truncation note once and stop accepting further output
  await pool.query(
    `update jobs set status = 'running', log =
       case
         when length(log) >= $3 then log
         when length(log) + length($2) <= $3 then log || $2
         else left(log || $2, $3) || $4
       end
     where id = $1 and server_id = $5 and status in ('queued', 'running')`,
    [jobId, data, JOB_LOG_MAX, TRUNCATION_NOTE, conn.serverId],
  );
}

export async function onJobDone(conn: AgentConn, jobId: string, code: number) {
  await pool.query(`update jobs set status = $2, finished_at = now() where id = $1 and server_id = $3 and status in ('queued', 'running')`, [jobId, code === 0 ? 'done' : 'failed', conn.serverId]);
  // dispatch the next queued job for this server using the stored script
  const { rows } = await pool.query(
    `select id, script from jobs where server_id = $1 and status = 'queued' order by queued_position asc limit 1`,
    [conn.serverId],
  );
  if (rows[0]) {
    const next = rows[0] as { id: string; script: string };
    if (next.script) conn.socket.send(JSON.stringify({ type: 'job.start', jobId: next.id, script: next.script }));
  }
}

/** An agent that drops kills its running jobs, so they cannot be left "running" forever. */
export async function failRunningJobs(serverId: string) {
  await pool.query(
    `update jobs set status = 'failed', finished_at = now(), log = log || E'\\n[connection to the server was lost]\\n' where server_id = $1 and status in ('queued', 'running')`,
    [serverId],
  );
}

export function sendToAgent(serverId: string, msg: object): boolean {
  const conn = agents.get(serverId);
  if (!conn) return false;
  conn.socket.send(JSON.stringify(msg));
  return true;
}
