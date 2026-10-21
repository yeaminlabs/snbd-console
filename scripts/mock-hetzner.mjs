// Minimal fake of the Hetzner Cloud API for local testing: node scripts/mock-hetzner.mjs [port]
// Records every call; GET /_log returns them. POST /_fail/<METHOD>/<path-suffix> makes the next matching call return 422.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4010);
const servers = new Map();
const log = [];
const failNext = new Set();
let nextId = 1000, nextAction = 1;

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const action = (command) => ({ id: nextAction++, command, status: 'success', progress: 100, started: new Date().toISOString(), finished: new Date().toISOString(), resources: [], error: null });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : undefined;

  if (url.pathname === '/_log') return send(res, 200, log);
  if (url.pathname.startsWith('/_fail/')) { failNext.add(url.pathname.slice(7)); return send(res, 200, { ok: true }); }
  if (url.pathname === '/_reset') { servers.clear(); log.length = 0; failNext.clear(); return send(res, 200, { ok: true }); }

  const path = url.pathname.replace(/^\/v1/, '');
  log.push({ method: req.method, path, query: url.search, body, auth: req.headers.authorization });
  if (req.headers.authorization !== 'Bearer test-token') return send(res, 401, { error: { code: 'unauthorized', message: 'unable to authenticate' } });
  const key = `${req.method}${path.replace(/\/\d+/, '/:id')}`;
  for (const f of failNext) if (key.endsWith(f) || key === f) { failNext.delete(f); return send(res, 422, { error: { code: 'invalid_input', message: 'mock failure', details: null } }); }

  let m;
  if (req.method === 'GET' && path === '/servers') {
    const sel = url.searchParams.get('label_selector') ?? '';
    const [k, v] = sel.split('=');
    return send(res, 200, { servers: [...servers.values()].filter((s) => !sel || s.labels[k] === v) });
  }
  if (req.method === 'POST' && path === '/servers') {
    if (!body?.name || !body.server_type || !body.image) return send(res, 422, { error: { code: 'invalid_input', message: 'missing field', details: null } });
    const id = nextId++;
    const s = { id, name: body.name, status: 'initializing', labels: body.labels ?? {}, image: body.image, server_type: body.server_type, public_net: { ipv4: { ip: `192.0.2.${id % 250}`, blocked: false, dns_ptr: '' } } };
    servers.set(id, s);
    return send(res, 201, { server: s, action: action('create_server'), next_actions: [], root_password: 'mock-root-pw-create' });
  }
  if ((m = path.match(/^\/servers\/(\d+)$/)) && req.method === 'DELETE') {
    if (!servers.delete(Number(m[1]))) return send(res, 404, { error: { code: 'not_found', message: 'server not found', details: null } });
    return send(res, 200, { action: action('delete_server') });
  }
  if ((m = path.match(/^\/servers\/(\d+)\/actions\/(\w+)$/)) && req.method === 'POST') {
    const s = servers.get(Number(m[1]));
    if (!s) return send(res, 404, { error: { code: 'not_found', message: 'server not found', details: null } });
    if (m[2] === 'rebuild') { s.image = body.image; return send(res, 201, { action: action('rebuild_server'), root_password: 'mock-root-pw-rebuild' }); }
    if (m[2] === 'change_type') { s.server_type = body.server_type; }
    return send(res, 201, { action: action(m[2]) });
  }
  if ((m = path.match(/^\/actions\/(\d+)$/))) return send(res, 200, { action: { ...action('x'), id: Number(m[1]) } });
  send(res, 404, { error: { code: 'not_found', message: 'no such route', details: null } });
}).listen(port, () => console.log(`mock hetzner on :${port} (token: test-token)`));
