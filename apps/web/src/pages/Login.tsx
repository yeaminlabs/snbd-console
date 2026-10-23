import { useState, type FormEvent } from 'react';
import { api, type Me } from '../api';

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

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form className="card" style={{ width: '100%', maxWidth: 400, padding: 32 }} onSubmit={submit}>
        <div className="brand-mark" style={{ marginBottom: 4 }}>
          <span className="brand">S</span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>SNBD <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Console</span></span>
        </div>
        <h1 style={{ fontSize: 28, margin: '12px 0 24px' }}>Sign in</h1>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn p" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
