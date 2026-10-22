import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RpcError, rpc } from './agentRpc.js';
import { audit, pool } from './db.js';
import { agents } from './registry.js';
import { baseUrl } from './oauth.js';
import { authenticateToken, type TokenAuth } from './tokens.js';

// Model Context Protocol over "Streamable HTTP", stateless: every POST is a JSON-RPC message (or a batch) answered with plain JSON.
// Scope today: read-only tools. Each tool states the token scope it needs so write tools can be added without changing the checks.

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'snbd-console', title: 'SNBD Console', version: '0.1.0' };

const INSTRUCTIONS = `You are connected to the customer's SNBD hosting panel. Their servers (VPS) are real machines, so be careful and honest.
- If the customer has more than one server, call list_servers and ask which one they mean before doing anything on it.
- A server must show agentOnline=true before its logs or IP can be read. If it is offline, say so; do not guess.
- To tell the customer which DNS A record to add, call get_public_ip and use detectedPublicIp. If it differs from panelSawAgentIp, explain the difference and ask them to confirm.
- Logs can contain private data. Summarise problems; do not paste secrets into the chat.
- These tools only read. Never claim you changed something on a server.`;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: 'read' | 'deploy';
  inputSchema: object;
  args: z.ZodTypeAny;
  run: (auth: TokenAuth, args: any) => Promise<{ text: string; serverId?: string; audit?: object }>;
}

class ToolError extends Error {}

const serverRef = z.string().trim().min(1).max(100);

interface ServerRow { id: string; name: string; provider: string; status: string; region: string | null; os: string | null; plan: object; ip: string | null; last_seen_ip: string | null; suspended_at: string | null; reinstall_started_at: string | null }

const SERVER_COLS = `id, name, provider, status, region, os, plan, host(ip) as ip, host(last_seen_ip) as last_seen_ip, suspended_at, reinstall_started_at`;

async function resolveServer(auth: TokenAuth, ref: string): Promise<ServerRow> {
  const { rows } = await pool.query(
    `select ${SERVER_COLS} from servers
     where client_id = $1 and terminated_at is null and ($2::uuid[] is null or id = any($2::uuid[]))
       and (id::text = $3 or lower(name) = lower($3))`,
    [auth.clientId, auth.serverIds, ref],
  );
  if (rows.length === 0) throw new ToolError(`No server matches "${ref}". Call list_servers to see the available servers.`);
  if (rows.length > 1) throw new ToolError(`"${ref}" matches ${rows.length} servers (${rows.map((r) => r.id).join(', ')}). Use the id instead of the name.`);
  return rows[0];
}

