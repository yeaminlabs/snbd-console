import { useState } from 'react';
import { api, type Server } from '../api';
import { Badge } from './Badge';
import { IconCheckCircle, IconCopy } from './Icons';
import { ago, planLabel, sourceLabel, statusOf, secondaryStatus } from '../format';

type Tab = 'overview' | 'terminal' | 'files' | 'apps' | 'reinstall' | 'ai';

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copy-field">
      <span className="mono">{value}</span>
      <button
        type="button"
        className="copy-mini"
        aria-label={done ? 'Copied' : `Copy ${value}`}
        onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* stays selectable */ } }}
      >
        {done ? '✓' : <IconCopy />}
      </button>
    </span>
  );
}

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="summary-item">
      <div className="th">{label}</div>
      <div className="summary-value">{children}</div>
    </div>
  );
}

function CheckRow({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={`check-row ${ok ? 'ok' : 'off'}`}>
      {ok ? <IconCheckCircle /> : <span className="check-dash" aria-hidden="true" />}
      {ok ? okText : badText}
    </span>
  );
}

/** The at-a-glance card every tab sits under — one place for what a Lightsail-style instance page leads with. */
function ServerSummary({ server }: { server: Server }) {
  const letter = (server.os ?? server.name).trim().charAt(0).toUpperCase() || '?';
  const [, srcCls] = sourceLabel(server);
  return (
    <section className="card pad-lg summary-card" aria-labelledby="sum-h">
      <div className="summary-head">
        <span className="dot">{letter}</span>
        <h2 id="sum-h" className="card-title">{server.os ?? 'Unknown system'}</h2>
      </div>
      <div className="summary-grid">
        <div className="summary-col">
          <SummaryItem label="Plan">{planLabel(server.plan)}</SummaryItem>
          <SummaryItem label="Source"><Badge cls={srcCls}>{sourceLabel(server)[0]}</Badge></SummaryItem>
          <SummaryItem label="Added">{new Date(server.created_at).toLocaleDateString()}</SummaryItem>
        </div>
        <div className="summary-col">
          <SummaryItem label="IPv4 address">{server.ip ? <CopyField value={server.ip} /> : <span className="muted">—</span>}</SummaryItem>
          <SummaryItem label="Connect">{server.ip ? <CopyField value={`ssh root@${server.ip}`} /> : <span className="muted">Not available yet</span>}</SummaryItem>
        </div>
        <div className="summary-col">
          <SummaryItem label="Instance state"><CheckRow ok={server.status === 'running' && !server.suspended_at} okText={statusOf(server)[0]} badText={statusOf(server)[0]} /></SummaryItem>
          <SummaryItem label="Panel agent"><CheckRow ok={server.agentConnected} okText="Connected" badText={`Offline · last seen ${ago(server.last_seen_at)}`} /></SummaryItem>
        </div>
      </div>
    </section>
  );
}

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
  const secondary = server ? secondaryStatus(server) : null;
  const tabs: [Tab, string, string][] = [
    ['overview', 'Overview', `#/servers/${id}`],
    ['terminal', 'Terminal', `#/servers/${id}/terminal`],
    ['files', 'Files', `#/servers/${id}/files`],
    ['apps', 'Apps', `#/servers/${id}/apps`],
    ['ai', 'AI Assistant', `#/servers/${id}/ai`],
    ['reinstall', 'Reinstall', `#/servers/${id}/reinstall`],
  ];
  return (
    <>
      <div className="muted" style={{ fontSize: 13 }}><a href="#/" style={{ color: 'var(--muted)' }}>Servers</a> / {server?.name ?? '…'}</div>
      <div className="head-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>{server?.name ?? '…'}</h1>
          {server && <><Badge cls={statusCls}>{status}</Badge><Badge cls={sourceCls}>{source}</Badge>{secondary && <Badge cls={secondary[1]}>{secondary[0]}</Badge>}</>}
        </div>
        {tab === 'overview' && server && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {server.capabilities?.rebuild && !server.suspended_at && <a className="btn danger" href={`#/servers/${id}/reinstall`}>Reinstall OS</a>}
            {server.capabilities?.power && !server.suspended_at && <PowerMenu server={server} onChanged={onChanged} />}
            <a className="btn p" href={`#/servers/${id}/terminal`} aria-disabled={!server.agentConnected}>Open terminal</a>
          </div>
        )}
      </div>
      {server && <ServerSummary server={server} />}
      <nav className="tabs" aria-label="Server sections">
        {tabs.map(([key, label, href]) => (
          <a key={key} href={href} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}>{label}</a>
        ))}
        {['Backups', 'Settings'].map((l) => (
          <span key={l} className="tab-disabled" aria-disabled="true" title={`${l} — coming soon`}>{l}<span className="soon">Soon</span></span>
        ))}
      </nav>
    </>
  );
}
