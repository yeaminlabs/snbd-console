import { useEffect, useRef, useState } from 'react';
import { api, type FileEntry, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';

const join = (dir: string, name: string) => (dir === '/' ? '' : dir.replace(/\/$/, '')) + '/' + name;
const parentOf = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
const when = (t: number) => new Date(t * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const go = (id: string, path: string) => { location.hash = `#/servers/${id}/files?p=${encodeURIComponent(path)}`; };

const EXT_COLOR: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#61dafb', json: '#a8a29e',
  md: '#0ea5e9', css: '#ec4899', scss: '#ec4899', html: '#f97316', xml: '#f97316',
  py: '#3776ab', go: '#00add8', rs: '#dea584', java: '#f89820', c: '#555', cpp: '#f34b7d',
  sh: '#4ade80', yml: '#cb171e', yaml: '#cb171e', toml: '#9c4221', env: '#a3e635',
  png: '#a78bfa', jpg: '#a78bfa', jpeg: '#a78bfa', gif: '#a78bfa', svg: '#fbbf24',
  pdf: '#ef4444', zip: '#f59e0b', tar: '#f59e0b', gz: '#f59e0b', log: '#94a3b8',
};

function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.type === 'dir') {
    return (
      <span className="ficon ficon-dir" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>
      </span>
    );
  }
  const ext = extOf(entry.name);
  const color = EXT_COLOR[ext] ?? '#94a3b8';
  return (
    <span className="ficon ficon-file" style={{ ['--fcolor' as any]: color }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M14 3v5h5"/></svg>
      {ext && <span className="ficon-ext">{ext.slice(0, 4)}</span>}
    </span>
  );
}

