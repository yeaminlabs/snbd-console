import { audit, pool, randomToken, sha256 } from './db.js';
import type { AgentConn } from './registry.js';

/**
 * Issues a replacement agent key. The panel keeps accepting the old key until the agent presents the new
 * one, so a lost message cannot lock a server out. The agent stores the new key as soon as it arrives.
 */
export async function rotateKey(conn: AgentConn) {
  const key = randomToken();
  await pool.query('update agent_keys set next_key_hash = $2 where server_id = $1', [conn.serverId, sha256(key)]);
  conn.socket.send(JSON.stringify({ type: 'rotate', key }));
  await audit(null, conn.serverId, 'agent.key_rotation_sent');
}
