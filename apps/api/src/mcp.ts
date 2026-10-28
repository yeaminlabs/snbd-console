import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RpcError, rpc } from './agentRpc.js';
import { audit, pool, requestContext, type AuditContext } from './db.js';
import { agents } from './registry.js';
import { baseUrl } from './oauth.js';
import { authenticateToken, type TokenAuth } from './tokens.js';

// Model Context Protocol over "Streamable HTTP", stateless: every POST is a JSON-RPC message (or a batch) answered with plain JSON.
// Scope is enforced: 'read' sees the 6 read tools, 'deploy' also gets run_command/write_file/restart_service.

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'snbd-console', title: 'SNBD Console', version: '0.1.0' };

const INSTRUCTIONS_DEPLOY = `You are connected to the customer's SNBD hosting panel. Their servers (VPS) are real machines, so be careful and honest.
- If the customer has more than one server, call list_servers and ask which one they mean before doing anything on it.
- A server must show agentOnline=true before you act on it. If it is offline, say so; do not proceed.
- To tell the customer which DNS A record to add, call get_public_ip and use detectedPublicIp. If it differs from panelSawAgentIp, explain the difference and ask them to confirm.
- Logs can contain private data. Summarise problems; do not paste secrets into the chat.
- This connection has full access. You may run commands, write files, and restart services.
- Always confirm with the customer before running destructive commands (rm, format, wipe, kill) or overwriting critical system files.
- Prefer targeted operations (restart_service, write_file) over raw run_command when a specialised tool exists.
- After a write operation, verify success by reading state back or checking a service status.`;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: 'read' | 'deploy';
  /** MCP protocol annotations */
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  inputSchema: object;
  args: z.ZodTypeAny;
  run: (auth: TokenAuth, args: any) => Promise<{ text: string; serverId?: string; audit?: object }>;
}

class ToolError extends Error {}

const serverRef = z.string().trim().min(1).max(100);

interface ServerRow { id: string; name: string; provider: string; status: string; region: string | null; os: string | null; plan: object; ip: string | null; last_seen_ip: string | null; suspended_at: string | null; reinstall_started_at: string | null }

const SERVER_COLS = `id, name, provider, status, region, os, plan, host(ip) as ip, host(last_seen_ip) as last_seen_ip, suspended_at, reinstall_started_at`;

/** Best-effort server id for failure audits: never throws, so a failed attempt is still logged. */
async function bestEffortServerId(auth: TokenAuth, ref: unknown): Promise<string | null> {
  if (typeof ref !== 'string' || !ref) return null;
  try {
    return (await resolveServer(auth, ref)).id;
  } catch {
    return null;
  }
}

/** Meta that is safe to store for a failed tool call. Never includes file content or other secrets. */
function safeFailureMeta(name: string, args: any): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const str = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
  const out: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };
  switch (name) {
    case 'run_command': set('command', str(args.command, 2000)); break;
    case 'write_file':
      set('path', str(args.path, 4096));
      if (typeof args.content === 'string') out.bytes = Buffer.byteLength(args.content);
      break;
    case 'restart_service': set('service', str(args.service, 100)); set('action', str(args.action, 20)); break;
    case 'view_logs': set('source', str(args.source, 100)); break;
    case 'list_files': case 'read_file': set('path', str(args.path, 4096)); break;
    default: break;
  }
  return out;
}

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

async function fsRpc<T = any>(serverId: string, op: string, args: object, timeoutMs = 15_000): Promise<T> {
  try {
    return await rpc<T>(serverId, op, args, timeoutMs);
  } catch (e) {
    if (e instanceof RpcError) throw new ToolError(e.message);
    throw e;
  }
}

