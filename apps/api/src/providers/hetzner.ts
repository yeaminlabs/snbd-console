import type { Plan, PowerAction, ProviderAdapter, ProviderServer, ProvisionSpec } from './index.js';
import { ProviderError } from './index.js';

interface HetznerAction { id: number; status: 'running' | 'success' | 'error'; error: { code: string; message: string } | null }

const ACTION_TIMEOUT_MS = 120_000;
const POLL_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hetzner hostnames must be RFC 1123 and unique per project, so the panel id is appended
const hostname = (name: string, id: string) => `${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vps'}-${id.slice(0, 8)}`;

export class HetznerAdapter implements ProviderAdapter {
  capabilities = { power: true, rebuild: true };

  constructor(private token: string, private baseUrl = 'https://api.hetzner.cloud/v1') {}

  private async api<T = any>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ProviderError(`Hetzner unreachable: ${(err as Error).message}`, 'unreachable');
    }
    if (okStatuses.includes(res.status)) return null;
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ProviderError(`Hetzner ${res.status} ${data?.error?.code ?? ''}: ${data?.error?.message ?? 'request failed'}`, data?.error?.code ?? 'provider_error');
    return data as T;
  }

  /** Polls an action until it finishes; Hetzner reports failures in action.error. */
  private async wait(action: HetznerAction | undefined) {
    if (!action) return;
    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    let a = action;
    while (a.status === 'running') {
      if (Date.now() > deadline) throw new ProviderError('Hetzner action timed out', 'timeout');
      await sleep(POLL_MS);
      a = (await this.api<{ action: HetznerAction }>('GET', `/actions/${action.id}`))!.action;
    }
    if (a.status === 'error') throw new ProviderError(`Hetzner action failed: ${a.error?.message ?? 'unknown'}`, a.error?.code ?? 'action_failed');
  }

  private id(server: ProviderServer): number {
    if (!server.providerRef) throw new ProviderError('server has no Hetzner id', 'no_ref');
    return Number(server.providerRef);
  }

  async create(spec: ProvisionSpec) {
    if (!spec.plan.serverType) throw new ProviderError('plan.serverType is required for Hetzner (e.g. cx22)', 'invalid_plan');
    // a retried create must not leave a second billable server behind
    const existing = await this.api<{ servers: any[] }>('GET', `/servers?label_selector=${encodeURIComponent('snbd_server_id=' + spec.serverId)}`);
    const found = existing?.servers?.[0];
    if (found) return { providerRef: String(found.id), ip: found.public_net?.ipv4?.ip };

    const res = await this.api<{ server: any; action?: HetznerAction }>('POST', '/servers', {
      name: hostname(spec.name, spec.serverId),
      server_type: spec.plan.serverType,
      image: spec.os ?? 'ubuntu-24.04',
      ...(spec.region ? { location: spec.region } : {}),
      user_data: spec.userData,
      start_after_create: true,
      labels: { snbd_server_id: spec.serverId },
    });
    // root_password comes back here; it is deliberately dropped, clients reset it through the panel
    return { providerRef: String(res!.server.id), ip: res!.server.public_net?.ipv4?.ip };
  }

  async suspend(server: ProviderServer) {
    if (!server.providerRef) return;
    const r = await this.api<{ action: HetznerAction }>('POST', `/servers/${this.id(server)}/actions/poweroff`);
    await this.wait(r?.action);
  }

  async unsuspend(server: ProviderServer) {
    if (!server.providerRef) return;
    const r = await this.api<{ action: HetznerAction }>('POST', `/servers/${this.id(server)}/actions/poweron`);
    await this.wait(r?.action);
  }

  async power(server: ProviderServer, action: PowerAction) {
    const path = { start: 'poweron', stop: 'shutdown', reboot: 'reboot' }[action];
    const r = await this.api<{ action: HetznerAction }>('POST', `/servers/${this.id(server)}/actions/${path}`);
    await this.wait(r?.action);
  }

  async resize(server: ProviderServer, plan: Plan) {
    if (!server.providerRef) return;
    if (!plan.serverType) throw new ProviderError('plan.serverType is required to resize a Hetzner server', 'invalid_plan');
    const id = this.id(server);
    // a type change needs the server off; upgrade_disk stays false so the change can be reversed
    const off = await this.api<{ action: HetznerAction }>('POST', `/servers/${id}/actions/poweroff`);
    await this.wait(off?.action);
    const change = await this.api<{ action: HetznerAction }>('POST', `/servers/${id}/actions/change_type`, { server_type: plan.serverType, upgrade_disk: false });
    await this.wait(change?.action);
    const on = await this.api<{ action: HetznerAction }>('POST', `/servers/${id}/actions/poweron`);
    await this.wait(on?.action);
  }

  async destroy(server: ProviderServer) {
    if (!server.providerRef) return;
    const r = await this.api<{ action?: HetznerAction }>('DELETE', `/servers/${this.id(server)}`, undefined, [404]);
    await this.wait(r?.action);
  }

  async rebuild(server: ProviderServer, opts: { image: string; userData: string }) {
    const r = await this.api<{ action: HetznerAction; root_password?: string | null }>('POST', `/servers/${this.id(server)}/actions/rebuild`, { image: opts.image, user_data: opts.userData });
    await this.wait(r?.action);
    return { rootPassword: r?.root_password ?? undefined };
  }
}
