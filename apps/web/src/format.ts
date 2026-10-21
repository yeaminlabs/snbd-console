import type { Plan, Server } from './api';

export const statusLabel: Record<Server['status'], [string, string]> = {
  running: ['Running', 'ok'],
  provisioning: ['Provisioning', 'warn'],
  agent_offline: ['Agent offline', 'off'],
  stopped: ['Stopped', 'off'],
};

export function sourceLabel(s: Pick<Server, 'provider' | 'region'>): [string, string] {
  if (s.provider === 'bdix') return [s.region ? `BDIX · ${s.region}` : 'BDIX', 'info'];
  if (s.provider === 'hetzner') return [s.region ? `Hetzner · ${s.region}` : 'Hetzner', 'off'];
  return ['Imported', 'off'];
}

export function planLabel(p: Plan): string {
  const parts = [p.vcpu && `${p.vcpu} vCPU`, p.ramGb && `${p.ramGb} GB`, p.diskGb && `${p.diskGb} GB`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function uptimeLabel(seconds: number): [string, string] {
  const d = Math.floor(seconds / 86400);
  if (d >= 1) return [String(d), d === 1 ? 'day' : 'days'];
  const h = Math.floor(seconds / 3600);
  if (h >= 1) return [String(h), h === 1 ? 'hour' : 'hours'];
  return [String(Math.floor(seconds / 60)), 'min'];
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

// a suspended service overrides whatever the agent last reported
export const statusOf = (s: Pick<Server, 'status' | 'suspended_at' | 'reinstall_started_at'>): [string, string] =>
  s.suspended_at ? ['Suspended', 'warn'] : s.reinstall_started_at ? ['Reinstalling', 'warn'] : statusLabel[s.status];
