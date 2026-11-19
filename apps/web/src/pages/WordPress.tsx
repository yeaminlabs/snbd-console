import { useEffect, useState } from 'react';
import { api } from '../api';
import { ServerHeader } from '../components/ServerHeader';

export function WordPress({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState('');
  const [title, setTitle] = useState('');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [log, setLog] = useState('');

  const load = async () => {
    try {
      const s = await api.server(serverId);
      setServer(s);
      const wp = await api.wordpressList(serverId);
      setSites(wp.sites);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [serverId]);

  useEffect(() => {
    if (!jobId || !server?.agentConnected) return;
    let dead = false;
    const poll = async () => {
      try {
        const j = await api.job(serverId, jobId, 0);
        setLog((l) => l + j.log);
        if (j.status === 'done' || j.status === 'failed') {
          setJobId(null);
          load();
          return;
        }
        if (!dead) setTimeout(poll, 1500);
      } catch {}
    };
    poll();
    return () => { dead = true; };
  }, [jobId, server?.agentConnected]);

  const install = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.wordpressInstall(serverId, { domain, title: title || domain, adminUser, adminEmail: adminEmail || `admin@${domain}` });
      setJobId(res.jobId);
      setLog('');
      setShowForm(false);
      setDomain(''); setTitle(''); setAdminEmail('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteSite = async (id: string, d: string) => {
    if (!confirm(`Delete WordPress site ${d}? This will remove files from the server.`)) return;
    try {
      await api.wordpressDelete(serverId, id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const login = async (id: string) => {
    try {
      const res = await api.wordpressLogin(serverId, id);
      window.open(res.adminUrl, '_blank');
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;

  return (
    <>
      <ServerHeader server={server} tab="wordpress" />
      <section className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>WordPress sites</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Install and manage WordPress on this VPS</p>
          </div>
          {server?.agentConnected && <button className="btn p" onClick={() => setShowForm(true)}>Install WordPress</button>}
        </div>
        {!server?.agentConnected && <div className="notice" style={{ margin: 20 }}>Panel agent offline - WordPress management unavailable.</div>}
        {error && <p className="error" style={{ margin: '16px 20px' }}>{error}</p>}
        {jobId && (
          <div style={{ margin: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Installing WordPress…</div>
            <pre style={{ background: '#0f0f0f', color: '#e5e5e5', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: 300, fontSize: 12 }}>{log || 'Starting...'}</pre>
          </div>
        )}
        {sites.length === 0 && !jobId && !showForm && (
          <div className="empty-state" style={{ height: 200 }}>
            <div style={{ fontSize: 40 }}>📝</div>
            <b>No WordPress sites</b>
            <span>Install your first WordPress site on this server</span>
          </div>
        )}
        {sites.length > 0 && (
          <div style={{ padding: 0 }}>
            {sites.map((site) => (
              <div key={site.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{site.domain}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Admin: {site.admin_user || 'admin'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => login(site.id)}>Login to Admin</button>
                  <button className="btn danger" onClick={() => deleteSite(site.id, site.domain)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 480, maxWidth: '90vw', padding: 24 }}>
            <h3 style={{ margin: '0 0 16px' }}>Install WordPress</h3>
            <form onSubmit={install} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Domain</label>
                <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Site Title</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Website" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Admin Username</label>
                <input className="input" value={adminUser} onChange={(e) => setAdminUser(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Admin Email</label>
                <input className="input" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn p" disabled={busy}>{busy ? 'Installing...' : 'Install'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
