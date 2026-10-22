import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server, type TokenInfo } from '../api';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* the text stays selectable */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function Agents() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<string>('90');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const load = () => api.tokens().then(setTokens).catch((e) => setError(e.message));
  useEffect(() => { load(); api.servers().then(setServers).catch(() => {}); }, []);

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
    if (!confirm(t.kind === 'connector' ? `Disconnect "${t.name}"? It loses access immediately and must be approved again to reconnect.` : `Revoke "${t.name}"? Any AI agent using it stops working immediately.`)) return;
    try { await api.revokeToken(t.id); if (fresh?.name === t.name) setFresh(null); load(); } catch (err) { setError((err as Error).message); }
  }

  const url = `${location.origin}/mcp`;
  const claudeCmd = fresh ? `claude mcp add --transport http snbd ${url} --header "Authorization: Bearer ${fresh.token}"` : '';
  const jsonCfg = fresh ? JSON.stringify({ mcpServers: { snbd: { type: 'http', url, headers: { Authorization: `Bearer ${fresh.token}` } } } }, null, 2) : '';

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>AI agents</h1>
          <div className="muted" style={{ marginTop: 4, maxWidth: 640 }}>Let an AI assistant such as Claude look at your servers. In the Claude app add a connector with the address below and approve it here, or use a token for tools such as Claude Code. Access is read-only: servers, status, public IP and logs. Nothing can be changed yet.</div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card pad-lg" style={{ marginTop: 24 }} aria-labelledby="conn-h">
        <h2 id="conn-h" className="card-title">Connect the Claude app</h2>
        <p className="muted" style={{ margin: '8px 0 12px' }}>Claude → Settings → Connectors → Add custom connector. Paste this address, click Connect, then sign in and approve on the page that opens.</p>
        <div className="codebox mono" tabIndex={0}>{url}</div>
        <div style={{ marginTop: 8 }}><Copy text={url} label="Copy address" /></div>
      </section>

      {fresh && (
        <section className="card pad-lg" style={{ marginTop: 24, boxShadow: 'inset 0 0 0 2px var(--red), 0 1px 3px rgba(0,0,0,.1)' }} aria-labelledby="new-h">
          <h2 id="new-h" className="card-title">Token created: {fresh.name}</h2>
          <p className="muted" style={{ margin: '8px 0 12px' }}><b style={{ color: 'var(--ink)' }}>Copy it now.</b> It is shown only once; the panel keeps just a fingerprint.</p>
          <div className="codebox mono" tabIndex={0}>{fresh.token}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><Copy text={fresh.token} label="Copy token" /></div>
          <h3 style={{ fontSize: 14, margin: '20px 0 6px' }}>Claude Code</h3>
          <div className="codebox mono" tabIndex={0}>{claudeCmd}</div>
          <div style={{ marginTop: 8 }}><Copy text={claudeCmd} label="Copy command" /></div>
          <h3 style={{ fontSize: 14, margin: '20px 0 6px' }}>Other tools (Cursor, VS Code, and so on): MCP settings</h3>
          <pre className="codebox mono" tabIndex={0} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{jsonCfg}</pre>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><Copy text={jsonCfg} label="Copy settings" /><button className="link-btn" onClick={() => setFresh(null)}>I have saved it</button></div>
        </section>
      )}

      <div className="cols">
        <section className="card pad-lg grow-lg" aria-labelledby="tok-h">
          <h2 id="tok-h" className="card-title">Your tokens</h2>
          {tokens?.length === 0 && <p className="muted" style={{ margin: '12px 0 0' }}>No tokens yet. Create one on the right.</p>}
          {tokens?.map((t) => (
            <div key={t.id} style={{ padding: '14px 0', borderTop: '1px solid #f4f4f5', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div><b>{t.name}</b> <span className={`badge ${t.kind === 'connector' ? 'ok' : 'info'}`}>{t.kind === 'connector' ? 'Connected app' : 'Token'}</span> <span className="badge off">Read only</span>{t.kind === 'token' && <> <span className="mono muted" style={{ fontSize: 12 }}>{t.prefix}…</span></>}</div>
                <button className="link-btn danger" onClick={() => revoke(t)} aria-label={`${t.kind === 'connector' ? 'Disconnect' : 'Revoke'} ${t.name}`}>{t.kind === 'connector' ? 'Disconnect' : 'Revoke'}</button>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {t.serverIds ? `Servers: ${t.serverNames.join(', ') || 'selected servers'}` : 'All your servers'} · Last used {when(t.lastUsedAt)} · {t.expiresAt ? `${t.kind === 'connector' ? 'Needs approval again' : 'Expires'} ${when(t.expiresAt)}` : 'No expiry'}
              </div>
            </div>
          ))}
        </section>

        <section className="side-col card pad-lg" aria-labelledby="new-tok-h" style={{ alignSelf: 'flex-start' }}>
          <h2 id="new-tok-h" className="card-title">Create a token</h2>
          <form onSubmit={create} style={{ marginTop: 12 }}>
            <div className="field"><label htmlFor="tk-name">Name</label><input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude on my laptop" maxLength={60} required /></div>
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
          </form>
        </section>
      </div>

      <section className="card pad-lg" style={{ marginTop: 24 }} aria-labelledby="safe-h">
        <h2 id="safe-h" className="card-title">Good to know</h2>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Anything the agent does shows up in <a href="#/activity">Activity</a>, tagged with the token's name.</li>
          <li>Logs can contain private data. They go to the AI service you connect, under that service's terms.</li>
          <li>Treat a token like a password. If it leaks, revoke it here and it stops working at once.</li>
        </ul>
      </section>
    </>
  );
}