export function Files({ serverId, path }: { serverId: string; path: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState('');
  const [openName, setOpenName] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [editorNote, setEditorNote] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('snbd-files-view') as 'list' | 'grid') || 'list');
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = openName !== null && text !== original;

  useEffect(() => { api.server(serverId).then(setServer).catch(() => {}); }, [serverId]);

  async function load() {
    setError('');
    try {
      setEntries((await api.files(serverId, path)).entries);
    } catch (e) {
      setEntries(null);
      setError((e as Error).message);
    }
  }
  useEffect(() => { setOpenName(null); setEditorNote(''); setQuery(''); load(); }, [serverId, path]);
  useEffect(() => { localStorage.setItem('snbd-files-view', view); }, [view]);

  const confirmDiscard = () => !dirty || confirm('You have unsaved changes. Discard them?');

  async function openFile(name: string) {
    if (!confirmDiscard()) return;
    setOpenName(name); setEditorNote(''); setText(''); setOriginal('');
    try {
      const r = await api.readFile(serverId, join(path, name));
      setText(r.content); setOriginal(r.content);
    } catch (e) {
      setEditorNote((e as Error).message);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setError('');
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  const save = () => openName && run('Saving…', async () => { await api.saveFile(serverId, join(path, openName), text); setOriginal(text); });

  async function newFile() {
    const name = prompt('New file name');
    if (!name) return;
    if (name.includes('/')) return setError('A name cannot contain "/"');
    await run('Creating…', () => api.saveFile(serverId, join(path, name), ''));
    openFile(name);
  }
  const newFolder = () => {
    const name = prompt('New folder name');
    if (!name) return;
    if (name.includes('/')) return setError('A name cannot contain "/"');
    run('Creating…', () => api.mkdir(serverId, join(path, name)));
  };
  function rename(e: FileEntry) {
    const to = prompt(`Rename ${e.name} to`, e.name);
    if (!to || to === e.name) return;
    if (to.includes('/')) return setError('A name cannot contain "/"');
    run('Renaming…', async () => { await api.rename(serverId, join(path, e.name), join(path, to)); if (openName === e.name) setOpenName(to); });
  }
  function remove(e: FileEntry) {
    if (!confirm(`Delete ${e.name}${e.type === 'dir' ? ' and everything in it' : ''}? This cannot be undone.`)) return;
    run('Deleting…', async () => { await api.remove(serverId, join(path, e.name)); if (openName === e.name) setOpenName(null); });
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    for (const f of files) {
      setBusy(`Uploading ${f.name}…`); setProgress(0);
      await new Promise<void>((resolve) => {
        const x = new XMLHttpRequest();
        x.open('PUT', `/api/servers/${serverId}/files/upload?dir=${encodeURIComponent(path)}&name=${encodeURIComponent(f.name)}`);
        x.setRequestHeader('content-type', 'application/octet-stream');
        x.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
        x.onload = () => { if (x.status !== 200) setError(JSON.parse(x.responseText || '{}').error ?? `Upload failed (${x.status})`); resolve(); };
        x.onerror = () => { setError('Upload failed'); resolve(); };
        x.send(f);
      });
    }
    setBusy(''); setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
    load();
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    uploadFiles(Array.from(files));
  }

  const crumbs = path.split('/').filter(Boolean);
  const openEntry = entries?.find((e) => e.name === openName);
  const filtered = (entries ?? []).filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()));

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  }

  return (
    <>
      <ServerHeader server={server} tab="files" />
      <div className="head-row" style={{ marginTop: 24 }}>
        <nav className="mono crumbs" aria-label="Folder path">
          <a href="#" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, '/'); }}>root</a>
          {crumbs.map((c, i) => {
            const to = '/' + crumbs.slice(0, i + 1).join('/');
            return <span key={to}>{' / '}{i === crumbs.length - 1 ? <b style={{ fontWeight: 600 }}>{c}</b> : <a href="#" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, to); }}>{c}</a>}</span>;
          })}
        </nav>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ width: 200, height: 36 }} placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter files" />
          <div className="view-toggle" role="group" aria-label="View mode">
            <button className={`icon-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} aria-pressed={view === 'list'} title="List view">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>
            </button>
            <button className={`icon-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')} aria-pressed={view === 'grid'} title="Grid view">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>
            </button>
          </div>
          <button className="btn" onClick={newFile} disabled={!!busy}>New file</button>
          <button className="btn" onClick={newFolder} disabled={!!busy}>New folder</button>
          <button className="btn p" onClick={() => fileInput.current?.click()} disabled={!!busy}>Upload</button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="Choose files to upload" />
        </div>
      </div>
      {(busy || error) && (
        <div role="status" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          {busy && <span className="muted">{busy}{progress !== null && ` ${progress}%`}</span>}
          {progress !== null && (
            <div className="progress" style={{ flex: 1, maxWidth: 240 }}><div style={{ width: `${progress}%` }} /></div>
          )}
          {error && <span className="error" role="alert" style={{ margin: 0 }}>{error}</span>}
        </div>
      )}

      <div
        className={`cols${dragOver ? ' drag-over' : ''}`}
        style={{ marginTop: 16 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="card grow-lg" style={{ overflow: 'hidden', position: 'relative' }}>
          {dragOver && (
            <div className="drop-overlay">
              <div className="drop-overlay-inner">
                <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v11.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1zM4 20a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z"/></svg>
                <b>Drop files to upload</b>
                <span>into {path}</span>
              </div>
            </div>
          )}

          {entries === null && !error && (
            <div style={{ padding: 20 }}>
              {[0,1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, borderRadius: 6 }} />)}
            </div>
          )}

          {entries && entries.length === 0 && (
            <div className="empty-state" style={{ height: 220, border: 0 }}>
              <svg viewBox="0 0 24 24" width="40" height="40"><path fill="none" stroke="currentColor" strokeWidth="1.4" d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
              <b>This folder is empty</b>
              <span>Upload files or create a new file or folder to get started.</span>
            </div>
          )}

          {entries && entries.length > 0 && filtered.length === 0 && (
            <div className="empty-state" style={{ height: 160, border: 0 }}>
              <b>No matches</b>
              <span>Nothing named “{query}” in this folder.</span>
            </div>
          )}

          {view === 'list' && entries && filtered.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 640 }}>
                <div className="fr th"><span /><span>Name</span><span>Size</span><span>Modified</span><span>Mode</span><span /></div>
                {path !== '/' && (
                  <div className="fr">
                    <span className="muted" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 19V7.83l-4.59 4.58L5 11l7-7 7 7-1.41 1.41L13 7.83V19h-2z"/></svg>
                    </span>
                    <a href="#" className="fname" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, parentOf(path)); }}>..</a>
                    <span /><span /><span /><span />
                  </div>
                )}
                {filtered.map((e) => (
                  <div className={`fr ${openName === e.name ? 'sel' : ''}`} key={e.name}>
                    <FileIcon entry={e} />
                    <a href="#" className="fname" onClick={(ev) => { ev.preventDefault(); if (e.type === 'dir') { confirmDiscard() && go(serverId, join(path, e.name)); } else if (e.type === 'file') openFile(e.name); }}>
                      {e.name}{e.type === 'dir' ? '/' : ''}{e.link && <span className="muted"> →</span>}
                    </a>
                    <span className="muted">{e.type === 'dir' ? '—' : size(e.size)}</span>
                    <span className="muted">{when(e.mtime)}</span>
                    <span className="mono muted" style={{ fontSize: 12 }}>{e.mode}</span>
                    <span className="row-actions">
                      <button className="link-btn" onClick={() => rename(e)} aria-label={`Rename ${e.name}`}>Rename</button>
                      <button className="link-btn danger" onClick={() => remove(e)} aria-label={`Delete ${e.name}`}>Delete</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'grid' && entries && filtered.length > 0 && (
            <div className="file-grid">
              {path !== '/' && (
                <button className="file-tile" onClick={() => confirmDiscard() && go(serverId, parentOf(path))}>
                  <span className="ficon ficon-dir"><svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M11 19V7.83l-4.59 4.58L5 11l7-7 7 7-1.41 1.41L13 7.83V19h-2z"/></svg></span>
                  <span className="file-tile-name">..</span>
                </button>
              )}
              {filtered.map((e) => (
                <button
                  key={e.name}
                  className={`file-tile ${openName === e.name ? 'sel' : ''}`}
                  onClick={() => { if (e.type === 'dir') { confirmDiscard() && go(serverId, join(path, e.name)); } else if (e.type === 'file') openFile(e.name); }}
                  onContextMenu={(ev) => { ev.preventDefault(); }}
                >
                  <span className="file-tile-icon"><FileIcon entry={e} /></span>
                  <span className="file-tile-name" title={e.name}>{e.name}{e.type === 'dir' ? '/' : ''}</span>
                  <span className="file-tile-meta">{e.type === 'dir' ? 'Folder' : size(e.size)}</span>
                  <span className="file-tile-actions">
                    <button className="icon-btn" onClick={(ev) => { ev.stopPropagation(); rename(e); }} aria-label={`Rename ${e.name}`}>
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" strokeWidth="1.8" d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16v4z"/></svg>
                    </button>
                    <button className="icon-btn danger" onClick={(ev) => { ev.stopPropagation(); remove(e); }} aria-label={`Delete ${e.name}`}>
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" strokeWidth="1.8" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M8 7l1 12h6l1-12"/></svg>
                    </button>
                  </span>
                </button>
              ))}
            </div>
          )}

          {entries && entries.length > 0 && (
            <div className="muted" style={{ padding: '12px 20px', borderTop: '1px solid #f4f4f5', display: 'flex', justifyContent: 'space-between' }}>
              <span>{filtered.length} of {entries.length} {entries.length === 1 ? 'item' : 'items'}{query && ` matching “${query}”`}</span>
              {openName && <span>1 selected</span>}
            </div>
          )}
        </div>

        <div className="card" style={{ flex: '1 1 360px', minWidth: 0, overflow: 'hidden' }}>
          {openName === null ? (
            <div className="empty-state" style={{ height: 220, border: 0 }}>
              <svg viewBox="0 0 24 24" width="32" height="32"><path fill="none" stroke="currentColor" strokeWidth="1.4" d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>
              <b>Select a text file</b>
              <span>View or edit its contents here.</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #f4f4f5', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileIcon entry={openEntry ?? { name: openName, type: 'file', size: 0, mode: '', mtime: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{openName}{dirty && <span className="muted"> · unsaved</span>}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{openEntry ? `${size(openEntry.size)} · Edited ${when(openEntry.mtime)}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="btn" style={{ height: 36 }} href={`/api/servers/${serverId}/files/download?path=${encodeURIComponent(join(path, openName))}`}>Download</a>
                  <button className="btn p" style={{ height: 36 }} onClick={save} disabled={!dirty || !!busy || !!editorNote}>Save</button>
                </div>
              </div>
              {editorNote ? <p className="muted" style={{ padding: 20, margin: 0 }}>{editorNote}</p> : (
                <textarea className="editor mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={`Contents of ${openName}`} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}