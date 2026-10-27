import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server, type SshKey } from '../api';
import { Modal } from '../components/Modal';
import { IconKey } from '../components/Icons';
import { ago } from '../format';

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* the text stays selectable */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

function downloadText(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Shows a generated private half one time, with how to use it. */
function PrivateKeyModal({ keyName, privateKey, onClose, onSaved }: { keyName: string; privateKey: string; onClose: () => void; onSaved: () => void }) {
  const fileName = `id_ed25519_${keyName.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
  return (
    <Modal titleId="pk-h" title={`${keyName} — private key`} onClose={onClose}>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
        <b style={{ color: 'var(--ink)' }}>Copy it now.</b> This is shown only once — the panel never stores a private key.
      </p>
      <pre className="codebox mono" tabIndex={0} style={{ marginTop: 12, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{privateKey}</pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Copy text={privateKey} label="Copy private key" />
        <button className="btn" onClick={() => downloadText(fileName, privateKey)}>Download as {fileName}</button>
      </div>
      <h3 style={{ fontSize: 13.5, margin: '18px 0 4px' }}>Keep it safe on your computer</h3>
      <div className="codebox mono" tabIndex={0}>chmod 600 {fileName}</div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Then connect with <span className="mono">ssh -i {fileName} root@your-server-ip</span> when the key is installed on a server.</p>
      <div style={{ marginTop: 18 }}>
        <button className="btn p" onClick={onSaved}>I have saved the private key</button>
      </div>
    </Modal>
  );
}

/** Pick servers to install or remove the key on. */
function InstallModal({ keyData, servers, onClose, onChanged }: { keyData: SshKey; servers: Server[]; onClose: () => void; onChanged: () => void }) {
  const installed = new Set(keyData.servers.map((s) => s.id));
  const usable = servers.filter((s) => s.managedBy !== 'whmcs');
  const [sel, setSel] = useState<Set<string>>(new Set(usable.filter((s) => installed.has(s.id)).map((s) => s.id)));
  const [busy, setBusy] = useState<'' | 'install' | 'uninstall'>('');
  const [error, setError] = useState('');

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const list = usable.filter((s) => !s.suspended_at && s.status !== 'stopped');
  const go = async (mode: 'install' | 'uninstall') => {
    setBusy(mode); setError('');
    try {
      if (mode === 'install') await api.installKey(keyData.id, [...sel]);
      else await api.uninstallKey(keyData.id, [...sel]);
      onChanged(); onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(''); }
  };

  return (
    <Modal titleId="im-h" title={`${keyData.name} — servers`} onClose={onClose}>
      <p className="muted" style={{ margin: '8px 0 12px', fontSize: 13.5 }}>The key is added to <span className="mono">root</span>'s <span className="mono">authorized_keys</span> on the servers you select. Only servers with a connected agent can be changed.</p>
      {list.length === 0 && <p className="muted">You have no eligible servers yet. Connect a server to the console first.</p>}
      <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto' }}>
        {list.map((s) => {
          const on = installed.has(s.id);
          return (
            <label key={s.id} className="check" style={{ margin: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-2)', minHeight: 0 }}>
              <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
              <span style={{ flex: 1, minHeight: 0 }}>{s.name}</span>
              <span className={`badge ${on ? 'ok' : s.agentConnected ? 'info' : 'off'}`} style={{ fontSize: 11 }}>
                <span className="dot" style={{ animation: 'none' }} />{on ? 'Installed' : s.agentConnected ? 'Ready' : 'Agent offline'}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <span className="grow" />
        <button className="btn danger" disabled={busy !== ''} onClick={() => go('uninstall')}>{busy === 'uninstall' ? 'Removing…' : 'Remove from selected'}</button>
        <button className="btn p" disabled={busy !== '' || sel.size === 0} onClick={() => go('install')}>{busy === 'install' ? 'Installing…' : 'Install on selected'}</button>
      </div>
    </Modal>
  );
}

export function Keys() {
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; privateKey: string } | null>(null);
  const [installing, setInstalling] = useState<SshKey | null>(null);
  const [confirming, setConfirming] = useState<SshKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.keys().then((r) => setKeys(r.keys)).catch((e) => setError(e.message));
    api.servers().then(setServers).catch(() => {});
  }, []);

  const refresh = () => api.keys().then((r) => setKeys(r.keys)).catch((e) => setError(e.message));

  async function destroy(k: SshKey) {
    setBusy(true); setError('');
    try {
      await api.deleteKey(k.id);
      setConfirming(null);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>SSH keys</h1>
          <div className="muted" style={{ marginTop: 4 }}>Your personal keys for signing in to your servers. The panel never stores a private half you generate here.</div>
        </div>
        <button className="btn p" onClick={() => setCreating(true)}>Add key</button>
      </div>
      {error && <p className="error" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      {keys === null && !error && <div className="skeleton" style={{ height: 120, marginTop: 24 }} />}
      {keys && keys.length === 0 && (
        <div className="empty-state" style={{ marginTop: 24 }}>
          <IconKey />
          <b>No SSH keys yet</b>
          <span>Generate a key here and install it on any server connected to the console.</span>
        </div>
      )}
      {keys && keys.length > 0 && (
        <div className="card" style={{ marginTop: 24, overflow: 'hidden' }}>
          {keys.map((k) => (
            <div key={k.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '14px 20px', borderTop: '1px solid var(--line-2)' }}>
              <span className="ficon" style={{ background: 'var(--red-tint)', color: 'var(--red-dark)' }}><IconKey /></span>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{k.name}</div>
                <div className="muted mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{k.fingerprint}</div>
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {k.keyType === 'ssh-ed25519' ? 'Ed25519' : 'RSA'} · {k.servers.length === 0 ? 'Not installed' : `Installed on ${k.servers.map((s) => s.name).join(', ')}`} · added {ago(k.createdAt)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setInstalling(k)}>{k.servers.length === 0 ? 'Install' : 'Manage'}</button>
                <button className="btn danger" onClick={() => setConfirming(k)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(name, privateKey) => { setCreating(false); refresh(); setFresh(privateKey ? { name, privateKey } : null); }} />}

      {fresh && <PrivateKeyModal keyName={fresh.name} privateKey={fresh.privateKey} onClose={onDismissFresh} onSaved={onDismissFresh} />}
      {installing && <InstallModal key={installing.id} keyData={installing} servers={servers} onClose={() => setInstalling(null)} onChanged={refresh} />}
      {confirming && (
        <Modal titleId="cd-h" title={`Delete ${confirming.name}?`} onClose={() => setConfirming(null)}>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
            The key is removed from every server where it is installed, then deleted here. If a server's agent is offline nothing is deleted — reconnect it first.
          </p>
          <p className="muted" style={{ fontSize: 13.5 }}>You cannot undo this. Keep another way to sign in (password access stays available from the server page).</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirming(null)}>Cancel</button>
            <button className="btn danger" disabled={busy} onClick={() => destroy(confirming)}>{busy ? 'Deleting…' : 'Delete key everywhere'}</button>
          </div>
        </Modal>
      )}
    </>
  );

  function onDismissFresh() { setFresh(null); }
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, privateKey: string) => void }) {
  const [mode, setMode] = useState<'generate' | 'import'>('generate');
  const [name, setName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.createKey(name, mode, mode === 'import' ? publicKey : undefined);
      onCreated(r.key.name, r.privateKey ?? '');
    } catch (e2) {
      setError((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titleId="ck-h" title="Add an SSH key" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="seg" role="tablist" style={{ marginTop: 12 }}>
          <button type="button" className={`btn ${mode === 'generate' ? 'on' : ''}`} onClick={() => setMode('generate')}>Generate</button>
          <button type="button" className={`btn ${mode === 'import' ? 'on' : ''}`} onClick={() => setMode('import')}>Import</button>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="key-name">Name</label>
          <input id="key-name" className="input" required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'generate' ? 'work laptop' : 'home desktop'} />
        </div>
        {mode === 'generate' ? (
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>An Ed25519 keypair is created now. The public half is saved; the private half is shown once for you to download.</p>
        ) : (
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="key-pub">Public key</label>
            <textarea id="key-pub" className="input mono" rows={3} required value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="ssh-ed25519 AAAA... you@computer" />
            <span className="muted" style={{ fontSize: 12.5 }}>Paste the contents of your <span className="mono">id_ed25519.pub</span>. Only the public half, never the private one.</span>
          </div>
        )}
        {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn p" disabled={busy || !name.trim() || (mode === 'import' && !publicKey.trim())}>{busy ? 'Working…' : 'Create key'}</button>
        </div>
      </form>
    </Modal>
  );
}
