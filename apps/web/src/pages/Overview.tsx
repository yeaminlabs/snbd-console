import { useEffect, useState } from 'react';
import { api, type McpInfo, type Metrics, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';
import { IconActivity, IconBackup, IconBot, IconChevronRight, IconFile, IconRestart, IconServers, IconTerminal } from '../components/Icons';
import { ago, gb, uptimeLabel } from '../format';

const usageColor = (pct: number) => (pct >= 85 ? '#dc2626' : pct >= 60 ? '#d97706' : '#16a34a');

function Meter({ pct }: { pct: number }) {
  return (
    <div className="ov-meter" role="presentation">
      <div className="ov-meter-fill" style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: usageColor(pct) }} />
    </div>
  );
}

function StatCard({ icon, label, value, sub, pct }: { icon: React.ReactNode; label: string; value: string; sub?: string; pct?: number }) {
  return (
    <div className="ov-stat">
      <div className="ov-stat-head">
        <span className="ov-stat-icon" aria-hidden="true">{icon}</span>
        <span className="th">{label}</span>
      </div>
      <div className="ov-stat-value">{value}</div>
      {sub && <div className="ov-stat-sub muted">{sub}</div>}
      {pct != null && <Meter pct={pct} />}
    </div>
  );
}

const Kv = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="kv"><span className="muted">{k}</span><span>{children}</span></div>
);

