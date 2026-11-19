import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Server, type Metrics } from '../api';
import { PROVIDERS } from '../components/ProviderLogos';
import { IconCopy, IconChevronRight, IconRestart, IconStop, IconSettings, IconServer, IconCpu, IconMemory, IconHdd, IconNetwork, IconDocker } from '../components/Icons';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { planLabel, sourceLabel, statusOf, secondaryStatus, ago } from '../format';

const activityLabel: Record<string, string> = {
  'server.import': 'Server added',
  'agent.connected': 'Agent connected',
  'terminal.open': 'Terminal opened',
};

function ConnectModal({ onClose, onCreated, reconnect }: { onClose: () => void; onCreated: () => void; reconnect?: { id: string; name: string } }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ serverId: string; token: string; expiresInMinutes: number; panelUrl: string } | null>(null);
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

  useEffect(() => {
    if (!reconnect) return;
    setBusy(true);
    setError('');
    api.reconnectAgent(reconnect.id)
      .then((r) => { setResult(r); onCreated(); })
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }, [reconnect?.id]);

  const command = result ? `${result.panelUrl || location.origin}/enroll/${result.token} | sh` : '';
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
            {p.img ? <img src={p.img} alt="" width={26} height={26} /> : p.mark}
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

const STATUS_META: Record<string, { color: string; bg: string }> = {
  running: { color: '#16a34a', bg: '#dcfce7' },
  provisioning: { color: '#d97706', bg: '#fef3c7' },
  agent_offline: { color: '#dc2626', bg: '#fdeced' },
  stopped: { color: '#52525b', bg: '#e4e4e7' },
  unknown: { color: '#52525b', bg: '#f4f4f5' },
};

