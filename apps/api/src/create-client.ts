// Production helper: creates the first (or another) client login without the demo server that `pnpm seed` adds.
//   CLIENT_EMAIL=you@example.com CLIENT_PASSWORD=... [CLIENT_NAME="Your Name"] [RESET=1] pnpm create-client
// An existing email is left alone unless RESET=1, which sets the new password and signs that client out everywhere.
import { hashPassword, pool } from './db.js';

const email = process.env.CLIENT_EMAIL?.trim().toLowerCase();
const password = process.env.CLIENT_PASSWORD;
const name = process.env.CLIENT_NAME?.trim() || 'Admin';
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('CLIENT_EMAIL is required'); process.exit(2); }
if (!password || password.length < 12) { console.error('CLIENT_PASSWORD is required and must be at least 12 characters'); process.exit(2); }

const found = await pool.query('select id from clients where email = $1', [email]);
if (found.rows[0] && process.env.RESET !== '1') {
  console.log(`client ${email} already exists (set RESET=1 to change the password)`);
} else if (found.rows[0]) {
  await pool.query('update clients set password_hash = $2, name = $3 where id = $1', [found.rows[0].id, await hashPassword(password), name]);
  await pool.query('delete from sessions where client_id = $1', [found.rows[0].id]);
  console.log(`password reset for ${email}`);
} else {
  await pool.query('insert into clients (email, name, password_hash) values ($1, $2, $3)', [email, name, await hashPassword(password)]);
  console.log(`client ${email} created`);
}
await pool.end();
