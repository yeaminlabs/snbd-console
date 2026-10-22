import { useEffect, useRef, useState } from 'react';
import { api, type AppInfo, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';
import { AppLogo } from '../components/AppLogos';

// installers print colour codes; the log pane shows plain text
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

export function Apps({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<{ id: string; app: string; status: string; pct: number; step: string } | null>(null);
  const [log, setLog] = useState('');
  const offset = useRef(0);
  const logEl = useRef<HTMLDivElement>(null);

  const loadApps = () => api.apps(serverId).then((r) => {
    setApps(r.apps); setOnline(r.agentConnected);
    return r;
  }).catch((e) => setError(e.message));

  useEffect(() => { api.server(serverId).then(setServer).catch(() => {}); }, [serverId]);

  // on arrival: list apps and, if a job exists, show its log (and keep following it if it is still running)
  useEffect(() => {
    loadApps().then((r) => {
      if (r?.lastJob) { offset.current = 0; setLog(''); setJob({ id: r.lastJob.id, app: r.lastJob.app, status: r.lastJob.status, pct: 0, step: '' }); }
    });
  }, [serverId]);

  const jobId = job?.id;
  const running = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.job(serverId, jobId, offset.current);
        if (stop) return;
        offset.current = s.offset;
        if (s.log) setLog((l) => l + stripAnsi(s.log));
        setJob((j) => (j && j.id === jobId ? { ...j, status: s.status, pct: s.pct, step: s.step } : j));
        if (s.status === 'done' || s.status === 'failed') { loadApps(); return; }
      } catch { /* a missed poll is retried on the next tick */ }
      if (!stop) timer = setTimeout(tick, 1200);
    };
    let timer = setTimeout(tick, 0);
    return () => { stop = true; clearTimeout(timer); };
  }, [serverId, jobId]);

  useEffect(() => { logEl.current?.scrollTo({ top: logEl.current.scrollHeight }); }, [log]);

  async function install(a: AppInfo) {
    setError('');
    try {
      const { jobId } = await api.install(serverId, a.id);
      offset.current = 0; setLog('');
      setJob({ id: jobId, app: a.id, status: 'queued', pct: 0, step: '' });
    } catch (e) { setError((e as Error).message); }
  }
  async function cancel() {
    if (!job || !confirm('Stop this install? The server may be left half-configured.')) return;
    try { await api.cancelJob(serverId, job.id); } catch (e) { setError((e as Error).message); }
  }

  const jobApp = apps.find((a) => a.id === job?.app);
  const lines = log.split('\n');

  return (
    <>
      <ServerHeader server={server} tab="apps" />
      <div className="cols">
        <div className="main-col">
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>One-click apps</h2>
            <div className="muted">Installed by the panel agent inside your VPS. Each install streams its log live.</div>
          </div>
          {!online && <p className="notice" role="status">The server agent is offline, so apps cannot be checked or installed right now.</p>}
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div className="app-grid">
            {apps.map((a) => {
              const busy = running && job?.app === a.id;
              return (
                <div className="card pad" key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className="ic" aria-hidden="true"><AppLogo id={a.id} name={a.name} /></div>
                    <div><div style={{ fontWeight: 600 }}>{a.name}</div><div className="muted" style={{ fontSize: 12 }}>{a.tag}</div></div>
                  </div>
                  <div className="muted" style={{ flex: 1 }}>{a.desc}</div>
                  <button className={`btn ${a.installed ? 'done' : busy ? 'busy' : 'p'}`} disabled={a.installed === true || running || !online} onClick={() => install(a)}>
                    {a.installed ? 'Installed' : busy ? 'Installing…' : 'Install'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <section className="card logcard" aria-labelledby="job-h">
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2 id="job-h" className="card-title">{job ? `${job.status === 'done' ? 'Installed' : job.status === 'failed' ? 'Install failed:' : 'Installing'} ${jobApp?.name ?? job.app}` : 'Install log'}</h2>
              {job && <span className={`badge ${job.status === 'done' ? 'ok' : job.status === 'failed' ? 'off' : 'warn'}`}>{job.status === 'done' ? 'Done' : job.status === 'failed' ? 'Failed' : `${job.pct}%`}</span>}
            </div>
            {job && <div className="progress" role="progressbar" aria-valuenow={job.status === 'done' ? 100 : job.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Install progress"><div style={{ width: `${job.status === 'done' ? 100 : job.pct}%` }} /></div>}
            {job && running && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>{job.step}</span>
                <button className="link-btn danger" onClick={cancel}>Cancel</button>
              </div>
            )}
          </div>
          <div className="logbox mono" ref={logEl} tabIndex={0} role="log" aria-label="Install log">
            {!job && <div style={{ color: '#a1a1aa' }}>Choose an app to install. Its log appears here.</div>}
            {job && lines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('##STEP') ? '#86efac' : /^error|failed/i.test(l) ? '#fca5a5' : '#e4e4e7', fontWeight: l.startsWith('##STEP') ? 600 : 400 }}>{l.startsWith('##STEP') ? l.replace(/^##STEP /, '▸ ') : l || ' '}</div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
