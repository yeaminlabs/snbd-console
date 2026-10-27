import { ProviderError } from './index.js';

// Minimal read/exec client for the "attach an already-existing VM" flow. Not the full
// create/suspend/resize/destroy adapter yet — just enough to verify a VMID is real, pull its
// specs, and push the same enroll script the install flow already uses everywhere else.

interface VmInfo { name: string; cores: number; ramGb: number; diskGb: number | null }

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new ProviderError(`${name} is not set on the panel`, 'not_configured');
  return v;
}

function auth(): string {
  return `PVEAPIToken=${env('PROXMOX_TOKEN_ID')}=${env('PROXMOX_TOKEN_SECRET')}`;
}

async function pve<T = any>(method: string, path: string, body?: Record<string, string>): Promise<T> {
  const base = env('PROXMOX_URL').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/api2/json${path}`, {
      method,
      headers: { authorization: auth(), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ProviderError(`Proxmox unreachable: ${(err as Error).message}`, 'unreachable');
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ProviderError(`Proxmox ${res.status}: ${data?.message ?? 'request failed'}`, 'provider_error');
  return data.data as T;
}

function parseDiskGb(cfg: Record<string, any>): number | null {
  for (const key of ['scsi0', 'virtio0', 'sata0', 'ide0']) {
    const v = cfg[key];
    if (typeof v !== 'string') continue;
    const m = v.match(/size=(\d+(?:\.\d+)?)([GM])/i);
    if (!m) continue;
    const n = Number(m[1]);
    return m[2].toUpperCase() === 'G' ? n : Math.round((n / 1024) * 10) / 10;
  }
  return null;
}

/** Looks up a VMID on the configured node; throws if it does not exist. Never creates or changes anything. */
export async function getVmInfo(vmid: string): Promise<VmInfo> {
  if (!/^\d{1,6}$/.test(vmid)) throw new ProviderError('vmid must be numeric', 'invalid_input');
  const node = process.env.PROXMOX_NODE ?? 'pve';
  const cfg = await pve<Record<string, any>>('GET', `/nodes/${node}/qemu/${vmid}/config`);
  const ramGb = Math.round(((Number(cfg.memory) || 1024) / 1024) * 10) / 10;
  return { name: String(cfg.name ?? `vm-${vmid}`), cores: Number(cfg.cores) || 1, ramGb, diskGb: parseDiskGb(cfg) };
}

/**
 * Fire-and-forget: starts the enroll curl inside the guest over the (hypervisor-authorized, no
 * guest login needed) QEMU guest-agent channel and returns immediately. Installation itself takes
 * 1-3 minutes, so the caller never waits for it — the server flips to "running" on its own once
 * the agent connects, same as every other provider. Returns false (not thrown) when the guest
 * agent is not reachable, so the caller can fall back to a manual command.
 */
export async function pushEnrollScript(vmid: string, enrollUrl: string): Promise<boolean> {
  const node = process.env.PROXMOX_NODE ?? 'pve';
  try {
    const base = env('PROXMOX_URL').replace(/\/$/, '');
    // repeated "command" params are argv, not a shell string — the quoting-safe way to pass this
    const params = new URLSearchParams();
    params.append('command', 'sh');
    params.append('command', '-c');
    params.append('command', `curl -fsSL ${enrollUrl} | sh >/tmp/snbd-enroll.log 2>&1; echo EXIT:$?`);
    const res = await fetch(`${base}/api2/json/nodes/${node}/qemu/${vmid}/agent/exec`, {
      method: 'POST',
      headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    return res.ok && typeof data?.data?.pid === 'number';
  } catch {
    return false;
  }
}
