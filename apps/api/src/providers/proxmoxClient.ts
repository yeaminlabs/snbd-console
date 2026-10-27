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

export function pveNode(): string {
  return process.env.PROXMOX_NODE ?? 'pve';
}

export async function pve<T = any>(method: string, path: string, body?: Record<string, string>, okStatuses: number[] = []): Promise<T | null> {
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
  if (okStatuses.includes(res.status)) return null;
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ProviderError(`Proxmox ${res.status}: ${data?.message ?? 'request failed'}`, 'provider_error');
  return data.data as T;
}

/** Which config key holds the boot disk, and its current size in GB (null if unparseable). */
export function findDisk(cfg: Record<string, any>): { key: string; diskGb: number | null } {
  for (const key of ['scsi0', 'virtio0', 'sata0', 'ide0']) {
    const v = cfg[key];
    if (typeof v !== 'string') continue;
    const m = v.match(/size=(\d+(?:\.\d+)?)([GM])/i);
    const diskGb = m ? (m[2].toUpperCase() === 'G' ? Number(m[1]) : Math.round((Number(m[1]) / 1024) * 10) / 10) : null;
    return { key, diskGb };
  }
  return { key: 'scsi0', diskGb: null };
}

function assertVmid(vmid: string) {
  if (!/^\d{1,6}$/.test(vmid)) throw new ProviderError('vmid must be numeric', 'invalid_input');
}

export async function getVmConfig(vmid: string): Promise<Record<string, any>> {
  assertVmid(vmid);
  return (await pve<Record<string, any>>('GET', `/nodes/${pveNode()}/qemu/${vmid}/config`))!;
}

/** Looks up a VMID on the configured node; throws if it does not exist. Never creates or changes anything. */
export async function getVmInfo(vmid: string): Promise<VmInfo> {
  const cfg = await getVmConfig(vmid);
  const ramGb = Math.round(((Number(cfg.memory) || 1024) / 1024) * 10) / 10;
  return { name: String(cfg.name ?? `vm-${vmid}`), cores: Number(cfg.cores) || 1, ramGb, diskGb: findDisk(cfg).diskGb };
}

interface PveTask { status: 'running' | 'stopped'; exitstatus?: string }

/** Polls a Proxmox task (UPID) until it finishes; throws if it did not end in "OK". */
export async function waitTask(upid: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = (await pve<PveTask>('GET', `/nodes/${pveNode()}/tasks/${encodeURIComponent(upid)}/status`))!;
    if (t.status === 'stopped') {
      if (t.exitstatus && t.exitstatus !== 'OK') throw new ProviderError(`Proxmox task failed: ${t.exitstatus}`, 'action_failed');
      return;
    }
    if (Date.now() > deadline) throw new ProviderError('Proxmox task timed out', 'timeout');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Current power state: "running" | "stopped" | etc., straight from Proxmox. */
export async function getVmStatus(vmid: string): Promise<string> {
  assertVmid(vmid);
  const s = (await pve<{ status: string }>('GET', `/nodes/${pveNode()}/qemu/${vmid}/status/current`))!;
  return s.status;
}

async function vmAction(vmid: string, action: 'start' | 'shutdown' | 'stop' | 'reboot'): Promise<void> {
  assertVmid(vmid);
  const upid = (await pve<string>('POST', `/nodes/${pveNode()}/qemu/${vmid}/status/${action}`))!;
  await waitTask(upid, action === 'shutdown' ? 35_000 : 60_000);
}

export async function startVm(vmid: string): Promise<void> {
  await vmAction(vmid, 'start');
}

/** Graceful ACPI shutdown; falls back to a hard stop if the guest does not respond in time. */
export async function stopVmGracefully(vmid: string): Promise<void> {
  try {
    await vmAction(vmid, 'shutdown');
  } catch {
    await vmAction(vmid, 'stop');
  }
}

export async function rebootVm(vmid: string): Promise<void> {
  await vmAction(vmid, 'reboot');
}

/** Deletes the VM and its disks. A VMID that is already gone is treated as success (idempotent). */
export async function deleteVm(vmid: string): Promise<void> {
  assertVmid(vmid);
  try {
    const status = await getVmStatus(vmid);
    if (status === 'running') await stopVmGracefully(vmid);
  } catch {
    /* unknown/already-gone VMID: let the delete call below decide, 404/500 are treated as success */
  }
  const upid = await pve<string>('DELETE', `/nodes/${pveNode()}/qemu/${vmid}?purge=1`, undefined, [404, 500]);
  if (upid) await waitTask(upid, 60_000);
}

/** Updates cores/memory live, and grows the boot disk if the new size is larger (Proxmox cannot shrink). */
export async function resizeVm(vmid: string, specs: { vcpu?: number; ramGb?: number; diskGb?: number }): Promise<void> {
  assertVmid(vmid);
  const cfg = await getVmConfig(vmid);
  const body: Record<string, string> = {};
  if (specs.vcpu) body.cores = String(specs.vcpu);
  if (specs.ramGb) body.memory = String(Math.round(specs.ramGb * 1024));
  if (Object.keys(body).length) await pve('PUT', `/nodes/${pveNode()}/qemu/${vmid}/config`, body);

  if (specs.diskGb) {
    const { key, diskGb } = findDisk(cfg);
    if (diskGb == null || specs.diskGb > diskGb) {
      // the resize endpoint answers 200 with no task id for some storage backends; only wait when one comes back
      const upid = await pve<string | null>('PUT', `/nodes/${pveNode()}/qemu/${vmid}/resize`, { disk: key, size: `${specs.diskGb}G` });
      if (upid) await waitTask(upid, 30_000);
    }
    // a requested size at or below the current disk is silently kept — Proxmox cannot shrink a live disk
  }
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