function StatPill({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid var(--line)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: '#f4f5f7', color: 'var(--red-dark)' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="th" style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>{label}</div>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        {sub && <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ServerRow({ s, onSelect }: { s: Server; onSelect: (s: Server) => void }) {
  const [label, cls] = statusOf(s);
  const [src, srcCls] = sourceLabel(s);
  const secondary = secondaryStatus(s);
  const meta = STATUS_META[s.status === 'running' && s.agentConnected === false ? 'agent_offline' : s.status] || STATUS_META.unknown;
  return (
    <div className="dash-row" onClick={() => onSelect(s)} style={{ cursor: 'pointer' }}>
      <div className="dash-row-main">
        <span className="dash-dot" style={{ background: meta.color, boxShadow: `0 0 0 4px ${meta.bg}` }} aria-hidden="true" />
        <div className="dash-row-id">
          <div className="dash-name">{s.name}</div>
          {s.ip && <div className="dash-ip mono muted">{s.ip}</div>}
        </div>
      </div>
      <div className="dash-row-specs muted">
        {planLabel(s.plan) !== '—' && <span>{planLabel(s.plan)}</span>}
        {s.os && (<><span aria-hidden="true">·</span> <span>{s.os}</span></>)}
      </div>
      <div className="dash-row-tags">
        <Badge cls={srcCls}>{src}</Badge>
        <Badge cls={cls}>{label}</Badge>
        {secondary && <span className="dash-secondary">{secondary[0]}</span>}
      </div>
      <IconChevronRight className="dash-chev" />
    </div>
  );
}

function Sparkline({ points, label, value, sub, accent }: { points: number[] | null; label: string; value: string; sub?: string; accent: string }) {
  const max = points ? Math.max(...points, 1) : 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="th" style={{ fontSize: 10.5, marginBottom: 2 }}>{label}</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{value}</div>
          {sub && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent }}>{points ? Math.round(points[points.length - 1]) : 0}%</div>
      </div>
      <div className="spark" style={{ height: 70 }}>
        {points ? points.map((p, i) => (
          <div key={i} className="spark-bar" style={{ height: `${Math.max(3, (p / max) * 100)}%`, background: p >= max * 0.8 ? 'var(--red)' : p >= max * 0.5 ? 'var(--warn-dot)' : 'var(--ok-dot)' }} />
        )) : <div className="spark-empty" style={{ height: '100%', width: '100%', background: 'var(--line-2)', borderRadius: 2 }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        <span>Now</span><span>Peak</span>
      </div>
    </div>
  );
}

function Donut({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const circumference = 2 * Math.PI * 22;
  const offset = circumference * (1 - value / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <div className="th" style={{ fontSize: 10.5, marginBottom: 2 }}>{label}</div>
      <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r="22" fill="none" stroke="var(--line-2)" strokeWidth="8" />
        <circle cx="50" cy="50" r="22" fill="none" stroke="var(--red-dark)" strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .5s var(--ease)' }} />
      </svg>
      <div style={{ fontWeight: 800, fontSize: 26, color: 'var(--ink)' }}>{value}%</div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function skeletonRow() {
  return (
    <div className="dash-row" style={{ opacity: .5, pointerEvents: 'none' }}>
      <div className="dash-row-main"><span className="dash-dot" style={{ background: 'var(--line)' }} /><div className="dash-row-id"><div className="skeleton skeleton-line" style={{ width: 110 }} /></div></div>
      <div className="dash-row-specs muted"><div className="skeleton skeleton-line" style={{ width: 90 }} /></div>
      <div className="dash-row-tags"><div className="skeleton skeleton-line" style={{ width: 100, height: 18, borderRadius: 999 }} /></div>
      <IconChevronRight className="dash-chev" />
    </div>
  );
}

export function Dashboard() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [activity, setActivity] = useState<Array<{ id: number; action: string; at: string; server: string; ip_address: string | null; user_agent: string | null; via: string | null }>>([]);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Server | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tab, setTab] = useState<'overview' | 'processes' | 'firewall'>('overview');

  const load = () => {
    api.servers().then(setServers).catch((e) => setError(e.message));
    api.activity().then(setActivity).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selected && activeServers.length > 0) setSelected(activeServers[0]);
  }, [servers]);

  useEffect(() => {
    if (!selected) { setMetrics(null); return; }
    api.server(selected.id).then(setSelected).catch(() => {});
    api.metrics(selected.id).then(setMetrics).catch(() => setMetrics(null));
  }, [selected]);

  const activeServers = (servers ?? []).filter((s) => s.status === 'running' && !s.suspended_at);
  const shutdownServers = (servers ?? []).filter((s) => s.status === 'stopped' || s.status === 'agent_offline');
  const latest = metrics?.latest;
  const cpuPoints = metrics?.points.map((p) => p.cpu ?? 0).filter((p): p is number => p != null) || null;
  const ramPct = latest && latest.memTotal ? Math.round((latest.memUsed / latest.memTotal) * 100) : 0;
  const diskPct = latest && latest.diskTotal ? Math.round((latest.diskUsed / latest.diskTotal) * 100) : 0;

  function activeContent(): ReactNode {
    if (servers === null) {
      return (
        <div style={{ padding: 12 }}>
          {skeletonRow()}
          {skeletonRow()}
          {skeletonRow()}
        </div>
      );
    }
    if (activeServers.length === 0) {
      return <p className="muted" style={{ padding: 12, fontSize: 13 }}>No active servers.</p>;
    }
    return activeServers.map((s) => <ServerRow key={s.id} s={s} onSelect={setSelected} />);
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {connecting && <ConnectModal onClose={() => setConnecting(false)} onCreated={load} />}
      {reconnecting && <ConnectModal onClose={() => setReconnecting(null)} onCreated={load} reconnect={reconnecting} />}

      <div className="dash-cols">
        <div className="dash-left">
          <section className="dash-section">
            <div className="dash-section-head">
              <h2 className="dash-section-title">Active servers</h2>
              <span className="dash-section-count">{activeServers.length}</span>
            </div>
            {activeContent()}
          </section>

          <section className="dash-section">
            <div className="dash-section-head">
              <h2 className="dash-section-title">Shutdown servers</h2>
              <span className="dash-section-count">{shutdownServers.length}</span>
            </div>
            {shutdownServers.length === 0 ? (
              <p className="muted" style={{ padding: 12, fontSize: 13 }}>No shutdown servers.</p>
            ) : (
              shutdownServers.map((s) => <ServerRow key={s.id} s={s} onSelect={setSelected} />)
            )}
          </section>

          <div style={{ marginTop: 20 }}>
            <button className="btn p" style={{ width: '100%' }} onClick={() => setConnecting(true)}>+ ADD SERVER</button>
          </div>

          <section className="dash-section dash-activity" style={{ marginTop: 20 }}>
            <div className="dash-section-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h2 className="dash-section-title">Recent activity</h2>
            </div>
            <div className="dash-activity-list">
              {activity.length === 0 ? (
                <p className="muted" style={{ padding: 8, fontSize: 13 }}>Nothing yet.</p>
              ) : (
                activity.map((a) => (
                  <div key={a.id} className="dash-activity-item">
                    <span className="dash-activity-dot" style={{ background: '#16a34a' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{activityLabel[a.action] ?? a.action}</div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{a.server} · {ago(a.at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="dash-right">
          <div className="dash-top">
            <div className="dash-tabs">
              <button className={`dash-tab ${tab === 'overview' ? 'on' : ''}`} onClick={() => setTab('overview')}>Overview</button>
              <button className={`dash-tab ${tab === 'processes' ? 'on' : ''}`} onClick={() => setTab('processes')}>Processes <span className="dash-tab-count">5</span></button>
              <button className={`dash-tab ${tab === 'firewall' ? 'on' : ''}`} onClick={() => setTab('firewall')}>Firewall</button>
            </div>
            <button className="dash-settings" title="Settings"><IconSettings /></button>
          </div>
          {!selected ? (
            <div className="dash-empty">
              <div style={{ fontSize: 40, marginBottom: 8 }}>🖥️</div>
              <b style={{ fontSize: 15, color: 'var(--ink-2)' }}>Select a server</b>
              <span className="muted" style={{ fontSize: 12.5, marginTop: 4, maxWidth: 300 }}>Pick a server on the left to view its overview, metrics and controls.</span>
            </div>
          ) : (
            <>
              <div className="dash-info">
                <div className="dash-info-grid">
                  <StatPill label="OS" value={selected.os ?? '—'} sub="Operating system" icon={<IconServer />} />
                  <StatPill label="CPU" value={selected.plan.vcpu ?? '—'} sub={selected.plan.vcpu ? `${selected.plan.vcpu} core${selected.plan.vcpu > 1 ? 's' : ''}` : ''} icon={<IconCpu />} />
                  <StatPill label="Memory" value={selected.plan.ramGb != null ? `${selected.plan.ramGb} GB` : '—'} sub="RAM" icon={<IconMemory />} />
                  <StatPill label="Storage" value={selected.plan.diskGb != null ? `${selected.plan.diskGb} GB` : '—'} sub="Disk" icon={<IconHdd />} />
                  <StatPill label="IP" value={selected.ip ?? 'no IP'} sub={selected.ip ? 'Public address' : 'Not assigned'} icon={<IconNetwork />} />
                </div>
                <div className="dash-info-actions" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={() => { api.power(selected.id, 'stop').then(() => load()); }}>STOP</button>
                  <button className="btn p" style={{ flex: 1 }} onClick={() => { api.power(selected.id, 'reboot').then(() => load()); }}>RESTART</button>
                  <button className="icon-btn" title="More" style={{ padding: 0, width: 34 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg></button>
                </div>
              </div>

              <div className="dash-charts">
                <Sparkline points={cpuPoints} label="CPU usage" value={latest?.cpu != null ? `${Math.round(latest.cpu)}%` : '—'} sub="Live load" accent="var(--red-dark)" />
                <Sparkline points={latest ? [latest.memUsed / Math.max(latest.memTotal, 1) * 100] : null} label="RAM usage" value={latest?.memTotal != null ? `${gb(latest.memUsed)} / ${gb(latest.memTotal)} GB` : '—'} sub={`${ramPct}% used`} accent="var(--red-dark)" />
                <div className="dash-bandwidth">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="th" style={{ fontSize: 10.5, marginBottom: 2 }}>Bandwidth</div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{latest ? '5.2 Mpps' : '—'}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red-dark)' }}>{latest ? '2.134 Mbps' : '—'}</div>
                  </div>
                  <div className="spark" style={{ height: 70 }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
                      <div key={i} className="spark-bar" style={{ height: `${40 + Math.sin(i / 2) * 40}%`, background: 'var(--red-dark)' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                    <span>Download</span><span>Upload</span>
                  </div>
                </div>
                <Donut value={diskPct} label="Traffic usage" sub={`${diskPct}% · 10 B / 35 B`} />
              </div>

              <section className="dash-section" style={{ marginTop: 16 }}>
                <div className="dash-section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 className="dash-section-title">Docker containers</h2>
                  <span className="dash-section-count" style={{ color: 'var(--muted)' }}>{tab === 'overview' ? '2' : '—'}</span>
                </div>
                <div className="dash-container-list">
                  {[
                    { name: 'chatgpt_telegram', id: 23752, cpu: '8%', ram: '5%' },
                    { name: 'vpn_server_netherlands', id: 247652, cpu: '12%', ram: '3%' },
                  ].map((c) => (
                    <div key={c.name} className="dash-container-row">
                      <div className="dash-container-main">
                        <div className="dash-container-name">{c.name}</div>
                        <div className="dash-container-id mono muted">{c.id}</div>
                      </div>
                      <div className="dash-container-stats">
                        <div><div className="th" style={{ fontSize: 10, marginBottom: 1 }}>CPU</div><div style={{ fontWeight: 700, fontSize: 12 }}>{c.cpu}</div></div>
                        <div><div className="th" style={{ fontSize: 10, marginBottom: 1 }}>RAM</div><div style={{ fontWeight: 700, fontSize: 12 }}>{c.ram}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>Container metrics require the panel agent with Docker access on this server.</div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function gb(bytes: number) { return (bytes / 1024 ** 3).toFixed(1); }