const SAFE_SERVICE = /^[a-z][a-z0-9@._-]{0,79}(\.service)?$/i;
const FILE_CONTENT_MAX = 512 * 1024; // 512 KB via MCP write_file

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
  // ── Read helpers ─────────────────────────────────────────────────────────
  {
    name: 'list_files',
    title: 'List files',
    description: 'Lists files and directories at a path on the server. Returns name, type (file/dir/symlink), size, and modification time for each entry.',
    scope: 'read',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        path: { type: 'string', description: 'Absolute path to list', default: '/' },
      },
      required: ['server'],
      additionalProperties: false,
    },
    args: z.object({ server: serverRef, path: z.string().trim().min(1).max(4096).default('/') }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const entries = await fsRpc<Array<{ name: string; type: string; size: number; modTime: string }>>(s.id, 'fs.list', { path: a.path });
      return { serverId: s.id, audit: { path: a.path, count: entries.length }, text: json({ path: a.path, count: entries.length, entries }) };
    },
  },
  {
    name: 'read_file',
    title: 'Read file',
    description: 'Reads up to 128 KB from a file on the server. Useful for reading config files, logs, scripts, etc. For larger files use view_logs or run_command with tail/grep.',
    scope: 'read',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Byte offset to start reading from' },
      },
      required: ['server', 'path'],
      additionalProperties: false,
    },
    args: z.object({ server: serverRef, path: z.string().trim().min(1).max(4096), offset: z.number().int().min(0).default(0) }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const MAX_READ = 128 * 1024;
      const result = await fsRpc<{ data: string; eof: boolean }>(s.id, 'fs.read', { path: a.path, offset: a.offset, length: MAX_READ });
      const truncated = !result.eof;
      const body = Buffer.from(result.data, 'base64').toString('utf8');
      return {
        serverId: s.id,
        audit: { path: a.path },
        text: `Contents of "${a.path}" on "${s.name}"${a.offset > 0 ? ` (offset ${a.offset})` : ''}${truncated ? ' [truncated at 128 KB]' : ''}:\n\n${body}`,
      };
    },
  },
  // ── Write tools (full access) ─────────────────────────────────────────────
  {
    name: 'run_command',
    title: 'Run command',
    description: 'Runs a shell command on the server and returns stdout + stderr combined with the exit code. Timeout is 60 seconds maximum. Use for installs, config changes, or any operation not covered by a dedicated tool. Confirm with the customer before running destructive commands.',
    scope: 'deploy',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        command: { type: 'string', description: 'Shell command to run' },
        timeout_seconds: { type: 'integer', minimum: 1, maximum: 60, default: 30, description: 'Max seconds to wait (1–60)' },
      },
      required: ['server', 'command'],
      additionalProperties: false,
    },
    args: z.object({ server: serverRef, command: z.string().trim().min(1).max(8192), timeout_seconds: z.number().int().min(1).max(60).default(30) }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const timeoutMs = a.timeout_seconds * 1000;
      const r = await execOnServer(s.id, a.command, timeoutMs);
      return {
        serverId: s.id,
        audit: { command: a.command.slice(0, 2000), exitCode: r.code },
        text: `Command on "${s.name}" exited ${r.code}:\n\n${r.out.trim() || '(no output)'}`,
      };
    },
  },
  {
    name: 'write_file',
    title: 'Write file',
    description: 'Writes (creates or overwrites) a file on the server with the given content. Maximum 512 KB. The parent directory must already exist. Use for config files, scripts, etc. Overwrites without warning — confirm the path with the customer first.',
    scope: 'deploy',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        path: { type: 'string', description: 'Absolute path to write to' },
        content: { type: 'string', description: 'Text content to write (UTF-8, max 512 KB)' },
      },
      required: ['server', 'path', 'content'],
      additionalProperties: false,
    },
    args: z.object({ server: serverRef, path: z.string().trim().min(1).max(4096), content: z.string().max(FILE_CONTENT_MAX) }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      // the agent takes bytes base64-encoded; content arrives as UTF-8 text from the MCP client
      await fsRpc(s.id, 'fs.writefile', { path: a.path, data: Buffer.from(a.content, 'utf8').toString('base64') });
      return {
        serverId: s.id,
        audit: { path: a.path, bytes: Buffer.byteLength(a.content) },
        text: `Wrote ${Buffer.byteLength(a.content)} bytes to "${a.path}" on "${s.name}".`,
      };
    },
  },
  {
    name: 'restart_service',
    title: 'Restart service',
    description: "Runs systemctl start/stop/restart/enable/disable for a named systemd service on the server. Use 'restart' to apply config changes, 'enable'/'disable' to control auto-start on boot.",
    scope: 'deploy',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        service: { type: 'string', description: 'Systemd unit name, e.g. nginx or nginx.service' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'enable', 'disable', 'status'], default: 'restart' },
      },
      required: ['server', 'service'],
      additionalProperties: false,
    },
    args: z.object({
      server: serverRef,
      service: z.string().trim().regex(SAFE_SERVICE, 'Invalid service name'),
      action: z.enum(['start', 'stop', 'restart', 'enable', 'disable', 'status']).default('restart'),
    }).strict(),
    async run(auth, a) {
      const s = await resolveServer(auth, a.server);
      requireOnline(s);
      const unit = a.service.includes('.') ? a.service : `${a.service}.service`;
      const r = await execOnServer(s.id, `systemctl ${a.action} ${unit} 2>&1; systemctl is-active ${unit} 2>/dev/null || true`, 20_000);
      const active = r.out.trim().split('\n').pop() ?? '';
      return {
        serverId: s.id,
        audit: { service: unit, action: a.action },
        text: `systemctl ${a.action} ${unit} on "${s.name}" — service is now: ${active || `exit ${r.code}`}${r.out.trim() ? `\n\n${r.out.trim()}` : ''}`,
      };
    },
  },
];

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

