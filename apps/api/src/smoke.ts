// End-to-end smoke test: logs in, opens the terminal for a server, runs a command, checks output.
import WebSocket from 'ws';

const base = process.env.BASE ?? 'http://localhost:3101';
const serverId = process.argv[2];
if (!serverId) throw new Error('usage: smoke <serverId>');

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.SEED_EMAIL ?? 'demo@snbd.test', password: process.env.SEED_PASSWORD ?? 'demo-password' }),
});
if (!login.ok) throw new Error('login failed ' + login.status);
const cookie = login.headers.get('set-cookie')!.split(';')[0];

const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/terminal/${serverId}`, { headers: { cookie } });
let out = '';
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'in', data: 'echo SNBD_$((20+22))_OK; stty size; exit\n' })), 800);
});
ws.on('message', (d) => (out += d.toString()));
ws.on('close', (code) => {
  console.log('closed', code);
  console.log(out.includes('SNBD_42_OK') ? 'PASS: command output received' : 'FAIL');
  console.log(out.includes('30 100') ? 'PASS: pty size 30x100' : 'FAIL: size');
  process.exit(out.includes('SNBD_42_OK') ? 0 : 1);
});
setTimeout(() => { console.log('timeout', JSON.stringify(out)); process.exit(1); }, 15000);
