import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, type ActiveJob, type AppFormField, type AppInfo, type ContainerFileEntry, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';
import { AppLogo } from '../components/AppLogos';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

type FocusedJob = { id: string; app: string; kind: string; status: string; pct: number; step: string };

/** Inline parameter form for compose-type apps. */
function ParamForm({ app, onSubmit, onCancel }: { app: AppInfo; onSubmit: (params: Record<string, string>) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(app.form.map((f) => [f.key, f.default]))
  );
  const set = (key: string, val: string) => setValues((v) => ({ ...v, [key]: val }));
  function submit(e: React.FormEvent) { e.preventDefault(); onSubmit(values); }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      {app.form.map((f: AppFormField) => (
        <div key={f.key}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
            {f.label}{f.required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
          </label>
          <input
            type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            required={f.required}
            placeholder={f.default || undefined}
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'inherit', fontSize: 13 }}
          />
          {f.hint && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{f.hint}</div>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn p" style={{ flex: 1 }}>Install</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** In-place editor for docker-compose.yml and .env of an installed compose app. */
function ConfigEditor({ serverId, app, onJobQueued, onClose }: { serverId: string; app: AppInfo; onJobQueued: (jobId: string) => void; onClose: () => void }) {
  const [compose, setCompose] = useState('');
  const [env, setEnv] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'compose' | 'env'>('compose');
  const [error, setError] = useState('');

  useEffect(() => {
    api.appConfig(serverId, app.id).then((r) => { setCompose(r.compose); setEnv(r.env); setLoading(false); }).catch((e) => { setError(e.message); setLoading(false); });
  }, [serverId, app.id]);

  async function save() {
    setSaving(true); setError('');
    try {
      const { jobId } = await api.saveAppConfig(serverId, app.id, { compose, env });
      onJobQueued(jobId);
      onClose();
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  const taStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: '#18181b', color: '#e4e4e7', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', minHeight: 220 };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {(['compose', 'env'] as const).map((t) => (
          <button key={t} className={tab === t ? 'btn p' : 'btn'} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setTab(t)}>
            {t === 'compose' ? 'docker-compose.yml' : '.env'}
          </button>
        ))}
      </div>
      {loading ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div> : (
        <>
          {tab === 'compose'
            ? <textarea style={taStyle} value={compose} onChange={(e) => setCompose(e.target.value)} spellCheck={false} />
            : <textarea style={taStyle} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />
          }
          {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn p" disabled={saving} onClick={save} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save & Restart'}</button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Full-screen terminal modal that opens a shell inside a container. */
function ContainerTerminal({ serverId, containerName, appName, onClose }: { serverId: string; containerName: string; appName: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState('');

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ cursorBlink: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, theme: { background: '#18181b' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal/${serverId}?container=${encodeURIComponent(containerName)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    const sendSize = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    ws.onopen = sendSize;
    ws.onmessage = (e) => term.write(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = () => setEnded('Session ended.');
    const input = term.onData((data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'in', data })));
    const onResize = () => { fit.fit(); sendSize(); };
    addEventListener('resize', onResize);
    term.focus();
    return () => { removeEventListener('resize', onResize); input.dispose(); ws.close(); term.dispose(); };
  }, [serverId, containerName]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#27272a', borderBottom: '1px solid #3f3f46', flexShrink: 0 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#e4e4e7' }}>Terminal — {appName} <span className="muted">({containerName})</span></span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {ended && <span className="badge off">{ended}</span>}
          <button className="btn" style={{ padding: '4px 12px', fontSize: 13 }} onClick={onClose}>Close</button>
        </div>
      </div>
      <div style={{ flex: 1, background: '#18181b', padding: 8, overflow: 'hidden' }}>
        <div ref={host} style={{ height: '100%' }} />
      </div>
    </div>
  );
}

/** Mini file browser for files inside a running container. */
function ContainerFileBrowser({ serverId, app, onClose }: { serverId: string; app: AppInfo; onClose: () => void }) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<ContainerFileEntry[]>([]);
  const [content, setContent] = useState<{ path: string; text: string } | null>(null);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true); setError('');
    api.containerFiles(serverId, app.id, path)
      .then((r) => { setEntries(r.entries ?? []); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [serverId, app.id, path]);

  function openDir(name: string) {
    const newPath = path === '/' ? `/${name}` : `${path}/${name}`;
    setContent(null); setPath(newPath);
  }
  function goUp() {
    const parent = path.substring(0, path.lastIndexOf('/')) || '/';
    setContent(null); setPath(parent);
  }
  async function openFile(name: string) {
    const filePath = path === '/' ? `/${name}` : `${path}/${name}`;
    setError('');
    try {
      const r = await api.containerFileContent(serverId, app.id, filePath);
      setContent({ path: filePath, text: r.content });
      setEditText(r.content);
    } catch (e) { setError((e as Error).message); }
  }
  async function saveFile() {
    if (!content) return;
    setSaving(true);
    try {
      await api.saveContainerFile(serverId, app.id, content.path, editText);
      setContent({ ...content, text: editText });
      setSaving(false);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#27272a', borderBottom: '1px solid #3f3f46', flexShrink: 0 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#e4e4e7' }}>Container Files — {app.name} &nbsp;<span className="muted">{path}</span></span>
        <button className="btn" style={{ padding: '4px 12px', fontSize: 13 }} onClick={onClose}>Close</button>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* File list */}
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid #3f3f46', overflow: 'auto', background: '#1c1c1e', padding: 8 }}>
          {path !== '/' && (
            <div style={{ padding: '4px 8px', cursor: 'pointer', color: '#a1a1aa', fontSize: 13 }} onClick={goUp}>← ..</div>
          )}
          {loading && <div className="muted" style={{ padding: 8, fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ color: '#ef4444', fontSize: 12, padding: 8 }}>{error}</div>}
          {entries.map((e) => (
            <div
              key={e.name}
              style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: e.type === 'dir' ? '#60a5fa' : '#e4e4e7', borderRadius: 4 }}
              onClick={() => e.type === 'dir' ? openDir(e.name) : openFile(e.name)}
            >
              {e.type === 'dir' ? '📁 ' : '📄 '}{e.name}
            </div>
          ))}
        </div>
        {/* File editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, overflow: 'hidden' }}>
          {content ? (
            <>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 6, fontFamily: 'monospace' }}>{content.path}</div>
              <textarea
                style={{ flex: 1, background: '#18181b', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'monospace', resize: 'none' }}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                spellCheck={false}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn p" disabled={saving} onClick={saveFile} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn" onClick={() => setContent(null)} style={{ fontSize: 13 }}>Close file</button>
              </div>
            </>
          ) : (
            <div className="muted" style={{ margin: 'auto', fontSize: 13 }}>Click a file to view or edit it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Apps({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [focusedJob, setFocusedJob] = useState<FocusedJob | null>(null);
  const [log, setLog] = useState('');
  const offset = useRef(0);
  const logEl = useRef<HTMLDivElement>(null);
  const [paramFormApp, setParamFormApp] = useState<AppInfo | null>(null);
  const [configEditorApp, setConfigEditorApp] = useState<AppInfo | null>(null);
  const [terminalApp, setTerminalApp] = useState<AppInfo | null>(null);
  const [filesApp, setFilesApp] = useState<AppInfo | null>(null);

  const loadApps = () => api.apps(serverId).then((r) => {
    setApps(r.apps); setOnline(r.agentConnected); setActiveJobs(r.activeJobs);
    return r;
  }).catch((e) => { setError(e.message); return undefined; });

  useEffect(() => { api.server(serverId).then(setServer).catch(() => {}); }, [serverId]);

  useEffect(() => {
    loadApps().then((r) => {
      if (!r) return;
      const running = r.activeJobs.find((j) => j.status === 'running' || j.status === 'queued');
      if (running) {
        offset.current = 0; setLog('');
        setFocusedJob({ id: running.id, app: running.app, kind: running.kind, status: running.status, pct: 0, step: '' });
      }
    });
  }, [serverId]);

  const focusedJobId = focusedJob?.id;
  const pollingActive = focusedJob?.status === 'queued' || focusedJob?.status === 'running';
  useEffect(() => {
    if (!focusedJobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.job(serverId, focusedJobId, offset.current);
        if (stop) return;
        offset.current = s.offset;
        if (s.log) setLog((l) => l + stripAnsi(s.log));
        setFocusedJob((j) => (j && j.id === focusedJobId ? { ...j, status: s.status, pct: s.pct, step: s.step } : j));
        if (s.status === 'done' || s.status === 'failed') { loadApps(); return; }
        if (s.status === 'queued') { loadApps(); }
      } catch { /* missed poll, retry */ }
      if (!stop) timer = setTimeout(tick, 1200);
    };
    let timer = setTimeout(tick, 0);
    return () => { stop = true; clearTimeout(timer); };
  }, [serverId, focusedJobId]);

  useEffect(() => { logEl.current?.scrollTo({ top: logEl.current.scrollHeight }); }, [log]);

  function install(a: AppInfo) {
    if (a.type === 'compose' && a.form.length > 0) { setParamFormApp(a); }
    else { void doInstall(a, {}); }
  }

  async function doInstall(a: AppInfo, params: Record<string, string>) {
    setParamFormApp(null); setError('');
    try {
      const { jobId } = await api.install(serverId, a.id, params);
      setActiveJobs((prev) => prev.find((j) => j.id === jobId) ? prev : [...prev, { id: jobId, app: a.id, kind: `install:${a.id}`, status: 'queued' }]);
      if (!focusedJob || focusedJob.status === 'done' || focusedJob.status === 'failed') {
        offset.current = 0; setLog('');
        setFocusedJob({ id: jobId, app: a.id, kind: `install:${a.id}`, status: 'queued', pct: 0, step: '' });
      }
    } catch (e) { setError((e as Error).message); }
  }

  async function uninstall(a: AppInfo) {
    if (!confirm(`Remove ${a.name} from this server?`)) return;
    setError('');
    try {
      const { jobId } = await api.uninstall(serverId, a.id);
      setActiveJobs((prev) => prev.find((j) => j.id === jobId) ? prev : [...prev, { id: jobId, app: a.id, kind: `uninstall:${a.id}`, status: 'queued' }]);
      if (!focusedJob || focusedJob.status === 'done' || focusedJob.status === 'failed') {
        offset.current = 0; setLog('');
        setFocusedJob({ id: jobId, app: a.id, kind: `uninstall:${a.id}`, status: 'queued', pct: 0, step: '' });
      }
    } catch (e) { setError((e as Error).message); }
  }

  async function cancel() {
    if (!focusedJob || !confirm('Stop this job? The server may be left half-configured.')) return;
    try { await api.cancelJob(serverId, focusedJob.id); } catch (e) { setError((e as Error).message); }
  }

  function onConfigJobQueued(jobId: string, a: AppInfo) {
    setActiveJobs((prev) => prev.find((j) => j.id === jobId) ? prev : [...prev, { id: jobId, app: a.id, kind: `restart:${a.id}`, status: 'queued' }]);
    offset.current = 0; setLog('');
    setFocusedJob({ id: jobId, app: a.id, kind: `restart:${a.id}`, status: 'queued', pct: 0, step: '' });
  }

  function cardState(a: AppInfo) {
    const myJobs = activeJobs.filter((j) => j.app === a.id);
    const running = myJobs.find((j) => j.status === 'running');
    const queued = myJobs.find((j) => j.status === 'queued');
    const queuePosition = queued ? activeJobs.filter((j) => j.status === 'queued').findIndex((j) => j.id === queued.id) + 1 : 0;
    return { running, queued, queuePosition };
  }

  const focusedApp = apps.find((a) => a.id === focusedJob?.app);
  const isUninstallJob = focusedJob?.kind?.startsWith('uninstall:');
  const isRestartJob = focusedJob?.kind?.startsWith('restart:');
  const lines = log.split('\n');

  return (
    <>
      {terminalApp && terminalApp.containerName && (
        <ContainerTerminal
          serverId={serverId}
          containerName={terminalApp.containerName}
          appName={terminalApp.name}
          onClose={() => setTerminalApp(null)}
        />
      )}
      {filesApp && (
        <ContainerFileBrowser serverId={serverId} app={filesApp} onClose={() => setFilesApp(null)} />
      )}

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
              const { running, queued, queuePosition } = cardState(a);
              const showConfigEditor = configEditorApp?.id === a.id;

              return (
                <div className="card pad" key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className="ic" aria-hidden="true"><AppLogo id={a.id} name={a.name} /></div>
                    <div><div style={{ fontWeight: 600 }}>{a.name}</div><div className="muted" style={{ fontSize: 12 }}>{a.tag}</div></div>
                  </div>
                  <div className="muted" style={{ flex: 1 }}>{a.desc}</div>

                  {/* Inline parameter form (before install) */}
                  {paramFormApp?.id === a.id ? (
                    <ParamForm app={a} onSubmit={(p) => doInstall(a, p)} onCancel={() => setParamFormApp(null)} />
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {a.installed ? (
                        <>
                          <button className="btn done" disabled style={{ flex: 1, minWidth: 80 }}>Installed</button>
                          {a.type === 'compose' && a.containerName && (
                            <>
                              <button
                                className="btn"
                                style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', background: 'transparent' }}
                                disabled={!online}
                                title="Open a shell inside the container"
                                onClick={() => setTerminalApp(a)}
                              >
                                Terminal
                              </button>
                              <button
                                className="btn"
                                style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', background: 'transparent' }}
                                disabled={!online}
                                title="Browse files inside the container"
                                onClick={() => setFilesApp(a)}
                              >
                                Files
                              </button>
                              <button
                                className="btn"
                                style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', background: 'transparent' }}
                                disabled={!online}
                                title="Edit docker-compose.yml and .env"
                                onClick={() => setConfigEditorApp(showConfigEditor ? null : a)}
                              >
                                Config
                              </button>
                            </>
                          )}
                          <button
                            className="btn"
                            style={{ flex: '0 0 auto', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                            disabled={!online || !!queued || !!running}
                            onClick={() => uninstall(a)}
                          >
                            Uninstall
                          </button>
                        </>
                      ) : running ? (
                        <button className="btn busy" disabled style={{ flex: 1 }}>Installing…</button>
                      ) : queued ? (
                        <button className="btn" disabled style={{ flex: 1, background: '#a16207', color: '#fef9c3' }} title={`Position ${queuePosition} in queue`}>
                          Queued #{queuePosition}
                        </button>
                      ) : (
                        <button className="btn p" disabled={!online} style={{ flex: 1 }} onClick={() => install(a)}>
                          {a.type === 'compose' && a.form.length > 0 ? 'Configure & Install' : 'Install'}
                        </button>
                      )}
                      {(running || queued) && focusedJob?.app !== a.id && (
                        <button className="link-btn" style={{ fontSize: 12 }} onClick={() => {
                          const job = running || queued!;
                          offset.current = 0; setLog('');
                          setFocusedJob({ id: job.id, app: job.app, kind: job.kind, status: job.status, pct: 0, step: '' });
                        }}>
                          View log
                        </button>
                      )}
                    </div>
                  )}

                  {/* Inline compose/env config editor */}
                  {showConfigEditor && a.type === 'compose' && (
                    <ConfigEditor
                      serverId={serverId}
                      app={a}
                      onJobQueued={(jobId) => onConfigJobQueued(jobId, a)}
                      onClose={() => setConfigEditorApp(null)}
                    />
                  )}

                  {/* Post-install note for installed compose apps */}
                  {a.installed && a.postInstall?.note && !showConfigEditor && (
                    <div className="muted" style={{ fontSize: 11, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                      {a.postInstall.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <section className="card logcard" aria-labelledby="job-h">
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2 id="job-h" className="card-title">
                {focusedJob
                  ? `${focusedJob.status === 'done'
                      ? (isUninstallJob ? 'Uninstalled' : isRestartJob ? 'Restarted' : 'Installed')
                      : focusedJob.status === 'failed'
                      ? (isUninstallJob ? 'Uninstall failed:' : isRestartJob ? 'Restart failed:' : 'Install failed:')
                      : focusedJob.status === 'queued'
                      ? (isUninstallJob ? 'Queued: uninstall' : isRestartJob ? 'Queued: restart' : 'Queued: install')
                      : (isUninstallJob ? 'Uninstalling' : isRestartJob ? 'Restarting' : 'Installing')} ${focusedApp?.name ?? focusedJob.app}`
                  : 'Install log'}
              </h2>
              {focusedJob && <span className={`badge ${focusedJob.status === 'done' ? 'ok' : focusedJob.status === 'failed' ? 'off' : 'warn'}`}>{focusedJob.status === 'done' ? 'Done' : focusedJob.status === 'failed' ? 'Failed' : focusedJob.status === 'queued' ? 'Queued' : `${focusedJob.pct}%`}</span>}
            </div>
            {focusedJob && <div className="progress" role="progressbar" aria-valuenow={focusedJob.status === 'done' ? 100 : focusedJob.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Job progress"><div style={{ width: `${focusedJob.status === 'done' ? 100 : focusedJob.pct}%` }} /></div>}
            {focusedJob && pollingActive && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>{focusedJob.status === 'queued' ? 'Waiting for current job to finish…' : focusedJob.step}</span>
                <button className="link-btn danger" onClick={cancel}>Cancel</button>
              </div>
            )}
            {activeJobs.filter((j) => j.status === 'queued').length > 1 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {activeJobs.filter((j) => j.status === 'queued').length} jobs queued — they will run one after another.
              </div>
            )}
          </div>
          <div className="logbox mono" ref={logEl} tabIndex={0} role="log" aria-label="Job log">
            {!focusedJob && <div style={{ color: '#a1a1aa' }}>Choose an app to install. Its log appears here.</div>}
            {focusedJob && lines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('##STEP') ? '#86efac' : /^error|failed/i.test(l) ? '#fca5a5' : '#e4e4e7', fontWeight: l.startsWith('##STEP') ? 600 : 400 }}>{l.startsWith('##STEP') ? l.replace(/^##STEP /, '▸ ') : l || ' '}</div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