function requireOnline(server: ServerRow) {
  if (server.suspended_at) throw new ToolError(`Server "${server.name}" is suspended, so it cannot be inspected.`);
  if (!agents.has(server.id)) throw new ToolError(`The panel agent on "${server.name}" is offline right now (status: ${server.status}). Ask the customer to check that the server is powered on, then try again.`);
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

async function execOnServer(serverId: string, script: string, timeoutMs = 20_000): Promise<{ code: number; out: string }> {
  try {
    return await rpc<{ code: number; out: string }>(serverId, 'exec', { script, timeoutMs }, timeoutMs + 10_000);
  } catch (e) {
    if (e instanceof RpcError) throw new ToolError(e.message);
    throw e;
  }
}

const LOG_SOURCE = /^(system|agent|unit:[A-Za-z0-9@._:-]{1,80}|docker:[A-Za-z0-9][A-Za-z0-9_.-]{0,62})$/;

function logScript(source: string, lines: number): string {
  // the source was validated against LOG_SOURCE, so the name cannot carry shell syntax; it is quoted anyway
  if (source === 'system') {
    return `if command -v journalctl >/dev/null 2>&1; then journalctl -n ${lines} --no-pager 2>&1; elif [ -r /var/log/syslog ]; then tail -n ${lines} /var/log/syslog; elif [ -r /var/log/messages ]; then tail -n ${lines} /var/log/messages; else echo "no readable system log found"; fi`;
  }
  if (source === 'agent' || source.startsWith('unit:')) {
    const unit = source === 'agent' ? 'snbd-agent' : source.slice(5);
    return `if command -v journalctl >/dev/null 2>&1; then journalctl -u '${unit}' -n ${lines} --no-pager 2>&1; else echo "journalctl is not available on this server"; fi`;
  }
  const name = source.slice(7);
  return `if command -v docker >/dev/null 2>&1; then docker logs --tail ${lines} --timestamps '${name}' 2>&1; else echo "Docker is not installed on this server"; fi`;
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_servers',
    title: 'List servers',
    description: "Lists the customer's servers (VPS) this token can see: id, name, status, provider, region, system, plan, the IP the panel has on record, and whether the panel agent is online. Call this first, and ask the customer which server they mean when there is more than one.",
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    async run(auth) {
      const { rows } = await pool.query(
        `select ${SERVER_COLS} from servers where client_id = $1 and terminated_at is null and ($2::uuid[] is null or id = any($2::uuid[])) order by name`,
        [auth.clientId, auth.serverIds],
      );
      const servers = (rows as ServerRow[]).map((s) => ({
        id: s.id, name: s.name, status: s.suspended_at ? 'suspended' : s.reinstall_started_at ? 'reinstalling' : s.status, provider: s.provider,
        region: s.region, os: s.os, plan: s.plan, ipOnRecord: s.ip, agentOnline: agents.has(s.id),
      }));
      return { text: json({ count: servers.length, servers }) };
    },
  },
  {
    name: 'server_status',
    title: 'Server status',
    description: 'Shows one server in detail: status, whether the agent is online, agent version, last heartbeat, and the latest CPU, memory, disk and uptime readings.',
    scope: 'read',
    inputSchema: { type: 'object', properties: { server: { type: 'string', description: 'Server id or name' } }, required: ['server'], additionalProperties: false },
    args: z.object({ server: serverRef }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      const hb = (await pool.query(
        `select at, cpu, mem_used::float as "memUsed", mem_total::float as "memTotal", disk_used::float as "diskUsed", disk_total::float as "diskTotal", uptime::float as uptime
         from heartbeats where server_id = $1 order by at desc limit 1`, [s.id])).rows[0];
      const key = (await pool.query('select agent_version, last_seen_at from agent_keys where server_id = $1', [s.id])).rows[0];
      const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10;
      return {
        serverId: s.id,
        text: json({
          id: s.id, name: s.name, status: s.suspended_at ? 'suspended' : s.reinstall_started_at ? 'reinstalling' : s.status, provider: s.provider, region: s.region, os: s.os, plan: s.plan,
          ipOnRecord: s.ip, agentOnline: agents.has(s.id), agentVersion: key?.agent_version ?? null, lastHeartbeat: key?.last_seen_at ?? null,
          latestReading: hb ? { at: hb.at, cpuPercent: Math.round(hb.cpu), memoryUsedGb: gb(hb.memUsed), memoryTotalGb: gb(hb.memTotal), diskUsedGb: gb(hb.diskUsed), diskTotalGb: gb(hb.diskTotal), uptimeHours: Math.round(hb.uptime / 360) / 10 } : null,
        }),
      };
    },
  },
  {
    name: 'get_public_ip',
    title: 'Get public IP',
    description: "Finds the server's public IPv4 address, which is what the customer must put in a DNS A record. It asks the server itself (detectedPublicIp), and also reports the address the panel sees the agent connect from and the IP on record. Needs the agent online.",
    scope: 'read',
    inputSchema: { type: 'object', properties: { server: { type: 'string', description: 'Server id or name' } }, required: ['server'], additionalProperties: false },
    args: z.object({ server: serverRef }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const r = await execOnServer(s.id, `PUB=$(curl -fsS -m 6 https://api.ipify.org 2>/dev/null || curl -fsS -m 6 https://ifconfig.me 2>/dev/null || true); echo "public=$PUB"; if command -v ip >/dev/null 2>&1; then ip -o -4 addr show scope global 2>/dev/null | awk '{print "iface=" $2 " " $4}'; fi`);
      const ipv4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
      const lines = r.out.split('\n').map((l) => l.trim());
      const pub = lines.find((l) => l.startsWith('public='))?.slice(7) ?? '';
      const detected = ipv4.test(pub) ? pub : null;
      const interfaces = lines.filter((l) => l.startsWith('iface=')).map((l) => l.slice(6));
      const sawRaw = s.last_seen_ip?.replace(/^::ffff:/, '') ?? null;
      const saw = sawRaw && ipv4.test(sawRaw) ? sawRaw : null;
      const best = detected ?? saw;
      const notes: string[] = [];
      if (!detected) notes.push('The server could not reach an IP lookup service, so detectedPublicIp is unknown.');
      if (detected && saw && detected !== saw) notes.push('The server reports a different public IP than the one the panel sees. This happens behind NAT or a proxy. Ask the customer to confirm which address visitors reach the server on before they add a DNS record.');
      if (best && s.ip && best !== s.ip) notes.push('The IP on record in the panel is different from the detected one; the detected address is more likely to be current.');
      if (!best) notes.push('No public address could be determined. The server may only have a private address.');
      return {
        serverId: s.id,
        text: json({ server: s.name, detectedPublicIp: detected, panelSawAgentIp: saw, ipOnRecord: s.ip, serverInterfaces: interfaces, addressForDnsARecord: best, notes }),
      };
    },
  },
  {
    name: 'view_logs',
    title: 'View logs',
    description: "Reads the most recent log lines from a server. source: 'system' (system journal), 'agent' (the panel agent), 'unit:<name>' (a systemd service) or 'docker:<container>' (a container's output). Read-only. Needs the agent online. Logs can hold private data, so summarise rather than paste secrets.",
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        source: { type: 'string', description: "'system', 'agent', 'unit:<name>' or 'docker:<container>'", default: 'system' },
        lines: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
      required: ['server'],
      additionalProperties: false,
    },
    args: z.object({ server: serverRef, source: z.string().trim().regex(LOG_SOURCE, "source must be 'system', 'agent', 'unit:<name>' or 'docker:<container>'").default('system'), lines: z.number().int().min(1).max(500).default(100) }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const r = await execOnServer(s.id, logScript(a.source, a.lines), 25_000);
      const body = r.out.trim();
      if (r.code !== 0 && !body) throw new ToolError(`Reading ${a.source} failed (exit ${r.code}).`);
      return {
        serverId: s.id,
        audit: { source: a.source, lines: a.lines },
        text: `Last ${a.lines} lines of ${a.source} on "${s.name}"${r.code !== 0 ? ` (command exited ${r.code})` : ''}:\n\n${body || '(no output)'}`,
      };
    },
  },
];

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

