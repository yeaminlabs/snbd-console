import type { ReactNode } from 'react';
import { api, type Me } from '../api';
import { IconActivity, IconBackup, IconKey, IconReceipt, IconServers, IconSupport } from './Icons';

const soon = (label: string, icon: ReactNode) => (
  <span className="nav-item disabled" aria-disabled="true">{icon}{label}<span className="soon">Soon</span></span>
);

export function Shell({ me, onSignedOut, children, active = 'servers' }: { me: Me; onSignedOut: () => void; children: ReactNode; active?: 'servers' | 'activity' }) {
  return (
    <>
      <header className="top">
        <span className="brand">SNBD</span>
        <span style={{ fontWeight: 600, fontSize: 18 }}>Console</span>
        <span className="grow" />
        <span className="muted">{me.name}</span>
        <button className="btn" onClick={() => api.logout().then(onSignedOut)}>Sign out</button>
      </header>
      <div className="layout">
        <nav className="side" aria-label="Main">
          <a href="#/" className={`nav-item ${active === 'servers' ? 'on' : ''}`} aria-current={active === 'servers' ? 'page' : undefined}><IconServers />Servers</a>
          {soon('SSH keys', <IconKey />)}
          {soon('Backups', <IconBackup />)}
          <a href="#/activity" className={`nav-item ${active === 'activity' ? 'on' : ''}`} aria-current={active === 'activity' ? 'page' : undefined}><IconActivity />Activity</a>
          <h6>Account</h6>
          {soon('Billing & invoices', <IconReceipt />)}
          {soon('Support', <IconSupport />)}
        </nav>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
