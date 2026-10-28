import { useEffect, useState, type FormEvent } from 'react';
import { api, type ActivityItem, type ImportResult, type Server } from '../api';
import { PROVIDERS } from '../components/ProviderLogos';
import { IconChevronRight, IconCopy } from '../components/Icons';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { actorLabel, actorType, planLabel, sourceLabel, statusOf, secondaryStatus, joinList, ago, parseDevice } from '../format';

const activityLabel: Record<string, string> = {
  'server.import': 'Server added',
  'agent.connected': 'Agent connected',
  'terminal.open': 'Terminal opened',
};

function ConnectModal({ onClose, onCreated, reconnect }: { onClose: () => void; onCreated: () => void; reconnect?: { id: string; name: string } }) {
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

  // Opened from the "no agent" banner for a specific server: skip the name
  // step and go straight to that server's install command.
  useEffect(() => {
    if (!reconnect) return;
    setBusy(true);
    setError('');
    api.reconnectAgent(reconnect.id)
      .then((r) => { setResult(r); onCreated(); })
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }, [reconnect?.id]);

  const command = result ? `curl -fsSL ${result.panelUrl || location.origin}/enroll/${result.token} | sh` : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the command stays selectable */ }
  }

  return (
    <Modal titleId="connect-h" title={reconnect ? `Connect ${reconnect.name}` : 'Connect an existing VPS'} onClose={onClose} wide>
      {reconnect ? (
        <p className="muted" style={{ margin: '8px 0 4px' }}>
          The agent on <b style={{ color: 'var(--ink)' }}>{reconnect.name}</b> isn't talking to the panel. Run the command below on that server as root and it will link itself back up.
        </p>
      ) : (
        <p className="muted" style={{ margin: '8px 0 4px' }}>
          Got a VPS somewhere else? Add it here and run everything from one place. Any Linux server works.
        </p>
      )}
      <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', marginTop: 12 }}>ADD SERVERS FROM</div>
      <div className="prov-grid">
        {PROVIDERS.map((p) => (
          <span key={p.name} className="prov-chip" title={`Works with ${p.name}`}>
            {p.img
              ? <img src={p.img} alt="" width={26} height={26} />
              : p.mark}
            <span>{p.name}</span>
          </span>
        ))}
      </div>
      {busy && !result ? (
        <p className="muted" style={{ margin: '16px 0' }}>Generating your command…</p>
      ) : result ? (
        <>
          <div className="conn-steps">
            <div className="conn-step"><span className="conn-num">1</span><span>Copy the command below</span></div>
            <div className="conn-step"><span className="conn-num">2</span><span>Run it on {reconnect ? 'that server' : 'your server'} as root — takes about a minute</span></div>
            <div className="conn-step"><span className="conn-num">3</span><span>Come back here, it's linked and ready</span></div>
          </div>
          <div className="codebox mono" tabIndex={0}>{command}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={copy}><IconCopy />{copied ? 'Copied' : 'Copy'}</button>
            <span className="muted" style={{ fontSize: 12 }}>One-time token, expires in {result.expiresInMinutes} minutes.</span>
          </div>
          <div className="conn-get">
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', marginBottom: 8 }}>ONCE IT'S LINKED YOU GET</div>
            <ul>
              <li><b>Terminal</b> — a root shell in your browser</li>
              <li><b>Files</b> — browse and edit anything on disk</li>
              <li><b>Apps</b> — one-click installs (Docker, Node, n8n, …)</li>
              <li><b>Stats</b> — live CPU, RAM and disk, plus history</li>
              <li><b>Activity</b> — every action logged, kept 30 days</li>
              <li><b>MCP</b> — point Claude, Cursor or OpenCode at it and let AI do the work</li>
            </ul>
          </div>
          {!reconnect && <button className="btn-link" onClick={() => setResult(null)}>Add another</button>}
        </>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="srv-name">Server name</label>
            <input id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. legacy-site" maxLength={60} required autoFocus />
          </div>
          {error && !reconnect && <p className="error" role="alert">{error}</p>}
          <button className="btn p" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Generate command'}</button>
        </form>
      )}
      {error && reconnect && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

const STATUS_META: Record<string, { icon: string; color: string; bg: string }> = {
  running: { icon: '●', color: '#166534', bg: '#dcfce7' },
  provisioning: { icon: '◐', color: '#92400e', bg: '#fef3c7' },
  agent_offline: { icon: '○', color: '#991b1b', bg: '#fee2e2' },
  stopped: { icon: '●', color: '#52525b', bg: '#e4e4e7' },
  unknown: { icon: '?', color: '#52525b', bg: '#f4f4f5' },
};

function StatCard({ label, value, sub, accent, icon }: { label: string; value: string | number; sub?: string; accent: string; icon: React.ReactNode }) {
  return (
    <div className="srv-stat" style={{ ['--accent' as any]: accent }}>
      <div className="srv-stat-accent" />
      <div className="srv-stat-head">
        <span className="srv-stat-icon">{icon}</span>
        <span className="th">{label}</span>
      </div>
      <div className="srv-stat-value">{value}</div>
      {sub && <div className="srv-stat-sub muted">{sub}</div>}
    </div>
  );
}

function ServerRow({ s }: { s: Server }) {
  const [label, cls] = statusOf(s);
  const [src, srcCls] = sourceLabel(s);
  const secondary = secondaryStatus(s);
  const cpu = Math.round(s.cpu ?? 0);
  const meta = STATUS_META[s.status === 'running' && s.agentConnected === false ? 'agent_offline' : s.status === 'running' && s.status === 'running' ? 'running' : s.status] || STATUS_META.unknown;

  return (
    <a className="srv-row" href={`#/servers/${s.id}`}>
      <div className="srv-row-main">
        <span className="srv-status-dot" style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.bg}` }} aria-hidden="true" />
        <div className="srv-row-id">
          <div className="srv-name">{s.name}</div>
          <div className="srv-ip mono muted">{s.ip ?? 'no IP yet'}</div>
        </div>
      </div>
      <div className="srv-row-tags">
        <Badge cls={srcCls}>{src}</Badge>
        <Badge cls={cls}>{label}</Badge>
        {secondary && <span className="srv-secondary">{secondary[0]}</span>}
      </div>
      <div className="srv-row-specs muted">
        <span>{planLabel(s.plan)}</span>
        <span aria-hidden="true">·</span>
        <span>{s.os ?? '—'}</span>
      </div>
      <div className="srv-row-cpu">
        <div className="srv-cpu-bar"><div style={{ width: `${Math.min(100, cpu)}%`, background: cpu >= 80 ? 'var(--red)' : cpu >= 50 ? 'var(--warn-dot)' : 'var(--ok-dot)' }} /></div>
        <span className="srv-cpu-label muted">{s.cpu == null ? '—' : `${cpu}%`}</span>
        <IconChevronRight className="srv-chev" />
      </div>
    </a>
  );
}

export function Servers() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState<{ id: string; name: string } | null>(null);
  const offlineServers = servers?.filter((s) => !s.agentConnected) ?? [];

  const load = () => {
    api.servers().then(setServers).catch((e) => setError(e.message));
    api.activity().then(setActivity).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const count = (st: Server['status']) => servers?.filter((s) => s.status === st && !s.suspended_at).length ?? 0;
  const running = count('running');
  const provisioning = count('provisioning');
  const offline = count('agent_offline');
  const vcpu = servers?.reduce((n, s) => n + (s.plan.vcpu ?? 0), 0) ?? 0;
  const ram = servers?.reduce((n, s) => n + (s.plan.ramGb ?? 0), 0) ?? 0;
  const sources = [...new Set(servers?.map((s) => sourceLabel(s)[0].split(' · ')[0]))].sort();

  return (
    <>
      <div className="srv-hero">
        <div>
          <h1 style={{ margin: 0 }}>Servers</h1>
          <div className="muted" style={{ marginTop: 6, fontSize: 15 }}>
            {servers ? `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}${sources.length ? ' across ' + joinList(sources) : ''}` : 'Loading…'}
          </div>
        </div>
        <div className="srv-actions">
          <button className="btn p" onClick={() => setConnecting(true)}>Connect existing VPS</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {offlineServers.length > 0 && (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠️ No panel agent found — install it so this panel can manage these servers.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {offlineServers.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 120 }}>{s.name}</span>
                <button className="btn" onClick={() => setReconnecting({ id: s.id, name: s.name })}>Show install command</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {connecting && <ConnectModal onClose={() => setConnecting(false)} onCreated={load} />}
      {reconnecting && <ConnectModal onClose={() => setReconnecting(null)} onCreated={load} reconnect={reconnecting} />}

      <div className="srv-stats">
        <StatCard
          label="Running"
          value={running}
          sub={running > 0 ? 'healthy' : 'no active servers'}
          accent="#16a34a"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>}
        />
        <StatCard
          label="Provisioning"
          value={provisioning}
          sub={provisioning > 0 ? 'in progress' : 'none queued'}
          accent="#d97706"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>}
        />
        <StatCard
          label="Agent offline"
          value={offline}
          sub={offline > 0 ? 'needs attention' : 'all agents online'}
          accent="#dc2626"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
        />
        <StatCard
          label="Total vCPU / RAM"
          value={vcpu}
          sub={`/ ${ram} GB`}
          accent="#d50c2d"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></svg>}
        />
      </div>

      <div className="cols" style={{ alignItems: 'stretch' }}>
        <div className="main-col">
          <section className="card" style={{ overflow: 'hidden', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
              <h2 className="card-title" style={{ margin: 0 }}>Your servers</h2>
              <span className="muted" style={{ fontSize: 12 }}>{servers?.length ?? 0} total</span>
            </div>
            {servers === null && (
              <div style={{ padding: 20 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="srv-row" style={{ opacity: .6, pointerEvents: 'none' }}>
                    <div className="srv-row-main"><span className="srv-status-dot" style={{ background: 'var(--line)' }} /><div style={{ width: 120 }}><div className="skeleton skeleton-line" style={{ height: 14 }} /></div></div>
                    <div className="srv-row-tags"><div className="skeleton skeleton-line" style={{ width: 70, height: 20, borderRadius: 999 }} /></div>
                    <div className="srv-row-specs"><div className="skeleton skeleton-line" style={{ width: 120 }} /></div>
                    <div className="srv-row-cpu"><div className="skeleton skeleton-line" style={{ width: 80, height: 6 }} /></div>
                  </div>
                ))}
              </div>
            )}
            {servers?.map((s) => <ServerRow key={s.id} s={s} />)}
            {servers?.length === 0 && (
              <div className="empty-state" style={{ height: 'auto', padding: '48px 20px', margin: 0, border: 0 }}>
                <div style={{ fontSize: 48 }}>🖥️</div>
                <b style={{ fontSize: 17 }}>No servers yet</b>
                <span>Connect a VPS you already have to start managing it here.</span>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button className="btn p" onClick={() => setConnecting(true)}>Connect existing VPS</button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="side-col" style={{ flex: '0 0 320px' }}>
          <section className="card pad" aria-labelledby="act-h">
            <h2 id="act-h" className="card-title" style={{ marginBottom: 14 }}>Recent activity</h2>
            {activity.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
            <div className="srv-activity">
              {activity.map((a) => {
                const type = actorType(a.action, false);
                const { label, color, icon } = actorLabel(type, a.via);
                const device = parseDevice(a.user_agent);
                return (
                  <div key={a.id} className="srv-activity-item">
                    <span className="srv-activity-dot" style={{ background: color, boxShadow: `0 0 0 3px ${color}20` }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{activityLabel[a.action] ?? a.action}</div>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: color + '12', color, fontWeight: 700 }}>{icon} {label}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                        {a.server} · {ago(a.at)}
                        {a.ip_address && <span> · {a.ip_address}</span>}
                        {device.name !== 'Unknown' && <span> · {device.name}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card pad" style={{ background: 'linear-gradient(135deg, #18181b 0%, #2a0b12 100%)', color: '#fff', borderColor: 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>🤖</span>
              <b style={{ fontSize: 15 }}>MCP server</b>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.75)', lineHeight: 1.5 }}>
              Connect Claude Code, OpenCode or Cursor to manage servers with natural language.
            </p>
            <a href="#/agents" className="btn p" style={{ width: '100%', marginTop: 14, background: '#fff', color: 'var(--red-dark)', borderColor: '#fff' }}>Connect an AI client →</a>
          </section>
        </div>
      </div>
    </>
  );
}