async function handleMessage(msg: any, auth: TokenAuth): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
  switch (msg.method) {
    case 'initialize': {
      const wanted = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(wanted) ? wanted : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.filter((t) => t.scope === 'read' || auth.scope === 'deploy').map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.name === 'get_public_ip' },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name).slice(0, 60)}`);
      if (tool.scope === 'deploy' && auth.scope !== 'deploy') {
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'This token is read-only. The customer can create a token with more access in the panel.' }] });
      }
      const parsed = tool.args.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) {
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'Invalid arguments: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ') }] });
      }
      try {
        const out = await tool.run(auth, parsed.data);
        if (out.serverId) await audit(auth.clientId, out.serverId, `mcp.${tool.name}`, out.audit ?? {}, auth.name).catch(() => {});
        return rpcResult(msg.id, { content: [{ type: 'text', text: out.text }] });
      } catch (e) {
        if (e instanceof ToolError) return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: e.message }] });
        console.error('mcp tool failed', tool.name, e);
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'The panel hit an unexpected error. Try again in a moment.' }] });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method.slice(0, 60)}`);
  }
}

export function registerMcp(app: FastifyInstance) {
  app.post('/mcp', async (req, reply) => {
    const auth = await authenticateToken(req.headers.authorization, req.ip);
    if (!auth) {
      return reply.code(401).header('www-authenticate', `Bearer realm="snbd-console", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`).send({ error: 'Missing, invalid, revoked or expired token' });
    }
    const body = req.body as unknown;
    if (body === undefined || body === null || typeof body !== 'object') return reply.code(400).send(rpcError(null, -32700, 'Parse error'));
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > 20) return reply.code(400).send(rpcError(null, -32600, 'Batch must contain 1 to 20 messages'));
      const out = (await Promise.all(body.map((m) => handleMessage(m, auth)))).filter((r): r is object => r !== null);
      if (out.length === 0) return reply.code(202).send();
      return out;
    }
    const res = await handleMessage(body, auth);
    if (res === null) return reply.code(202).send();
    return res;
  });

  // no server-initiated stream and no sessions: say so instead of hanging
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'Use POST' }) });
  }
}
