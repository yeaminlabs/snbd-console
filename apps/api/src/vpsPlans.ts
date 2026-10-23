import type { FastifyInstance } from 'fastify';
import { clientFromRequest } from './session.js';

// Reads VPS products straight from WHMCS (Setup > Products/Services) so the console never
// hardcodes pricing or specs, and never touches payment: "ordering" just hands the client off
// to the WHMCS cart to pay. Once WHMCS activates the service, the existing snbdpanel module
// provisions it through /webhooks/whmcs and it shows up here on its own.
//   WHMCS_API_URL          e.g. https://portal.snbdhost.com (no trailing slash)
//   WHMCS_API_IDENTIFIER   Setup > API Credentials
//   WHMCS_API_SECRET       Setup > API Credentials
//   WHMCS_VPS_GROUP_ID     the Product Group ID that holds the VPS products
// Changing the WHMCS address or group later is an .env edit + restart, no redeploy.

interface WhmcsConfig { url: string; identifier: string; secret: string; groupId: string }

function getConfig(): WhmcsConfig | null {
  const url = process.env.WHMCS_API_URL?.replace(/\/+$/, '');
  const identifier = process.env.WHMCS_API_IDENTIFIER;
  const secret = process.env.WHMCS_API_SECRET;
  const groupId = process.env.WHMCS_VPS_GROUP_ID;
  if (!url || !identifier || !secret || !groupId) return null;
  return { url, identifier, secret, groupId };
}

export interface VpsPlan {
  id: number;
  name: string;
  description: string;
  price: string | null;
  cycle: string | null;
  orderUrl: string;
}

async function callWhmcs(cfg: WhmcsConfig, action: string, params: Record<string, string> = {}): Promise<any> {
  const body = new URLSearchParams({ identifier: cfg.identifier, secret: cfg.secret, action, responsetype: 'json', ...params });
  const res = await fetch(`${cfg.url}/includes/api.php`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`WHMCS API HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(data.message || `WHMCS API error (${data.result})`);
  return data;
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const CYCLES: [string, string][] = [
  ['monthly', '/mo'], ['annually', '/yr'], ['quarterly', '/qtr'],
  ['semiannually', '/6mo'], ['biennially', '/2yr'], ['triennially', '/3yr'],
];

function pickPrice(pricing: Record<string, Record<string, string>> | undefined): { price: string; cycle: string } | null {
  const currency = pricing ? Object.values(pricing)[0] : undefined;
  if (!currency) return null;
  for (const [key, label] of CYCLES) {
    const v = currency[key];
    if (v && v !== '-1.00' && v !== '0.00') return { price: `${currency.prefix ?? ''}${v}${currency.suffix ? ` ${currency.suffix}` : ''}`, cycle: label };
  }
  return null;
}

async function fetchPlans(cfg: WhmcsConfig): Promise<VpsPlan[]> {
  const data = await callWhmcs(cfg, 'GetProducts', { gid: cfg.groupId });
  const raw = data.products?.product ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((p: any) => p && p.pid != null && p.hidden !== true && p.hidden !== '1')
    .map((p: any) => {
      const picked = pickPrice(p.pricing);
      return {
        id: Number(p.pid),
        name: String(p.name ?? `Plan ${p.pid}`),
        description: stripTags(String(p.description ?? '')),
        price: picked?.price ?? null,
        cycle: picked?.cycle ?? null,
        orderUrl: `${cfg.url}/cart.php?a=add&pid=${p.pid}`,
      } satisfies VpsPlan;
    });
}

let cache: { at: number; plans: VpsPlan[] } | null = null;
const CACHE_MS = 60_000;

export function registerVpsPlans(app: FastifyInstance) {
  app.get('/api/vps-plans', async (req, reply) => {
    const client = await clientFromRequest(req);
    if (!client) return reply.code(401).send({ error: 'Not signed in' });
    const cfg = getConfig();
    if (!cfg) return reply.code(503).send({ error: 'VPS ordering is not set up yet' });
    if (cache && Date.now() - cache.at < CACHE_MS) return { plans: cache.plans };
    try {
      const plans = await fetchPlans(cfg);
      cache = { at: Date.now(), plans };
      return { plans };
    } catch (err) {
      req.log.error(err, 'WHMCS GetProducts failed');
      if (cache) return { plans: cache.plans, stale: true };
      return reply.code(502).send({ error: 'Could not reach the billing system' });
    }
  });
}
