import { useEffect, useState } from 'react';
import { api, type OAuthRequestInfo } from '../api';

export function Authorize({ id }: { id: string }) {
  const [info, setInfo] = useState<OAuthRequestInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => { api.oauthRequest(id).then(setInfo).catch((e) => setError(e.message)); }, [id]);

  async function finish(allow: boolean) {
    setBusy(true); setError('');
    try {
      const r = allow ? await api.oauthApprove(id, only ? picked : null) : await api.oauthDeny(id);
      location.href = r.redirect; // back to the app, with the one-time code
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <section className="card" style={{ width: '100%', maxWidth: 520, padding: 32 }} aria-labelledby="auth-h">
        <div className="brand-mark" style={{ marginBottom: 4 }}>
          <span className="brand">S</span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>SNBD <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Console</span></span>
        </div>
        {error && <p className="error" role="alert" style={{ marginTop: 16 }}>{error}</p>}
        {!info && !error && <p className="muted">Loading…</p>}
        {info && (
          <>
            <h1 id="auth-h" style={{ fontSize: 26, margin: '12px 0 8px' }}>Allow {info.clientName}?</h1>
            <p style={{ margin: '0 0 12px' }}>This app wants to look at your servers.</p>
            <div className="warnbox" style={{ marginTop: 0 }}>
              After you choose, you are sent back to <b>{info.returnsTo}</b>. Only continue if you just started this connection from that app.
            </div>
            <div className="kv"><span className="muted">Access</span><span>{info.access}</span></div>
            <div className="kv"><span className="muted">Can change anything?</span><span>No</span></div>
            <fieldset className="fieldset" style={{ marginTop: 16 }}>
              <legend>Servers it can see</legend>
              <label className="check"><input type="radio" name="scope" checked={!only} onChange={() => setOnly(false)} />All my servers</label>
              <label className="check"><input type="radio" name="scope" checked={only} onChange={() => setOnly(true)} />Only selected servers</label>
              {only && info.servers.map((s) => (
                <label className="check" key={s.id} style={{ marginLeft: 24 }}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.name}
                </label>
              ))}
            </fieldset>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button className="btn p" style={{ flex: 1 }} disabled={busy || (only && picked.length === 0)} onClick={() => finish(true)}>{busy ? 'Working…' : 'Allow'}</button>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => finish(false)}>Cancel</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '16px 0 0' }}>You can disconnect it at any time under AI agents.</p>
          </>
        )}
      </section>
    </main>
  );
}
