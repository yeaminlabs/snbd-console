import type { ReactNode } from 'react';
import { api, type Me } from '../api';
import { IconBot, IconActivity, IconBackup, IconKey, IconReceipt, IconServers, IconSupport } from './Icons';

const soon = (label: string, icon: ReactNode) => (
  <span className="nav-item disabled" aria-disabled="true" title={`${label} — coming soon`}>{icon}{label}<span className="soon">Soon</span></span>
);

export function Shell({ me, onSignedOut, children, active = 'servers' }: { me: Me; onSignedOut: () => void; children: ReactNode; active?: 'servers' | 'keys' | 'activity' | 'agents' }) {
  return (
    <>
      <header className="top">
        <a href="#/" className="brand-mark">
          <span className="brand">S</span>
          <span className="product-name">SNBD Console</span>
        </a>
        <span className="grow" />
        <div className="account">
          <span className="avatar" aria-hidden="true">{me.name.slice(0, 1).toUpperCase()}</span>
          <span className="muted" style={{ fontSize: 13.5 }}>{me.name}</span>
        </div>
        <button className="btn" onClick={() => api.logout().then(onSignedOut)}>Sign out</button>
      </header>
      <div className="layout">
        <nav className="side" aria-label="Main">
          <a href="#/" className={`nav-item ${active === 'servers' ? 'on' : ''}`} aria-current={active === 'servers' ? 'page' : undefined}><IconServers />Servers</a>
          <a href="#/keys" className={`nav-item ${active === 'keys' ? 'on' : ''}`} aria-current={active === 'keys' ? 'page' : undefined}><IconKey />SSH keys</a>
          {soon('Backups', <IconBackup />)}
          <a href="#/agents" className={`nav-item ${active === 'agents' ? 'on' : ''}`} aria-current={active === 'agents' ? 'page' : undefined}><IconBot />MCP server</a>
          <a href="#/activity" className={`nav-item ${active === 'activity' ? 'on' : ''}`} aria-current={active === 'activity' ? 'page' : undefined}><IconActivity />Activity</a>
          <h6>Account</h6>
          {soon('Billing & invoices', <IconReceipt />)}
          {soon('Support', <IconSupport />)}
          <div className="side-promo">
            <div className="side-promo-eyebrow">MCP server</div>
            <div className="side-promo-title">Your assistant, your servers.</div>
            <p>Claude Code or OpenCode can check status, read logs and restart services. Full access, every action logged.</p>
            <a href="#/agents" className="side-promo-link">Connect an AI client →</a>
          </div>
        </nav>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
