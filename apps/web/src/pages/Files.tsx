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
  useEffect(() => { setOpenName(null); setEditorNote(''); load(); }, [serverId, path]);

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

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const queue = Array.from(files);
    (async () => {
      for (const f of queue) {
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
    })();
  }

  const crumbs = path.split('/').filter(Boolean);
  const openEntry = entries?.find((e) => e.name === openName);

  return (
    <>
      <ServerHeader server={server} tab="files" />
      <div className="head-row" style={{ marginTop: 24 }}>
        <nav className="mono crumbs" aria-label="Folder path">
          <a href="#" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, '/'); }}>/</a>
          {crumbs.map((c, i) => {
            const to = '/' + crumbs.slice(0, i + 1).join('/');
            return <span key={to}>{i > 0 && <span className="muted">/</span>}{i === crumbs.length - 1 ? <b style={{ fontWeight: 500 }}>{c}</b> : <a href="#" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, to); }}>{c}</a>}</span>;
          })}
        </nav>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={newFile} disabled={!!busy}>New file</button>
          <button className="btn" onClick={newFolder} disabled={!!busy}>New folder</button>
          <button className="btn p" onClick={() => fileInput.current?.click()} disabled={!!busy}>Upload</button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="Choose files to upload" />
        </div>
      </div>
      {(busy || error) && (
        <div role="status" style={{ marginTop: 12 }}>
          {busy && <span className="muted">{busy}{progress !== null && ` ${progress}%`}</span>}
          {error && <span className="error" role="alert" style={{ margin: 0 }}>{error}</span>}
        </div>
      )}

      <div className="cols" style={{ marginTop: 16 }}>
        <div className="card grow-lg" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div className="fr th" style={{ borderTop: 0 }}><span /><span>Name</span><span>Size</span><span>Modified</span><span>Mode</span><span /></div>
              {path !== '/' && (
                <div className="fr"><span /><a href="#" className="fname" onClick={(e) => { e.preventDefault(); confirmDiscard() && go(serverId, parentOf(path)); }}>..</a><span /><span /><span /><span /></div>
              )}
              {entries?.map((e) => (
                <div className={`fr ${openName === e.name ? 'sel' : ''}`} key={e.name}>
                  <span className="muted" aria-hidden="true">{e.type === 'dir' ? '▸' : ''}</span>
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
          <div className="muted" style={{ padding: '12px 20px', borderTop: '1px solid #f4f4f5' }}>
            {entries ? `${entries.length} ${entries.length === 1 ? 'item' : 'items'}${openName ? ' · 1 selected' : ''}` : error ? 'Could not load this folder' : 'Loading…'}
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 360px', minWidth: 0, overflow: 'hidden' }}>
          {openName === null ? (
            <p className="muted" style={{ padding: 20, margin: 0 }}>Select a text file to view or edit it.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #f4f4f5', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{openName}{dirty && <span className="muted"> · unsaved</span>}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{openEntry ? `${size(openEntry.size)} · Edited ${when(openEntry.mtime)}` : ''}</div>
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
