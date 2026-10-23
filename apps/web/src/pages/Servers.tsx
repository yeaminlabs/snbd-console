import { useEffect, useState, type FormEvent } from 'react';
import { api, type ActivityItem, type ImportResult, type Server, type VpsPlan } from '../api';
import { IconArrowUpRight, IconChevronRight, IconCopy } from '../components/Icons';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { planLabel, sourceLabel, statusOf, ago } from '../format';

const activityLabel: Record<string, string> = {
  'server.import': 'Server added',
  'agent.connected': 'Agent connected',
  'terminal.open': 'Terminal opened',
};

function ConnectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await api.importServer(name.trim()));
      setName('');
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const command = result ? `curl -fsSL ${result.panelUrl || location.origin}/enroll/${result.token} | sh` : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the command stays selectable */ }
  }

  return (
    <Modal titleId="connect-h" title="Connect an existing VPS" onClose={onClose}>
      <p className="muted" style={{ margin: '8px 0 16px' }}>Run this once as root on any Linux server to link it to your panel.</p>
      {result ? (
        <>
          <div className="codebox mono" tabIndex={0}>{command}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={copy}><IconCopy />{copied ? 'Copied' : 'Copy'}</button>
            <span className="muted" style={{ fontSize: 12 }}>One-time token, expires in {result.expiresInMinutes} minutes.</span>
          </div>
          <button className="btn-link" onClick={() => setResult(null)}>Add another</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="srv-name">Server name</label>
            <input id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. legacy-site" maxLength={60} required autoFocus />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn p" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Generate command'}</button>
        </form>
      )}
    </Modal>
  );
}

function OrderModal({ onClose, plans }: { onClose: () => void; plans: VpsPlan[] }) {
  return (
    <Modal titleId="order-h" title="Order a new VPS" onClose={onClose}>
      <p className="muted" style={{ margin: '8px 0 16px' }}>Pricing and specs come straight from your billing system. Payment happens there too — this just opens the right plan in your cart.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plans.map((p) => (
          <a key={p.id} className="plan-card" href={p.orderUrl} target="_blank" rel="noopener noreferrer">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              {p.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{p.description}</div>}
            </div>
            {p.price && <div className="plan-price">{p.price}<span className="muted">{p.cycle}</span></div>}
            <IconArrowUpRight className="chev" />
          </a>
        ))}
      </div>
    </Modal>
  );
}

export function Servers() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [plans, setPlans] = useState<VpsPlan[]>([]);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const load = () => {
    api.servers().then(setServers).catch((e) => setError(e.message));
    api.activity().then(setActivity).catch(() => {});
  };
  useEffect(() => {
    load();
    api.vpsPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([]));
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const count = (st: Server['status']) => servers?.filter((s) => s.status === st && !s.suspended_at).length ?? 0;
  const vcpu = servers?.reduce((n, s) => n + (s.plan.vcpu ?? 0), 0) ?? 0;
  const ram = servers?.reduce((n, s) => n + (s.plan.ramGb ?? 0), 0) ?? 0;
  const sources = new Set(servers?.map((s) => sourceLabel(s)[0].split(' · ')[0]));

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Servers</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            {servers ? `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}${sources.size ? ' across ' + [...sources].join(' and ') : ''}` : 'Loading…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {plans.length > 0 && <button className="btn" onClick={() => setOrdering(true)}>Order a new VPS</button>}
          <button className="btn p" onClick={() => setConnecting(true)}>Connect existing VPS</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {connecting && <ConnectModal onClose={() => setConnecting(false)} onCreated={load} />}
      {ordering && <OrderModal onClose={() => setOrdering(false)} plans={plans} />}

      <div className="stats">
        <div className="card pad"><div className="th">Running</div><div className="stat">{count('running')}</div></div>
        <div className="card pad"><div className="th">Provisioning</div><div className="stat">{count('provisioning')}</div></div>
        <div className="card pad"><div className="th">Agent offline</div><div className="stat">{count('agent_offline')}</div></div>
        <div className="card pad"><div className="th">Total vCPU / RAM</div><div className="stat">{vcpu} <span className="muted" style={{ fontSize: 16 }}>/ {ram} GB</span></div></div>
      </div>

      <div className="cols">
        <div className="card grow-lg" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 860 }}>
              <div className="srow th" style={{ borderTop: 0 }}><div>Server</div><div>Source</div><div>Plan</div><div>System</div><div>Status</div><div>CPU</div></div>
              {servers === null && [0, 1, 2].map((i) => (
                <div className="srow" key={i} aria-hidden="true">
                  <div className="skeleton skeleton-line" style={{ height: 14 }} />
                  <div className="skeleton skeleton-line" style={{ width: '60%', height: 20, borderRadius: 999 }} />
                  <div className="skeleton skeleton-line" style={{ width: '50%', height: 14 }} />
                  <div className="skeleton skeleton-line" style={{ width: '70%', height: 14 }} />
                  <div className="skeleton skeleton-line" style={{ width: '50%', height: 20, borderRadius: 999 }} />
                  <div className="skeleton skeleton-line" style={{ width: '80%', height: 6 }} />
                </div>
              ))}
              {servers?.map((s) => {
                const [label, cls] = statusOf(s);
                const [src, srcCls] = sourceLabel(s);
                const cpu = Math.round(s.cpu ?? 0);
                return (
                  <a className="srow" key={s.id} href={`#/servers/${s.id}`}>
                    <div>
                      <div className="name">{s.name}</div>
                      <div className="mono muted" style={{ fontSize: 12 }}>{s.ip ?? 'no IP yet'}</div>
                    </div>
                    <div><Badge cls={srcCls}>{src}</Badge></div>
                    <div className="muted">{planLabel(s.plan)}</div>
                    <div className="muted">{s.os ?? '—'}</div>
                    <div><Badge cls={cls}>{label}</Badge></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <div className="bar"><div style={{ width: `${cpu}%` }} /></div>
                        <span className="muted" style={{ fontSize: 12, width: 32 }}>{s.cpu == null ? '—' : `${cpu}%`}</span>
                      </div>
                      <IconChevronRight className="chev" />
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
          {servers?.length === 0 && (
            <div className="empty-state" style={{ height: 'auto', padding: '32px 20px', margin: 0, border: 0 }}>
              <b>No servers yet</b>
              <span>Order a new VPS or connect one you already have.</span>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {plans.length > 0 && <button className="btn" onClick={() => setOrdering(true)}>Order a new VPS</button>}
                <button className="btn p" onClick={() => setConnecting(true)}>Connect existing VPS</button>
              </div>
            </div>
          )}
        </div>
        <div className="side-col">
          <section className="card pad" aria-labelledby="act-h">
            <h2 id="act-h" className="card-title" style={{ marginBottom: 12 }}>Recent activity</h2>
            {activity.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
            {activity.map((a) => (
              <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid #f4f4f5' }}>
                <div style={{ fontWeight: 500 }}>{activityLabel[a.action] ?? a.action}</div>
                <div className="muted" style={{ fontSize: 12 }}>{a.server} · {ago(a.at)}</div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
