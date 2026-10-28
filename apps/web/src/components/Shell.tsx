import { useState, type ReactNode } from 'react';
import { api, type Me } from '../api';
import { IconBot, IconActivity, IconBackup, IconKey, IconReceipt, IconServers, IconSupport } from './Icons';
import snbdLogo from '../assets/logo101.png';

const soon = (label: string, icon: ReactNode) => (
  <span className="nav-item disabled" aria-disabled="true" title={`${label} — coming soon`}>{icon}<span className="nav-label">{label}</span><span className="soon">Soon</span></span>
);

export function Shell({ me, onSignedOut, children, active = 'servers' }: { me: Me; onSignedOut: () => void; children: ReactNode; active?: 'servers' | 'keys' | 'activity' | 'agents' }) {
  const [collapsed, setCollapsed] = useState(false);
  
  return (
    <>
      <header className="top">
        <button 
          className="nav-toggle" 
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ transition: 'all 0.2s ease' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <polyline points="11 4 6 9 11 14"></polyline>
          </svg>
        </button>
        <a href="#/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', padding: collapsed ? '0 6px' : '0 4px' }}>
          <img src={snbdLogo} alt="SNBD HOST" style={{ height: 44, width: 'auto', display: 'block' }} />
        </a>
        <span className="grow" />
        <div className="account" style={{ transition: 'all 0.2s ease' }}>
          <span className="avatar" aria-hidden="true" style={{ background: 'linear-gradient(135deg, var(--red) 0%, #991b1b 100%)', boxShadow: '0 2px 8px rgba(213,12,45,0.3)' }}>{me.name.slice(0, 1).toUpperCase()}</span>
          {!collapsed && <span className="muted" style={{ fontSize: 13.5 }}>{me.name}</span>}
        </div>
        <button className="btn" onClick={() => api.logout().then(onSignedOut)}>{collapsed ? '←' : 'Sign out'}</button>
      </header>
      <div className={`layout ${collapsed ? 'collapsed' : ''}`}>
        <nav className="side" aria-label="Main">
          <a href="#/" className={`nav-item ${active === 'servers' ? 'on' : ''}`} aria-current={active === 'servers' ? 'page' : undefined} title="Servers"><IconServers /><span className="nav-label">Servers</span></a>
          <a href="#/keys" className={`nav-item ${active === 'keys' ? 'on' : ''}`} aria-current={active === 'keys' ? 'page' : undefined} title="SSH keys"><IconKey /><span className="nav-label">SSH keys</span></a>
          {soon('Backups', <IconBackup />)}
          <a href="#/agents" className={`nav-item ${active === 'agents' ? 'on' : ''}`} aria-current={active === 'agents' ? 'page' : undefined} title="MCP server"><IconBot /><span className="nav-label">MCP server</span></a>
          <a href="#/activity" className={`nav-item ${active === 'activity' ? 'on' : ''}`} aria-current={active === 'activity' ? 'page' : undefined} title="Activity"><IconActivity /><span className="nav-label">Activity</span></a>
          {!collapsed && <h6>Account</h6>}
          {soon('Billing & invoices', <IconReceipt />)}
          {soon('Support', <IconSupport />)}
          {!collapsed && (
            <div className="side-promo">
              <div className="side-promo-eyebrow">MCP server</div>
              <div className="side-promo-title">Your assistant, your servers.</div>
              <p>Claude Code or OpenCode can check status, read logs and restart services. Full access, every action logged.</p>
              <a href="#/agents" className="side-promo-link">Connect an AI client →</a>
            </div>
          )}
        </nav>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
