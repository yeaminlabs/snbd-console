import type { Plan, PowerAction, ProviderAdapter, ProviderServer, ProvisionSpec } from './index.js';
import { ProviderError } from './index.js';
import { deleteVm, rebootVm, resizeVm, startVm, stopVmGracefully } from './proxmoxClient.js';

const unsupported = (what: string) => new ProviderError(`${what} is not available for BDIX yet`, 'unsupported');

/**
 * Lifecycle control for VMs that already exist on Proxmox (created by hand, or later cloned by a
 * future `create()`). Suspend/unsuspend/terminate/resize/power are real — they call the actual
 * Proxmox API. `create` and `rebuild` are not implemented yet: new BDIX orders still need the
 * clone-from-template + IP-pool + cloud-init work, tracked separately. Until that lands,
 * `create()` refuses rather than pretending, same as the rest of this codebase's providers do
 * when a capability is missing.
 */
export class ProxmoxAdapter implements ProviderAdapter {
  capabilities = { power: true, rebuild: false };

  private id(server: ProviderServer): string {
    if (!server.providerRef) throw new ProviderError('server has no Proxmox VMID', 'no_ref');
    return server.providerRef;
  }

  async create(_spec: ProvisionSpec): Promise<{ providerRef: string | null; ip?: string }> {
    throw unsupported('Creating a new BDIX server');
  }

  async suspend(server: ProviderServer): Promise<void> {
    await stopVmGracefully(this.id(server));
  }

  async unsuspend(server: ProviderServer): Promise<void> {
    await startVm(this.id(server));
  }

  async power(server: ProviderServer, action: PowerAction): Promise<void> {
    const id = this.id(server);
    if (action === 'start') return startVm(id);
    if (action === 'stop') return stopVmGracefully(id);
    return rebootVm(id);
  }

  async resize(server: ProviderServer, plan: Plan): Promise<void> {
    await resizeVm(this.id(server), plan);
  }

  async destroy(server: ProviderServer): Promise<void> {
    if (!server.providerRef) return; // never attached to a real VM; nothing to delete
    await deleteVm(server.providerRef);
  }

  async rebuild(): Promise<{ rootPassword?: string }> {
    throw unsupported('Reinstall');
  }
}
