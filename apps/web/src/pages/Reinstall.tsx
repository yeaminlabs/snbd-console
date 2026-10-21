import { useEffect, useState } from 'react';
import { api, type OsImage, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';

export function Reinstall({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [systems, setSystems] = useState<OsImage[]>([]);
  const [sel, setSel] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState<string | undefined>();
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.osImages().then((l) => { setSystems(l); setSel((s) => s || l[0]?.image || ''); }).catch(() => {}); }, []);
  useEffect(() => {
    const load = () => api.server(serverId).then(setServer).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [serverId]);

  const chosen = systems.find((o) => o.image === sel);
  const current = systems.find((o) => o.image === server?.os);
  const inProgress = !!server?.reinstall_started_at || started;
  const finished = started && !!server && !server.reinstall_started_at && server.status === 'running';
  const supported = server?.capabilities?.rebuild;

  async function go() {
    if (!ack || !sel) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.reinstall(serverId, sel);
      setPassword(res.rootPassword);
      setStarted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(password ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the password stays selectable */ }
  }

  return (
    <>
      <ServerHeader server={server} tab="reinstall" />
      {server && supported === false && <p className="notice" role="status">Reinstall is not available for this server yet.</p>}
      <div className="cols">
        <div className="main-col">
          <section className="card pad-lg" aria-labelledby="os-h">
            <h2 id="os-h" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Choose an operating system</h2>
            <div className="muted" style={{ marginTop: 4 }}>{current ? `Currently ${current.name} ${current.ver}. ` : ''}The new system replaces the disk.</div>
            <div className="os-grid" role="radiogroup" aria-labelledby="os-h">
              {systems.map((o) => (
                <button key={o.image} role="radio" aria-checked={sel === o.image} className={`os ${sel === o.image ? 'sel' : ''}`} onClick={() => setSel(o.image)} disabled={inProgress || supported === false}>
                  <span className="dot" aria-hidden="true">{o.name.charAt(0)}</span>
                  <span><span style={{ display: 'block', fontWeight: 600 }}>{o.name}</span><span className="muted" style={{ fontSize: 12 }}>{o.ver}</span></span>
                </button>
              ))}
            </div>
          </section>

          <section className="card pad-lg" aria-labelledby="acc-h">
            <h2 id="acc-h" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Access after reinstall</h2>
            {password ? (
              <div style={{ marginTop: 16, maxWidth: 480 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Root password</div>
                <div className="codebox mono" tabIndex={0} style={{ fontSize: 14 }}>{password}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                  <span className="muted" style={{ fontSize: 12 }}>Shown once. Save it now, it is not stored.</span>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16, maxWidth: 480 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Root password</div>
                <div className="mono field-fake">Generated automatically, shown once</div>
              </div>
            )}
          </section>
        </div>

        <div className="side-col">
          <section className="card pad-lg" aria-labelledby="sum-h">
            <h2 id="sum-h" className="card-title">Summary</h2>
            <div className="kv"><span className="muted">Server</span><span>{server?.name ?? '…'}</span></div>
            <div className="kv"><span className="muted">New system</span><b>{chosen ? `${chosen.name} ${chosen.ver}` : '—'}</b></div>
            <div className="kv"><span className="muted">Takes about</span><span>3 minutes</span></div>
            <div className="warnbox">All files and apps on this server will be erased. The panel agent is reinstalled automatically.</div>

            {inProgress ? (
              <div role="status" style={{ marginTop: 16 }}>
                {finished ? (
                  <><span className="badge ok">Done</span><p style={{ margin: '8px 0 0' }}>The server is back with its new system. <a href={`#/servers/${serverId}`}>Go to overview</a></p></>
                ) : (
                  <><span className="badge warn">Reinstalling…</span><p className="muted" style={{ margin: '8px 0 0' }}>The server comes back on its own once the new system has installed and the agent has connected.</p></>
                )}
              </div>
            ) : (
              <>
                <label className="check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={supported === false} />
                  I understand my data will be lost
                </label>
                {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
                <button className="btn p" style={{ width: '100%', marginTop: 16 }} disabled={!ack || busy || !sel || supported === false} onClick={go}>{busy ? 'Starting…' : 'Reinstall now'}</button>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
