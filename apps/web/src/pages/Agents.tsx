import { useEffect, useState, type FormEvent } from 'react';
import { api, type McpConnection, type McpInfo, type Server, type TokenInfo } from '../api';
import { Badge } from '../components/Badge';
import { IconActivity, IconBot, IconFile, IconRestart, IconServers, IconTerminal } from '../components/Icons';
import { ago } from '../format';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* the text stays selectable */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <div className="mcp-steps">{children}</div>;
}

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="mcp-snippet">
      <pre className="codebox mono" tabIndex={0}>{code}</pre>
      <Copy text={code} label={label} />
    </div>
  );
}

const Ticker = ({ on }: { on: boolean }) => <span className={`mcp-dot ${on ? 'on' : ''}`} aria-hidden="true" />;

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function ConnectionCard({ c, onDisconnect }: { c: McpConnection; onDisconnect: (c: McpConnection) => void }) {
  const machine = [c.os, c.ip].filter(Boolean).join(' · ');
  return (
    <article className="mcp-conn" data-kind={c.clientKind}>
      <div className="mcp-conn-top">
        <span className="mcp-avatar" aria-hidden="true">{(c.name || '?').slice(0, 1).toUpperCase()}</span>
        <div className="mcp-conn-id">
          <div className="mcp-conn-name">
            {c.name}
            {c.version && <span className="muted" style={{ fontWeight: 400 }}> v{c.version}</span>}
            <Badge cls={c.connected ? 'ok' : 'off'}>{c.connected ? 'Connected' : c.lastSeenAt ? 'Idle' : 'Not used yet'}</Badge>
          </div>
          <div className="muted mcp-conn-machine">
            {c.lastSeenAt
              ? <>{machine || 'Machine unknown'}<span aria-hidden="true"> · </span>last used {ago(c.lastSeenAt)}</>
              : 'No request yet — machine and address appear after the first connection.'}
          </div>
        </div>
        <button className="link-btn danger" onClick={() => onDisconnect(c)} aria-label={`Disconnect ${c.name}`}>Disconnect</button>
      </div>
      <div className="mcp-conn-meta">
        <span className="mcp-chip mcp-chip-full">Full access</span>
        <span className="mcp-chip">{c.servers ? (c.servers.length === 1 ? c.servers[0] : `${c.servers.length} servers`) : 'All servers'}</span>
        {c.kind === 'connector' && <span className="mcp-chip muted">Approved app</span>}
        {c.expiresAt && <span className="mcp-chip muted">Access ends {when(c.expiresAt)}</span>}
      </div>
    </article>
  );
}