async function handleMessage(msg: any, auth: TokenAuth, ctx: AuditContext): Promise<object | null> {
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
        instructions: INSTRUCTIONS_DEPLOY,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.filter((t) => t.scope !== 'deploy' || auth.scope === 'deploy').map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: t.readOnlyHint ?? (t.scope === 'read'),
            destructiveHint: t.destructiveHint ?? false,
            idempotentHint: t.idempotentHint ?? (t.scope === 'read'),
            openWorldHint: t.openWorldHint ?? (t.name === 'get_public_ip'),
          },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name).slice(0, 60)}`);
      if (tool.scope === 'deploy' && auth.scope !== 'deploy') {
        const sid = await bestEffortServerId(auth, (msg.params?.arguments as any)?.server).catch(() => null);
        await audit(auth.clientId, sid, `mcp.${tool.name}`, { ...safeFailureMeta(tool.name, msg.params?.arguments), error: 'scope denied' }, auth.name, ctx).catch(() => {});
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'This connection is read-only. Create a token with deploy access in the panel to run_command, write_file or restart_service.' }] });
      }
      const parsed = tool.args.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) {
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'Invalid arguments: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ') }] });
      }
      try {
        const out = await tool.run(auth, parsed.data);
        if (out.serverId) await audit(auth.clientId, out.serverId, `mcp.${tool.name}`, out.audit ?? {}, auth.name, ctx, auth.tokenId).catch(() => {});
        return rpcResult(msg.id, { content: [{ type: 'text', text: out.text }] });
      } catch (e) {
        if (e instanceof ToolError) {
          // a failed attempt is still an action: log what was tried (safe meta only, never file content)
          const sid = await bestEffortServerId(auth, (msg.params?.arguments as any)?.server).catch(() => null);
          await audit(auth.clientId, sid, `mcp.${tool.name}`, { ...safeFailureMeta(tool.name, msg.params?.arguments), error: e.message.slice(0, 300) }, auth.name, ctx, auth.tokenId).catch(() => {});
          return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: e.message }] });
        }
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
    const auth = await authenticateToken(req.headers.authorization, req.ip, req.headers['user-agent']);
    if (!auth) {
      return reply.code(401).header('www-authenticate', `Bearer realm="snbd-console", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`).send({ error: 'Missing, invalid, revoked or expired token' });
    }
    const body = req.body as unknown;
    if (body === undefined || body === null || typeof body !== 'object') return reply.code(400).send(rpcError(null, -32700, 'Parse error'));
    const ctx = requestContext(req);
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > 20) return reply.code(400).send(rpcError(null, -32600, 'Batch must contain 1 to 20 messages'));
      const out = (await Promise.all(body.map((m) => handleMessage(m, auth, ctx)))).filter((r): r is object => r !== null);
      if (out.length === 0) return reply.code(202).send();
      return out;
    }
    const res = await handleMessage(body, auth, ctx);
    if (res === null) return reply.code(202).send();
    return res;
  });

  // no server-initiated stream and no sessions: say so instead of hanging
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'Use POST' }) });
  }
}
