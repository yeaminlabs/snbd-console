import { hashPassword, pool, randomToken, sha256 } from './db.js';

// Dev seed: one client, one "imported" server, and a fresh enroll token printed for the agent.
const email = process.env.SEED_EMAIL ?? 'demo@snbd.test';
const password = process.env.SEED_PASSWORD ?? 'demo-password';

const client = await pool.query(
  `insert into clients (email, name, password_hash) values ($1, 'Demo Client', $2)
   on conflict (email) do update set email = excluded.email returning id`,
  [email, await hashPassword(password)],
);
const clientId = client.rows[0].id;

let server = (await pool.query("select id from servers where client_id = $1 and name = 'dev-box'", [clientId])).rows[0];
if (!server) {
  server = (
    await pool.query(
      `insert into servers (client_id, name, provider, status, plan, os) values ($1, 'dev-box', 'imported', 'provisioning', '{"vcpu":2,"ramGb":4,"diskGb":40}', 'local') returning id`,
      [clientId],
    )
  ).rows[0];
}

const token = randomToken(24);
await pool.query("insert into enroll_tokens (server_id, token_hash, expires_at) values ($1, $2, now() + interval '30 minutes')", [server.id, sha256(token)]);

console.log(`login:    ${email} / ${password}`);
console.log(`server:   ${server.id}`);
console.log(`token:    ${token}  (expires in 30 minutes, single use)`);
console.log(`run agent: cd agent && PANEL_URL=${(process.env.PUBLIC_PANEL_URL ?? 'http://localhost:3101').replace('http', 'ws')}/agent ENROLL_TOKEN=${token} go run .`);
await pool.end();
