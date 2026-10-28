import { useEffect, useState } from 'react';
import { api, type OAuthRequestInfo } from '../api';
import snbdLogo from '../assets/logo101.png';

export function Authorize({ id }: { id: string }) {
  const [info, setInfo] = useState<OAuthRequestInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [fullAccess, setFullAccess] = useState(false);

  useEffect(() => { api.oauthRequest(id).then(setInfo).catch((e) => setError(e.message)); }, [id]);

  async function finish(allow: boolean) {
    setBusy(true); setError('');
    try {
      const r = allow ? await api.oauthApprove(id, only ? picked : null, fullAccess ? 'deploy' : 'read') : await api.oauthDeny(id);
      location.href = r.redirect; // back to the app, with the one-time code
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <section className="card" style={{ width: '100%', maxWidth: 520, padding: 32 }} aria-labelledby="auth-h">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <img src={snbdLogo} alt="SNBD HOST" style={{ height: 80, width: 'auto', display: 'block' }} />
        </div>
        {error && <p className="error" role="alert" style={{ marginTop: 16 }}>{error}</p>}
        {!info && !error && <p className="muted">Loading…</p>}
        {info && (
          <>
            <h1 id="auth-h" style={{ fontSize: 26, margin: '12px 0 8px' }}>Connect {info.clientName}?</h1>
            <p style={{ margin: '0 0 12px' }}>This app can <b>read</b> your servers (status, logs, files).</p>
            <div className="warnbox" style={{ marginTop: 0 }}>
              After you choose, you are sent back to <b>{info.returnsTo}</b>. Only continue if you just started this connection from that app.
            </div>
            <div className="kv"><span className="muted">Access</span><span>{info.access}</span></div>
            <label className="check" style={{ marginTop: 16, padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: fullAccess ? '#fef2f2' : '#f9fafb' }}>
              <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
              <span><b>Allow changes too</b> — run commands, write files, restart services</span>
            </label>
            {fullAccess && (
              <div className="warnbox" style={{ marginTop: 12 }}>
                <b>Full access:</b> same control as signing in to this panel. Only tick this if you trust {info.clientName} and you just asked it to make changes.
              </div>
            )}
            <div className="kv" style={{ marginTop: 12 }}><span className="muted">Can change anything?</span><span>{fullAccess ? 'Yes — commands, files and services' : 'No — read-only unless you tick the box above'}</span></div>
            <fieldset className="fieldset" style={{ marginTop: 16 }}>
              <legend>Servers it can control</legend>
              <label className="check"><input type="radio" name="scope" checked={!only} onChange={() => setOnly(false)} />All my servers</label>
              <label className="check"><input type="radio" name="scope" checked={only} onChange={() => setOnly(true)} />Only selected servers</label>
              {only && info.servers.map((s) => (
                <label className="check" key={s.id} style={{ marginLeft: 24 }}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.name}
                </label>
              ))}
            </fieldset>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button className="btn p" style={{ flex: 1 }} disabled={busy || (only && picked.length === 0)} onClick={() => finish(true)}>{busy ? 'Working…' : fullAccess ? 'Allow full access' : 'Allow read-only'}</button>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => finish(false)}>Cancel</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '16px 0 0' }}>You can disconnect it at any time under MCP server.</p>
          </>
        )}
      </section>
    </main>
  );
}
