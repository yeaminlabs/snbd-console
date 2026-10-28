import { useEffect, useState } from 'react';
import { api, type AuditItem, type Server } from '../api';
import { actorLabel, actorType, ago, parseDevice } from '../format';

const fmtBytes = (n: unknown) =>
  typeof n !== 'number' ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const label: Record<string, (m: Record<string, any>) => string> = {
  'server.created': () => 'Server created from your order',
  'server.provisioned': () => 'Server provisioned',
  'server.import': () => 'Server added with the connect command',
  'server.suspended': () => 'Server suspended',
  'server.unsuspended': () => 'Server unsuspended',
  'server.resized': () => 'Plan changed',
  'server.terminated': () => 'Server terminated',
  'server.reinstall': (m) => `Reinstall started${m.os ? ` (${m.os})` : ''}`,
  'reinstall.failed': () => 'Reinstall was refused by the provider',
  'provision.failed': () => 'Provisioning failed',
  'agent.connected': () => 'Agent connected',
  'agent.disconnected': () => 'Agent disconnected',
  'agent.key_rotation_sent': () => 'Agent key rotation started',
  'agent.key_rotated': () => 'Agent key rotated',
  'terminal.open': () => 'Terminal opened',
  'terminal.close': () => 'Terminal closed',
  'file.write': (m) => `File saved: ${m.path}${m.bytes !== undefined ? ` · ${fmtBytes(m.bytes)}` : ''}`,
  'file.upload': (m) => `File uploaded: ${m.path}${m.bytes !== undefined ? ` · ${fmtBytes(m.bytes)}` : ''}`,
  'file.download': (m) => `File downloaded: ${m.path}`,
  'file.mkdir': (m) => `Folder created: ${m.path}`,
  'file.rename': (m) => `Renamed ${m.from} to ${m.to}`,
  'file.delete': (m) => `Deleted ${m.path}`,
  'app.install': (m) => `Install started: ${m.app}`,
  'app.cancel': () => 'Install cancelled',
  'password.reset': (m) => `Password reset for ${m.user ?? 'root'}`,
  'ssh.key.create': (m) => `SSH key generated: ${m.name}`,
  'ssh.key.import': (m) => `SSH key imported: ${m.name}`,
  'ssh.key.delete': (m) => `SSH key deleted: ${m.name}`,
  'ssh.key.install': (m) => `SSH key installed: ${m.keyName}`,
  'ssh.key.uninstall': (m) => `SSH key removed from server: ${m.keyName}`,
  'power.start': () => 'Power on', 'power.stop': () => 'Shut down', 'power.reboot': () => 'Reboot',
  'login': () => 'Signed in to the panel',
  'token.create': (m) => `API token created: ${m.name}${m.scope ? ` (${m.scope})` : ''}`,
  'token.revoke': (m) => `API token revoked: ${m.name}`,
  'oauth.approve': (m) => `Approved AI app: ${m.app}`,
  'mcp.list_servers': () => 'Listed the servers',
  'mcp.server_status': () => 'Read the server status',
  'mcp.get_public_ip': () => 'Looked up the public IP',
  'mcp.view_logs': (m) => `Read logs (${m.source ?? 'system'}${m.lines ? ` · ${m.lines} lines` : ''})${m.error ? ' · failed' : ''}`,
  'mcp.list_files': (m) => `Listed ${m.path ?? 'a directory'}${m.count !== undefined ? ` · ${m.count} items` : ''}${m.error ? ' · failed' : ''}`,
  'mcp.read_file': (m) => `Read ${m.path ?? 'a file'}${m.error ? ' · failed' : ''}`,
  'mcp.run_command': (m) => (m.error ? 'Command failed' : 'Ran a command'),
  'mcp.write_file': (m) => `Wrote ${m.path ?? 'a file'}${m.bytes !== undefined ? ` · ${fmtBytes(m.bytes)}` : ''}${m.error ? ' · failed' : ''}`,
  'mcp.restart_service': (m) => `Ran systemctl ${m.action ?? 'restart'} on ${m.service ?? 'a service'}`,
  'alert.offline': (m) => `Alert sent: agent offline for ${m.minutes} min`,
  'alert.recovered': () => 'Recovery notice sent',
};

