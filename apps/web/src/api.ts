export interface Me { id: string; name: string; email: string }

export interface Plan { vcpu?: number; ramGb?: number; diskGb?: number; name?: string }

export interface Server {
  id: string;
  name: string;
  provider: 'bdix' | 'hetzner' | 'imported';
  /** Who owns the lifecycle: WHMCS services can only be stopped from WHMCS. */
  managedBy: 'whmcs' | 'imported' | 'panel';
  whmcsServiceId: number | null;
  status: 'provisioning' | 'running' | 'agent_offline' | 'stopped';
  ip: string | null;
  region: string | null;
  plan: Plan;
  os: string | null;
  cpu: number | null;
  created_at: string;
  suspended_at: string | null;
  reinstall_started_at: string | null;
  capabilities?: { power: boolean; rebuild: boolean };
  agentConnected: boolean;
  agent_version?: string | null;
  last_seen_at?: string | null;
}

export interface Metrics {
  points: { t: string; cpu: number | null }[];
  latest: { at: string; cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number; uptime: number } | null;
}

export interface OsImage { image: string; name: string; ver: string; brand: string; logo: string; fallbackLogo: string; reinstallArgs: string; note?: string }
export interface FileEntry { name: string; type: 'dir' | 'file' | 'other'; link?: boolean; size: number; mode: string; mtime: number }
export interface AppInfo { id: string; name: string; tag: string; desc: string; installed: boolean | null }
export interface JobState { status: 'queued' | 'running' | 'done' | 'failed'; app: string; offset: number; log: string; pct: number; step: string }
export interface AuditItem { id: number; action: string; at: string; meta: Record<string, any>; system: boolean; via: string | null; serverId: string; server: string }
export interface OAuthRequestInfo { clientName: string; returnsTo: string; servers: { id: string; name: string }[]; access: string }
export interface TokenInfo { kind: 'token' | 'connector'; id: string; name: string; prefix: string; scope: 'read' | 'deploy'; serverIds: string[] | null; serverNames: string[]; expiresAt: string | null; lastUsedAt: string | null; createdAt: string }
export interface McpConnection {
  id: string;
  kind: 'token' | 'connector';
  /** Friendly client name, e.g. "Claude Code" or "OpenCode". */
  name: string;
  clientKind: string;
  version: string | null;
  os: string | null;
  ip: string | null;
  scope: 'read' | 'deploy';
  /** null = every server on the account. */
  servers: string[] | null;
  serverNames: string[];
  lastSeenAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  connected: boolean;
}
export interface McpInfo { url: string; connections: McpConnection[]; connectedCount: number }
export interface ActivityItem { id: number; action: string; at: string; server: string }
export interface ImportResult { serverId: string; token: string; expiresInMinutes: number; panelUrl: string }
export interface VpsPlan { id: number; name: string; description: string; price: string | null; cycle: string | null; orderUrl: string }

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = (url: string, data: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  me: () => fetch('/api/me').then((r) => (r.status === 401 ? null : json<Me>(r))),
  login: (email: string, password: string) => post('/api/login', { email, password }).then(json<Me>),
  logout: () => fetch('/api/logout', { method: 'POST' }),
  servers: () => fetch('/api/servers').then(json<Server[]>),
  server: (id: string) => fetch(`/api/servers/${id}`).then(json<Server>),
  removeServer: (id: string) => fetch(`/api/servers/${id}`, { method: 'DELETE' }).then(json<{ ok: true }>),
  metrics: (id: string) => fetch(`/api/servers/${id}/metrics`).then(json<Metrics>),
  activity: () => fetch('/api/activity').then(json<ActivityItem[]>),
  osImages: () => fetch('/api/os-images').then(json<OsImage[]>),
  power: (id: string, action: 'start' | 'stop' | 'reboot') => post(`/api/servers/${id}/power`, { action }).then(json<{ ok: true }>),
  reinstall: (id: string, os: string) => post(`/api/servers/${id}/reinstall`, { os, acknowledged: true }).then(json<{ ok: true; rootPassword?: string }>),
  files: (id: string, path: string) => fetch(`/api/servers/${id}/files?path=${encodeURIComponent(path)}`).then(json<{ path: string; entries: FileEntry[] }>),
  readFile: (id: string, path: string) => fetch(`/api/servers/${id}/files/content?path=${encodeURIComponent(path)}`).then(json<{ path: string; size: number; content: string }>),
  saveFile: (id: string, path: string, content: string) => fetch(`/api/servers/${id}/files/content`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content }) }).then(json<{ ok: true }>),
  mkdir: (id: string, path: string) => post(`/api/servers/${id}/files/mkdir`, { path }).then(json<{ ok: true }>),
  rename: (id: string, from: string, to: string) => post(`/api/servers/${id}/files/rename`, { from, to }).then(json<{ ok: true }>),
  remove: (id: string, path: string) => post(`/api/servers/${id}/files/delete`, { path }).then(json<{ ok: true }>),
  apps: (id: string) => fetch(`/api/servers/${id}/apps`).then(json<{ agentConnected: boolean; apps: AppInfo[]; lastJob: { id: string; app: string; status: string } | null }>),
  install: (id: string, app: string) => post(`/api/servers/${id}/apps/${app}/install`, {}).then(json<{ jobId: string }>),
  job: (id: string, jobId: string, from: number) => fetch(`/api/servers/${id}/jobs/${jobId}?from=${from}`).then(json<JobState>),
  cancelJob: (id: string, jobId: string) => post(`/api/servers/${id}/jobs/${jobId}/cancel`, {}).then(json<{ ok: true }>),
  resetPassword: (id: string) => post(`/api/servers/${id}/password-reset`, {}).then(json<{ user: string; password: string }>),
  audit: (server: string, before: number | null) => fetch(`/api/audit?limit=50${server ? `&server=${server}` : ''}${before ? `&before=${before}` : ''}`).then(json<{ items: AuditItem[]; next: number | null }>),
  tokens: () => fetch('/api/tokens').then(json<TokenInfo[]>),
  mcpConnections: () => fetch('/api/mcp/connections').then(json<McpInfo>),
  createToken: (name: string, serverIds: string[] | null, expiresInDays: number | null) => post('/api/tokens', { name, serverIds, expiresInDays }).then(json<{ id: string; token: string; expiresAt: string | null }>),
  revokeToken: (id: string) => fetch(`/api/tokens/${id}`, { method: 'DELETE' }).then(json<{ ok: true }>),
  oauthRequest: (id: string) => fetch(`/api/oauth/request/${id}`).then(json<OAuthRequestInfo>),
  oauthApprove: (id: string, serverIds: string[] | null) => post(`/api/oauth/request/${id}/approve`, { serverIds }).then(json<{ redirect: string }>),
  oauthDeny: (id: string) => post(`/api/oauth/request/${id}/deny`, {}).then(json<{ redirect: string }>),
  importServer: (name: string) => post('/api/servers/import', { name }).then(json<ImportResult>),
  vpsPlans: () => fetch('/api/vps-plans').then(json<{ plans: VpsPlan[]; stale?: boolean }>),
  aiSession: (serverId: string) => post(`/api/servers/${serverId}/ai-session`, {}).then(json<{ token: string }>),
};