export function Agents() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<string>('90');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const load = () => {
    api.mcpConnections().then(setInfo).catch((e) => setError(e.message));
    api.tokens().then(setTokens).catch(() => {});
  };
  useEffect(() => {
    load();
    api.servers().then(setServers).catch(() => {});
    const t = setInterval(() => api.mcpConnections().then(setInfo).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.createToken(name.trim(), only ? picked : null, days === 'never' ? null : Number(days));
      setFresh({ name: name.trim(), token: r.token });
      setName(''); setOnly(false); setPicked([]);
      load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function revoke(t: TokenInfo) {
    if (!confirm(t.kind === 'connector' ? `Disconnect "${t.name}"? It loses access immediately and must be approved again to reconnect.` : `Revoke "${t.name}"? Any AI client using it stops working immediately.`)) return;
    try { await api.revokeToken(t.id); if (fresh?.name === t.name) setFresh(null); load(); } catch (err) { setError((err as Error).message); }
  }
  const disconnect = (c: McpConnection) => revoke({ kind: c.kind, id: c.id, name: c.name, prefix: '', scope: c.scope, serverIds: c.servers, serverNames: c.serverNames, expiresAt: c.expiresAt, lastUsedAt: c.lastSeenAt, createdAt: c.createdAt });

  const url = info?.url ?? `${location.origin}/mcp`;
  const connections = info?.connections ?? [];
  const connected = connections.filter((c) => c.connected);
  const claudeCmd = `claude mcp add --transport http snbd ${url}`;
  const opencodeCfg = JSON.stringify({ mcp: { snbd: { type: 'remote', url } } }, null, 2);
  const genericCfg = JSON.stringify({ mcpServers: { snbd: { type: 'http', url } } }, null, 2);
  const freshCmd = fresh ? `claude mcp add --transport http snbd ${url} --header "Authorization: Bearer ${fresh.token}"` : '';

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>MCP server</h1>
          <div className="muted" style={{ marginTop: 4, maxWidth: 640 }}>
            Connect once and ask it to check status, read logs — or restart a service and fix a config.
            Nothing else to install.
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="mcp-hero" aria-labelledby="mcp-hero-h">
        <div className="mcp-hero-copy">
          <span className="mcp-eyebrow">MCP server</span>
          <h2 id="mcp-hero-h">Your servers, inside your AI assistant.</h2>
          <p>
            One address gives Claude Code, Claude, OpenCode, Cursor and VS Code full access to your servers:
            status, metrics, logs and files — and the power to run commands, write files and restart services.
            Every request lands in <a href="#/activity">Activity</a>.
          </p>
          <div className="mcp-url">
            <code className="mono">{url}</code>
            <Copy text={url} label="Copy address" />
          </div>
          <div className="mcp-promise">
            <span>Works with</span>
            <b>Claude Code</b><b>Claude</b><b>OpenCode</b><b>Cursor</b><b>VS Code</b>
          </div>
          <div className="mcp-access-note">
            <b>Full access.</b> An approved client can read and change your servers, limited only to the servers you pick.
          </div>
        </div>
        <div className="mcp-hero-side">
          <div className="mcp-live">
            <Ticker on={connected.length > 0} />
            <span>{connected.length ? `${connected.length} connected now` : 'No client connected yet'}</span>
          </div>
          {connected.length > 0 ? (
            <ul className="mcp-live-list">
              {connected.map((c) => (
                <li key={c.id}>
                  <b>{c.name}</b>
                  <span className="muted">{c.os ?? 'machine unknown'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mcp-live-empty">
              <p>Add the address above to your AI client. It asks you to sign in and approve — about 30 seconds.</p>
              <button className="btn p" onClick={() => jump('connect')}>Show me how</button>
            </div>
          )}
          {connections.length > 0 && (
            <div className="mcp-live-foot muted">
              {connections.length} approved connection{connections.length === 1 ? '' : 's'} ·{' '}
              <button className="link-btn mcp-link" onClick={() => jump('connections')}>manage</button>
            </div>
          )}
          <div className="mcp-try">
            <span className="mcp-try-label">Try asking</span>
            <p>“Restart nginx on vps-1, then check it is healthy.”</p>
          </div>
        </div>
      </section>

      <section className="mcp-caps" aria-label="What the assistant can do">
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconServers /></span>
          <div><b>See every server</b><div className="muted">Status, plan, IP and agent health — without opening the panel.</div></div>
        </div>
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconActivity /></span>
          <div><b>Read the logs</b><div className="muted">“Why did the deploy fail?” — system journal, systemd units and Docker.</div></div>
        </div>
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconFile /></span>
          <div><b>Read files</b><div className="muted">Configs and scripts, up to 128 KB per read, from any directory.</div></div>
        </div>
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconTerminal /></span>
          <div><b>Run commands</b><div className="muted">Shell on the server, with stdout, stderr and the exit code back in the chat.</div></div>
        </div>
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconRestart /></span>
          <div><b>Restart services</b><div className="muted">Start, stop or restart systemd units, with the result read back.</div></div>
        </div>
        <div className="mcp-cap">
          <span className="mcp-cap-icon"><IconBot /></span>
          <div><b>Ask in plain English</b><div className="muted">“Is vps-1 healthy?” gets an answer from real metrics, not guesses.</div></div>
        </div>
      </section>

      <section className="card pad-lg" style={{ marginTop: 24 }} aria-labelledby="connect-h" id="connect">
        <h2 id="connect-h" className="card-title">Connect your client</h2>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Paste the address, sign in on the approval page, and pick which servers it may control. No token copy-pasting needed.
          Connections have full access to those servers, so only approve clients you trust. Disconnecting takes effect instantly.
        </p>
        <Steps>
          <div className="mcp-step">
            <div className="mcp-step-head"><span className="mcp-step-n">1</span><b>Claude Code</b><span className="muted">terminal</span></div>
            <Snippet code={claudeCmd} label="Copy command" />
            <p className="muted mcp-note">Run it once, then <span className="mono">/mcp</span> inside Claude Code to approve the sign-in.</p>
          </div>
          <div className="mcp-step">
            <div className="mcp-step-head"><span className="mcp-step-n">2</span><b>Claude app</b><span className="muted">web &amp; desktop</span></div>
            <p className="muted mcp-note" style={{ marginTop: 0 }}>Settings → Connectors → Add custom connector, then paste the address above. Sign in and approve on the page that opens.</p>
          </div>
          <div className="mcp-step">
            <div className="mcp-step-head"><span className="mcp-step-n">3</span><b>OpenCode</b><span className="muted">opencode.json</span></div>
            <Snippet code={opencodeCfg} label="Copy config" />
          </div>
          <div className="mcp-step">
            <div className="mcp-step-head"><span className="mcp-step-n">4</span><b>Cursor, VS Code and others</b><span className="muted">MCP settings</span></div>
            <Snippet code={genericCfg} label="Copy settings" />
          </div>
        </Steps>
      </section>

      <section className="card pad-lg" style={{ marginTop: 24 }} aria-labelledby="connections-h" id="connections">
        <div className="mcp-section-head">
          <div>
            <h2 id="connections-h" className="card-title">Connections</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>Who is attached right now, and from which machine.</p>
          </div>
          <span className="mcp-chip">{connected.length} live · {connections.length} approved</span>
        </div>
        {connections.length === 0 && (
          <div className="mcp-empty">
            <b>Nothing connected yet.</b>
            <p className="muted">Connect Claude Code, OpenCode or the Claude app above — it will appear here with its machine and last activity.</p>
          </div>
        )}
        <div className="mcp-conns">
          {connections.map((c) => <ConnectionCard key={c.id} c={c} onDisconnect={disconnect} />)}
        </div>
        <p className="muted mcp-legend">A client counts as connected while it has made a request in the last 5 minutes. “Idle” means approved but quiet.</p>
      </section>

      {fresh && (
        <section className="card pad-lg" style={{ marginTop: 24, boxShadow: 'inset 0 0 0 2px var(--red), 0 1px 3px rgba(0,0,0,.1)' }} aria-labelledby="new-h">
          <h2 id="new-h" className="card-title">Token created: {fresh.name}</h2>
          <p className="muted" style={{ margin: '8px 0 12px' }}><b style={{ color: 'var(--ink)' }}>Copy it now.</b> It is shown only once; the panel keeps just a fingerprint.</p>
          <div className="codebox mono" tabIndex={0}>{fresh.token}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><Copy text={fresh.token} label="Copy token" /></div>
          <h3 style={{ fontSize: 14, margin: '20px 0 6px' }}>Claude Code with this token</h3>
          <div className="codebox mono" tabIndex={0}>{freshCmd}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><Copy text={freshCmd} label="Copy command" /><button className="link-btn" onClick={() => setFresh(null)}>I have saved it</button></div>
        </section>
      )}

      <details className="card pad-lg mcp-advanced" style={{ marginTop: 24 }}>
        <summary>
          <span><b>Advanced: tokens</b> <span className="muted">— for clients that cannot sign in with OAuth; full access</span></span>
          <span className="mcp-chip">{tokens?.length ?? 0}</span>
        </summary>
        <div className="cols" style={{ marginTop: 16 }}>
          <section className="grow-lg" aria-labelledby="tok-h">
            <h2 id="tok-h" className="card-title">Your tokens</h2>
            {tokens?.length === 0 && <p className="muted" style={{ margin: '12px 0 0' }}>No tokens. Create one on the right.</p>}
            {tokens?.map((t) => (
              <div key={t.id} style={{ padding: '14px 0', borderTop: '1px solid #f4f4f5', marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <b>{t.name}</b>{' '}
                    <span className={`badge ${t.kind === 'connector' ? 'ok' : 'info'}`}>{t.kind === 'connector' ? 'Approved app' : 'Token'}</span>{' '}
                    <span className="badge off">Full access</span>
                  </div>
                  <button className="link-btn danger" onClick={() => revoke(t)} aria-label={`${t.kind === 'connector' ? 'Disconnect' : 'Revoke'} ${t.name}`}>{t.kind === 'connector' ? 'Disconnect' : 'Revoke'}</button>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {t.serverIds ? `Servers: ${t.serverNames.join(', ') || 'selected servers'}` : 'All your servers'} · Last used {when(t.lastUsedAt)} · {t.expiresAt ? `${t.kind === 'connector' ? 'Needs approval again' : 'Expires'} ${when(t.expiresAt)}` : 'No expiry'}
                </div>
              </div>
            ))}
          </section>

          <section className="side-col" aria-labelledby="new-tok-h" style={{ alignSelf: 'flex-start' }}>
            <h2 id="new-tok-h" className="card-title">Create a token</h2>
            <form onSubmit={create} style={{ marginTop: 12 }}>
              <div className="field"><label htmlFor="tk-name">Name</label><input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Code on my laptop" maxLength={60} required /></div>
              <fieldset className="fieldset">
                <legend>Servers it can see</legend>
                <label className="check"><input type="radio" name="scope" checked={!only} onChange={() => setOnly(false)} />All my servers</label>
                <label className="check"><input type="radio" name="scope" checked={only} onChange={() => setOnly(true)} />Only selected servers</label>
                {only && servers.map((s) => (
                  <label className="check" key={s.id} style={{ marginLeft: 24 }}>
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.name}
                  </label>
                ))}
              </fieldset>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="tk-exp">Expires</label>
                <select id="tk-exp" className="select" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option><option value="never">Never</option>
                </select>
              </div>
              <button className="btn p" style={{ width: '100%' }} disabled={busy || !name.trim() || (only && picked.length === 0)}>{busy ? 'Creating…' : 'Create token'}</button>
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>The token gets full access to the servers you choose.</p>
            </form>
          </section>
        </div>
      </details>

      <section className="card pad-lg" style={{ marginTop: 24 }} aria-labelledby="safe-h">
        <h2 id="safe-h" className="card-title">Good to know</h2>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Every request is logged in <a href="#/activity">Activity</a>, tagged with the connection's name.</li>
          <li>Connections have full access: the assistant can run commands, write files and restart services on the servers you approved. Only connect clients you trust.</li>
          <li>Logs can contain private data. They go to the AI service you connect, under that service's terms.</li>
          <li>Disconnecting takes effect immediately. Revoke a token and anything using it stops at once.</li>
        </ul>
      </section>
    </>
  );
}
