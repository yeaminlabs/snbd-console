import { useEffect, useState } from 'react';
import { api, type AuditItem, type Server } from '../api';

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
  'file.write': (m) => `File saved: ${m.path}`,
  'file.upload': (m) => `File uploaded: ${m.path}`,
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
  'mcp.list_servers': () => 'Agent listed the servers',
  'mcp.server_status': () => 'Agent read the server status',
  'mcp.get_public_ip': () => 'Agent looked up the public IP',
  'mcp.view_logs': (m) => `Agent read logs (${m.source ?? 'system'})`,
  'mcp.list_files': (m) => `Agent listed ${m.path ?? 'a directory'}`,
  'mcp.read_file': (m) => `Agent read ${m.path ?? 'a file'}`,
  'mcp.run_command': () => 'Agent ran a command',
  'mcp.write_file': (m) => `Agent wrote ${m.path ?? 'a file'}`,
  'mcp.restart_service': (m) => `Agent ran systemctl ${m.action ?? 'restart'} on ${m.service ?? 'a service'}`,
  'alert.offline': (m) => `Alert sent: agent offline for ${m.minutes} min`,
  'alert.recovered': () => 'Recovery notice sent',
};

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
        <div><h1>Activity</h1><div className="muted" style={{ marginTop: 4 }}>Everything done on your servers, newest first.</div></div>
        <div className="field" style={{ margin: 0, minWidth: 220 }}>
          <label htmlFor="srv-filter">Server</label>
          <select id="srv-filter" className="select" value={server} onChange={(e) => setServer(e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card" style={{ marginTop: 24, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div className="ar th" style={{ borderTop: 0 }}><span>When</span><span>Server</span><span>What</span><span>By</span></div>
            {items?.map((a) => (
              <div className="ar" key={a.id}>
                <span className="muted" title={new Date(a.at).toLocaleString()}>{new Date(a.at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {a.serverId ? <a href={`#/servers/${a.serverId}`} style={{ color: 'var(--ink)', fontWeight: 500, textDecoration: 'none' }}>{a.server}</a> : <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{a.server}</span>}
                <span style={{ wordBreak: 'break-word' }}>{(label[a.action] ?? (() => a.action))(a.meta ?? {})}</span>
                <span className="muted">{a.via ? `Agent: ${a.via}` : a.system ? 'System' : 'You'}</span>
              </div>
            ))}
          </div>
        </div>
        {items && items.length === 0 && <p className="muted" style={{ padding: 20, margin: 0 }}>Nothing yet.</p>}
        {!items && !error && <p className="muted" style={{ padding: 20, margin: 0 }}>Loading…</p>}
        {next !== null && <div style={{ padding: 16, borderTop: '1px solid #f4f4f5' }}><button className="btn" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button></div>}
      </div>
    </>
  );
}
