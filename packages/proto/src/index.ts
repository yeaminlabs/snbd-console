import { z } from 'zod';

// agent -> panel
export const AgentHello = z.object({ type: z.literal('hello'), token: z.string(), version: z.string(), hostname: z.string().optional() });
export const AgentAuth = z.object({ type: z.literal('auth'), serverId: z.string().uuid(), key: z.string(), version: z.string() });
export const AgentHeartbeat = z.object({
  type: z.literal('heartbeat'),
  cpu: z.number(),
  memUsed: z.number(),
  memTotal: z.number(),
  diskUsed: z.number(),
  diskTotal: z.number(),
  uptime: z.number(),
});
// data is base64 of raw pty bytes
export const AgentTermOut = z.object({ type: z.literal('term.out'), sid: z.string(), data: z.string() });
export const AgentTermExit = z.object({ type: z.literal('term.exit'), sid: z.string() });

export const AgentRpcResult = z.object({ type: z.literal('rpc.result'), id: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() });
export const AgentJobLog = z.object({ type: z.literal('job.log'), jobId: z.string(), data: z.string() });
export const AgentJobDone = z.object({ type: z.literal('job.done'), jobId: z.string(), code: z.number().int() });
// sent once right after "ready" (and again after a provider resize changes the hardware underneath):
// lets the panel fill in OS/vCPU/RAM/disk for servers it didn't provision itself (e.g. imported ones).
export const AgentSysinfo = z.object({
  type: z.literal('sysinfo'),
  os: z.string().max(120).optional(),
  arch: z.string().max(40).optional(),
  vcpu: z.number().int().positive().optional(),
  ramTotal: z.number().positive().optional(),
  diskTotal: z.number().positive().optional(),
});

export const AgentMessage = z.discriminatedUnion('type', [AgentHello, AgentAuth, AgentHeartbeat, AgentTermOut, AgentTermExit, AgentRpcResult, AgentJobLog, AgentJobDone, AgentSysinfo]);
export type AgentMessage = z.infer<typeof AgentMessage>;

// panel -> agent (the agent is Go, so these are documented here and mirrored in agent/proto.go)
export const PanelEnrolled = z.object({ type: z.literal('enrolled'), serverId: z.string().uuid(), key: z.string() });
export const PanelReady = z.object({ type: z.literal('ready') });
export const PanelError = z.object({ type: z.literal('error'), message: z.string() });
export const PanelTermOpen = z.object({ type: z.literal('term.open'), sid: z.string(), cols: z.number().int(), rows: z.number().int() });
export const PanelTermIn = z.object({ type: z.literal('term.in'), sid: z.string(), data: z.string() });
export const PanelTermResize = z.object({ type: z.literal('term.resize'), sid: z.string(), cols: z.number().int(), rows: z.number().int() });
// panel -> agent: { type:'rpc', id, op, args } answered by rpc.result; { type:'job.start', jobId, script }; { type:'job.cancel', jobId }
export const PanelTermClose = z.object({ type: z.literal('term.close'), sid: z.string() });

// browser -> panel (terminal websocket, text frames). Output goes back as binary frames.
export const BrowserTermMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('in'), data: z.string() }),
  z.object({ type: z.literal('resize'), cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(200) }),
]);
export type BrowserTermMessage = z.infer<typeof BrowserTermMessage>;

export const ServerStatus = z.enum(['provisioning', 'running', 'agent_offline', 'stopped']);