function ActorBadge({ type, via }: { type: ReturnType<typeof actorType>; via?: string | null }) {
  const { label, color, icon } = actorLabel(type, via);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: color + '12', border: `1px solid ${color}33` }}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

function ActivityCard({ a }: { a: AuditItem }) {
  const type = actorType(a.action, a.system);
  const device = parseDevice(a.user_agent);
  const what = (label[a.action] ?? (() => a.action))(a.meta ?? {});
  const when = new Date(a.at);
  return (
    <div className="act-card">
      <div className="act-card-top">
        <ActorBadge type={type} via={a.via} />
        <span className="muted" title={when.toLocaleString()}>{ago(a.at)}</span>
      </div>
      <div className="act-card-body">
        <div className="act-what">{what}</div>
        <div className="act-server muted">
          {a.serverId ? <a href={`#/servers/${a.serverId}`}>{a.server}</a> : <span>{a.server}</span>}
        </div>
        {a.action === 'mcp.run_command' && (a.meta?.command || a.meta?.error) && (
          <div className="act-cmd-wrap">
            {a.meta.command && <pre className="act-cmd mono">{String(a.meta.command)}</pre>}
            <div className="act-chips">
              {a.meta?.exitCode !== undefined && (
                <span className={`act-exit ${a.meta.exitCode === 0 ? 'ok' : 'bad'}`}>exit {String(a.meta.exitCode)}</span>
              )}
              {a.meta?.error && <span className="act-exit bad">{String(a.meta.error)}</span>}
            </div>
          </div>
        )}
        {a.action !== 'mcp.run_command' && a.meta?.error && (
          <div className="act-err">{String(a.meta.error)}</div>
        )}
      </div>
      <div className="act-meta">
        {a.ip_address && (
          <span className="act-meta-item" title="IP address">
            <span>🌐</span>
            {a.ip_address}
            {a.location && a.location !== 'Unknown' && <span className="muted" style={{ marginLeft: 4 }}>({a.location})</span>}
          </span>
        )}
        {device.name !== 'Unknown' && (
          <span className="act-meta-item" title="Device / browser">
            <span>💻</span>
            {device.name}
          </span>
        )}
      </div>
    </div>
  );
}

export function Activity() {
  const [servers, setServers] = useState<Server[]>([]);
  const [server, setServer] = useState('');
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.servers().then(setServers).catch(() => {}); }, []);
  useEffect(() => {
    setItems(null); setNext(null); setError('');
    api.audit(server, null).then((r) => { setItems(r.items); setNext(r.next); }).catch((e) => setError(e.message));
  }, [server]);

  async function more() {
    setBusy(true);
    try { const r = await api.audit(server, next); setItems((i) => [...(i ?? []), ...r.items]); setNext(r.next); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Activity</h1>
          <div className="muted" style={{ marginTop: 4 }}>Every action on your servers, with IP, device and actor.</div>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 220 }}>
          <label htmlFor="srv-filter">Server</label>
          <select id="srv-filter" className="select" value={server} onChange={(e) => setServer(e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="act-legend">
        <span className="muted">Legend:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a' }} />Human</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#8b5cf6' }} />AI assistant</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#06b6d4' }} />Panel agent</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#71717a' }} />System</span>
      </div>

      <div className="act-grid">
        {items?.map((a) => <ActivityCard key={a.id} a={a} />)}
      </div>
      {items && items.length === 0 && <p className="muted" style={{ padding: 32, textAlign: 'center' }}>Nothing yet.</p>}
      {!items && !error && <p className="muted" style={{ padding: 32, textAlign: 'center' }}>Loading…</p>}
      {next !== null && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <button className="btn p" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button>
        </div>
      )}
    </>
  );
}
