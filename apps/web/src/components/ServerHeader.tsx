import { useState } from 'react';
import { api, type Server } from '../api';
import { sourceLabel, statusOf } from '../format';

type Tab = 'overview' | 'terminal' | 'files' | 'apps' | 'reinstall';

function PowerMenu({ server, onChanged }: { server: Server; onChanged?: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function run(action: 'start' | 'stop' | 'reboot') {
    if (action === 'stop' && !confirm(`Shut down ${server.name}? It stays off until you start it again.`)) return;
    setBusy(action);
    setError('');
    try {
      await api.power(server.id, action);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="menu-wrap">
      <details className="menu">
        <summary className="btn" aria-label="Power actions">{busy ? 'Working…' : 'Power'}<span aria-hidden="true">▾</span></summary>
        <div className="menu-list" role="group" aria-label="Power actions">
          <button className="menu-item" onClick={() => run('start')} disabled={!!busy || server.status !== 'stopped'}>Start</button>
          <button className="menu-item" onClick={() => run('reboot')} disabled={!!busy || server.status === 'stopped'}>Reboot</button>
          <button className="menu-item" onClick={() => run('stop')} disabled={!!busy || server.status === 'stopped'}>Shut down</button>
        </div>
      </details>
      {error && <span className="error" role="alert" style={{ margin: 0 }}>{error}</span>}
    </div>
  );
}

export function ServerHeader({ server, tab, onChanged }: { server: Server | null; tab: Tab; onChanged?: () => void }) {
  const id = server?.id;
  const [status, statusCls] = server ? statusOf(server) : ['', 'off'];
  const [source, sourceCls] = server ? sourceLabel(server) : ['', 'info'];
  const tabs: [Tab, string, string][] = [
    ['overview', 'Overview', `#/servers/${id}`],
    ['terminal', 'Terminal', `#/servers/${id}/terminal`],
    ['files', 'Files', `#/servers/${id}/files`],
    ['apps', 'Apps', `#/servers/${id}/apps`],
    ['reinstall', 'Reinstall', `#/servers/${id}/reinstall`],
  ];
  return (
    <>
      <div className="muted" style={{ fontSize: 13 }}><a href="#/" style={{ color: 'var(--muted)' }}>Servers</a> / {server?.name ?? '…'}</div>
      <div className="head-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>{server?.name ?? '…'}</h1>
          {server && <><span className={`badge ${statusCls}`}>{status}</span><span className={`badge ${sourceCls}`}>{source}</span></>}
        </div>
        {tab === 'overview' && server && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <a className="btn" href={`#/servers/${id}/terminal`} aria-disabled={!server.agentConnected}>Open terminal</a>
            {server.capabilities?.power && !server.suspended_at && <PowerMenu server={server} onChanged={onChanged} />}
            {server.capabilities?.rebuild && !server.suspended_at && <a className="btn p" href={`#/servers/${id}/reinstall`}>Reinstall OS</a>}
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Server sections">
        {tabs.map(([key, label, href]) => (
          <a key={key} href={href} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}>{label}</a>
        ))}
        {['Backups', 'Settings'].map((l) => (
          <span key={l} className="tab-disabled" aria-disabled="true">{l}</span>
        ))}
      </nav>
    </>
  );
}
