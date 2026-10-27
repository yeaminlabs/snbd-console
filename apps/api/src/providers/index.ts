import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HetznerAdapter } from './hetzner.js';

export interface Plan { vcpu?: number; ramGb?: number; diskGb?: number; name?: string; serverType?: string }

export interface ProvisionSpec {
  serverId: string;
  name: string;
  plan: Plan;
  region?: string;
  os?: string;
  userData: string;
}

export interface ProviderServer { id: string; provider: string; providerRef: string | null; name: string }

export type PowerAction = 'start' | 'stop' | 'reboot';

export class ProviderError extends Error {
  constructor(message: string, public code = 'provider_error') {
    super(message);
  }
}

// What the panel needs from a hosting backend. A backend that cannot do something says so in
// `capabilities`; the API then answers 501 instead of pretending.
export interface ProviderAdapter {
  capabilities: { power: boolean; rebuild: boolean };
  create(spec: ProvisionSpec): Promise<{ providerRef: string | null; ip?: string }>;
  suspend(server: ProviderServer): Promise<void>;
  unsuspend(server: ProviderServer): Promise<void>;
  resize(server: ProviderServer, plan: Plan): Promise<void>;
  destroy(server: ProviderServer): Promise<void>;
  power(server: ProviderServer, action: PowerAction): Promise<void>;
  /** Wipes the disk and installs `image`; userData brings the new system back to the panel. */
  rebuild(server: ProviderServer, opts: { image: string; userData: string }): Promise<{ rootPassword?: string }>;
}

const unsupported = (what: string) => new ProviderError(`${what} is not available for this provider yet`, 'unsupported');

// BDIX placeholder until the hypervisor is chosen. Creating records the user-data in development so the
// first-boot flow can be tried by hand; everything else is refused rather than faked.
const bdix: ProviderAdapter = {
  capabilities: { power: false, rebuild: false },
  async create(spec) {
    if (process.env.NODE_ENV !== 'production') {
      const dir = join(import.meta.dirname, '..', '..', '..', '..', 'dist', 'dev-userdata');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${spec.serverId}.yaml`), spec.userData, { mode: 0o600 });
    }
    console.warn(`[provider:bdix] stub: no VM created for ${spec.name} (${spec.serverId})`);
    return { providerRef: null };
  },
  async suspend() {},
  async unsuspend() {},
  async resize() {},
  async destroy() {},
  async power() { throw unsupported('Power control'); },
  async rebuild() { throw unsupported('Reinstall'); },
};

function pick(provider: string): ProviderAdapter {
  if (provider === 'hetzner') {
    const token = process.env.HETZNER_API_TOKEN;
    if (token) return new HetznerAdapter(token, process.env.HETZNER_API_URL);
    // A missing token must never turn an order into a pretend server in production: the client
    // would be billed for a VM that does not exist. Fail the provision call instead.
    if (process.env.NODE_ENV === 'production') {
      throw new ProviderError('HETZNER_API_TOKEN is not set on the panel', 'not_configured');
    }
    console.warn('[provider:hetzner] HETZNER_API_TOKEN not set; using the stub');
  }
  return bdix;
}

const cache = new Map<string, ProviderAdapter>();
export function getAdapter(provider: string): ProviderAdapter {
  let a = cache.get(provider);
  if (!a) cache.set(provider, (a = pick(provider)));
  return a;
}