export function Overview({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [mcp, setMcp] = useState<McpInfo | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.server(serverId).then(setServer).catch((e) => setError(e.message));
    api.metrics(serverId).then(setMetrics).catch(() => {});
  };
  useEffect(() => {
    setServer(null);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [serverId]);

  useEffect(() => { api.mcpConnections().then(setMcp).catch(() => {}); }, []);

  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwCopied, setPwCopied] = useState(false);

  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  async function removeFromPanel() {
    if (!confirm(`Remove ${server?.name ?? 'this server'} from the panel?\n\nThe machine keeps running and nothing is deleted on it. The panel stops monitoring it and its agent can no longer reconnect.`)) return;
    setRemoving(true); setRemoveError('');
    try {
      await api.removeServer(serverId);
      location.hash = '#/';
    } catch (e) {
      setRemoveError((e as Error).message);
    } finally {
      setRemoving(false);
    }
  }
  async function resetPassword() {
    if (!confirm('Set a new root password? The old one stops working immediately.')) return;
    setPwBusy(true); setPwError('');
    try { setNewPassword((await api.resetPassword(serverId)).password); } catch (e) { setPwError((e as Error).message); } finally { setPwBusy(false); }
  }
  async function copyPassword() {
    try { await navigator.clipboard.writeText(newPassword); setPwCopied(true); setTimeout(() => setPwCopied(false), 2000); } catch { /* stays selectable */ }
  }

  if (error) return <><p className="error">{error}</p><a href="#/">Back to servers</a></>;

  const latest = metrics?.latest;
  const points = metrics?.points ?? [];
  const peak = Math.max(10, ...points.map((p) => p.cpu ?? 0));
  const [upN, upU] = latest ? uptimeLabel(latest.uptime) : ['—', ''];
  const cpuPct = latest ? Math.round(latest.cpu) : 0;
  const ramPct = latest && latest.memTotal ? Math.round((latest.memUsed / latest.memTotal) * 100) : 0;
  const diskPct = latest && latest.diskTotal ? Math.round((latest.diskUsed / latest.diskTotal) * 100) : 0;
  const mcpLive = mcp?.connections.filter((c) => c.connected) ?? [];
  const mcpNames = [...new Set(mcpLive.map((c) => c.name))];
  const mcpName = mcpNames[0];
  const mcpHeadline = mcpNames.length === 0 ? 'Ask your AI about this server'
    : mcpNames.length === 1 ? `${mcpNames[0]} is connected`
      : mcpNames.length === 2 ? `${mcpNames[0]} and ${mcpNames[1]} are connected`
        : `${mcpNames.length} AI clients are connected`;
  const agentOn = !!server?.agentConnected;

  return (
    <>
      <ServerHeader server={server} tab="overview" onChanged={load} />

      {/* Live metric strip */}
      <section className="ov-strip" aria-label="Live metrics">
        <StatCard icon={<IconActivity />} label="CPU" value={latest && agentOn ? `${cpuPct}%` : '—'} sub={agentOn ? 'current load' : 'agent offline'} pct={agentOn ? cpuPct : undefined} />
        <StatCard icon={<IconServers />} label="RAM" value={latest && agentOn ? gb(latest.memUsed) : '—'} sub={latest && agentOn ? `of ${gb(latest.memTotal)} GB` : 'agent offline'} pct={agentOn ? ramPct : undefined} />
        <StatCard icon={<IconBackup />} label="Disk" value={latest && agentOn ? gb(latest.diskUsed) : '—'} sub={latest && agentOn ? `of ${gb(latest.diskTotal)} GB` : 'agent offline'} pct={agentOn ? diskPct : undefined} />
        <StatCard icon={<IconRestart />} label="Uptime" value={agentOn ? upN : '—'} sub={agentOn ? upU || 'running' : 'agent offline'} />
      </section>

      {/* MCP promo */}
      <section className="card mcp-promo" aria-labelledby="mcp-promo-h">
        <div className="mcp-promo-copy">
          <div className="mcp-promo-head">
            <span className="mcp-promo-badge">MCP server</span>
            {mcpLive.length > 0 && (
              <span className="mcp-promo-live"><span className="mcp-dot on" aria-hidden="true" />{mcpLive.length} live</span>
            )}
          </div>
          <h2 id="mcp-promo-h" className="card-title">{mcpHeadline}</h2>
          <p className="muted">
            {mcpName
              ? `Ask ${mcpName} “why is ${server?.name ?? 'this server'} slow?” or “restart nginx” — it can read live status and logs, run commands and manage services.`
              : 'Connect Claude Code, Claude or OpenCode once. It can read status, logs and files, run commands and restart services — revocable at any time.'}
          </p>
        </div>
        <div className="mcp-promo-cta">
          <a className="btn p" href="#/agents">{mcpName ? 'Manage MCP connections' : 'Connect an AI client'}</a>
          <div className="mcp-promo-foot muted">Full access · every action logged in Activity</div>
        </div>
      </section>

      <div className="cols">
        <div className="main-col">
          {/* CPU chart */}
          <section className="card pad-lg" aria-labelledby="cpu-h">
            <div className="ov-chart-head">
              <div>
                <h2 id="cpu-h" className="card-title" style={{ margin: 0 }}>CPU usage</h2>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Hourly average · last 24 hours</div>
              </div>
              {latest && agentOn && (
                <span className="ov-now" style={{ color: usageColor(cpuPct), borderColor: usageColor(cpuPct) + '44', background: usageColor(cpuPct) + '10' }}>
                  <span className="ov-now-dot" style={{ background: usageColor(cpuPct) }} />Now {cpuPct}%
                </span>
              )}
            </div>
            {!server ? (
              <>
                <div className="skeleton skeleton-chart" />
                <div className="statgrid">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-line" style={{ marginTop: 20 }} />)}
                </div>
              </>
            ) : !agentOn ? (
              <div className="empty-state">
                <IconBot />
                <b>Can't reach this server's agent</b>
                <span>Last heartbeat {ago(server.last_seen_at)}. Metrics resume once it reconnects.</span>
              </div>
            ) : (
              <>
                <div className="chart" role="img" aria-label={latest ? `Hourly average CPU over the last 24 hours, now ${cpuPct} percent` : 'No CPU data yet'}>
                  {points.map((p) => (
                    <div
                      key={p.t}
                      className={p.cpu == null ? 'gap' : ''}
                      style={{ height: p.cpu == null ? 3 : `${Math.max(3, (p.cpu / peak) * 100)}%` }}
                      title={`${new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${p.cpu == null ? 'no data' : Math.round(p.cpu) + '%'}`}
                    />
                  ))}
                </div>
                <div className="chart-axis muted"><span>24 h ago</span><span>Now</span></div>
              </>
            )}
          </section>

          {/* Quick actions */}
          <section className="card pad-lg" aria-labelledby="qa-h">
            <h2 id="qa-h" className="card-title">Quick actions</h2>
            <div className="ov-actions">
              <a className="ov-action" href={`#/servers/${serverId}/terminal`} aria-disabled={!agentOn}>
                <span className="ov-action-icon"><IconTerminal /></span>
                <span className="ov-action-body">
                  <b>Open terminal</b>
                  <span className="muted">Shell in your browser, straight to root</span>
                </span>
                <IconChevronRight className="ov-action-chev" />
              </a>
              <a className="ov-action" href={`#/servers/${serverId}/apps`} aria-disabled={!agentOn}>
                <span className="ov-action-icon"><IconBot /></span>
                <span className="ov-action-body">
                  <b>Install apps</b>
                  <span className="muted">Claude Code, Hermes, OpenClaw, Docker…</span>
                </span>
                <IconChevronRight className="ov-action-chev" />
              </a>
              <a className="ov-action" href={`#/servers/${serverId}/files`} aria-disabled={!agentOn}>
                <span className="ov-action-icon"><IconFile /></span>
                <span className="ov-action-body">
                  <b>Browse files</b>
                  <span className="muted">Upload, edit and download</span>
                </span>
                <IconChevronRight className="ov-action-chev" />
              </a>
            </div>
          </section>
        </div>

        <div className="side-col">
          {/* Root password */}
          <section className="card pad-lg" aria-labelledby="acc-h">
            <h2 id="acc-h" className="card-title">Root password</h2>
            <Kv k="Password"><span className="muted">Not stored, reset to get a new one</span></Kv>
            {newPassword ? (
              <div style={{ marginTop: 12 }}>
                <div className="codebox mono" tabIndex={0} style={{ fontSize: 14 }}>{newPassword}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={copyPassword}>{pwCopied ? 'Copied' : 'Copy'}</button>
                  <button className="link-btn" onClick={() => setNewPassword('')}>Hide</button>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Shown once. Save it now, the panel does not keep it.</div>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={resetPassword} disabled={!agentOn || pwBusy}>{pwBusy ? 'Resetting…' : 'Reset password'}</button>
                {pwError && <p className="error" role="alert" style={{ margin: '8px 0 0' }}>{pwError}</p>}
              </div>
            )}
          </section>

          {/* Panel agent */}
          <section className="card pad-lg" aria-labelledby="ag-h">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h2 id="ag-h" className="card-title" style={{ margin: 0 }}>Panel agent</h2>
              <span className={`ov-agent-state ${agentOn ? 'on' : 'off'}`}>
                <span className="ov-agent-dot" />{agentOn ? 'Online' : 'Offline'}
              </span>
            </div>
            <div style={{ marginTop: 4 }}>
              <Kv k="Version"><span className="mono">{server?.agent_version ?? '—'}</span></Kv>
              <Kv k="Last heartbeat">{ago(server?.last_seen_at)}</Kv>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Terminal, files and app installs run through this outbound connection.</div>
          </section>

          {server && (
            <section className="card pad-lg" aria-labelledby="rm-h">
              <h2 id="rm-h" className="card-title">Remove</h2>
              {server.managedBy === 'whmcs' ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Managed by WHMCS{server.whmcsServiceId ? ` (service #${server.whmcsServiceId})` : ''}. Suspend,
                  unsuspend or terminate it in WHMCS — the panel follows that status and never deletes a
                  billing-managed server.
                </p>
              ) : server.managedBy === 'imported' ? (
                <>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
                    Removing only unlinks this machine from the panel. It keeps running, and nothing is deleted on it.
                    To stop the agent on the machine as well, run{' '}
                    <span className="mono">systemctl disable --now snbd-agent</span> on it.
                  </p>
                  <button className="btn danger" onClick={removeFromPanel} disabled={removing}>
                    {removing ? 'Removing…' : 'Remove from panel'}
                  </button>
                  {removeError && <p className="error" role="alert" style={{ margin: '8px 0 0' }}>{removeError}</p>}
                </>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  This server was created by the panel's provider, so it can only be removed by terminating its service.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
