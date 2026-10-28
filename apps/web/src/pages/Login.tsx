import { useState, type FormEvent } from 'react';
import { api, type Me } from '../api';

const isDev = import.meta.env.DEV;

export function Login({ onSignedIn }: { onSignedIn: (m: Me) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api.login(String(f.get('email')), String(f.get('password'))));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function devSkip() {
    if (!isDev) return;
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api.login('demo@snbd.test', 'demo-password'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form className="card" style={{ width: '100%', maxWidth: 400, padding: 32 }} onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
          <img src="/src/assets/logo101.png" alt="SNBD HOST" style={{ height: 80, width: 'auto', display: 'block' }} />
        </div>
        <h1 style={{ fontSize: 28, margin: '12px 0 24px' }}>Sign in</h1>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn p" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {isDev && (
          <button type="button" className="btn" style={{ width: '100%', marginTop: 8 }} onClick={devSkip} disabled={busy}>
            {busy ? 'Signing in…' : 'Skip login (dev)'}
          </button>
        )}
      </form>
    </main>
  );
}
