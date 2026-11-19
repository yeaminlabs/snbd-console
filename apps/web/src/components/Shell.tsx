import { useState, type ReactNode } from 'react';
import { api, type Me } from '../api';
import { IconServers, IconReport, IconBackup, IconNotifications, IconFinance, IconSettings, IconHelp, IconBot, IconActivity, IconKey } from './Icons';
import snbdLogo from '../assets/logo_1000.png';

type NavItem = { id: string; label: string; icon: ReactNode; href: string; badge?: boolean };

const NAV: NavItem[] = [
  { id: 'servers', label: 'Servers', icon: <IconServers />, href: '#/' },
  { id: 'keys', label: 'SSH keys', icon: <IconKey />, href: '#/keys' },
  { id: 'agents', label: 'MCP server', icon: <IconBot />, href: '#/agents' },
  { id: 'activity', label: 'Activity', icon: <IconActivity />, href: '#/activity' },
];

const ACCOUNT: { id: string; label: string; icon: ReactNode; href: string }[] = [
  { id: 'settings', label: 'Settings', icon: <IconSettings />, href: '#/settings' },
  { id: 'help', label: 'Help', icon: <IconHelp />, href: '#/help' },
];

export function Shell({ me, onSignedOut, children, active = 'servers', dashboard = false }: { me: Me; onSignedOut: () => void; children: ReactNode; active?: string; dashboard?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    ...NAV,
    { id: 'reports', label: 'Reports', icon: <IconReport />, href: '#' },
    { id: 'backups', label: 'Backups', icon: <IconBackup />, href: '#' },
    { id: 'notifications', label: 'Notifications', icon: <IconNotifications />, href: '#', badge: true },
    { id: 'finances', label: 'Finances', icon: <IconFinance />, href: '#' },
  ];

  return (
    <>
      <header className={`top ${dashboard ? 'dashboard-top' : ''}`}>
        <button
          className="nav-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <polyline points="11 4 6 9 11 14" />
          </svg>
        </button>
        <a href="#/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', padding: collapsed ? '0 6px' : '0 4px' }}>
          <img src={snbdLogo} alt="SNBD HOST" style={{ height: 44, width: 'auto', display: 'block' }} />
        </a>
        <a href="https://snbdhost.com/eu-vps" target="_blank" rel="noreferrer" className="header-promo" title="Cheapest EU VPS — from $11.97/mo">
          <span className="header-promo-price">from $11.97/mo</span>
          <span className="header-promo-text">Cheapest EU VPS for your next project idea — build without hassle, do it right with SNBD Host →</span>
        </a>
        <span className="grow" />
        <div className="account" style={{ transition: 'all 0.2s ease' }}>
          <span className="avatar" aria-hidden="true" style={{ background: 'linear-gradient(135deg, var(--red) 0%, #991b1b 100%)', boxShadow: '0 2px 8px rgba(213,12,45,0.3)' }}>{me.name.slice(0, 1).toUpperCase()}</span>
          {!collapsed && <span className="muted" style={{ fontSize: 13.5 }}>{me.name}</span>}
        </div>
        <button className="btn" onClick={() => api.logout().then(onSignedOut)}>{collapsed ? '←' : 'Sign out'}</button>
      </header>
      <div className={`layout ${collapsed ? 'collapsed' : ''} ${dashboard ? 'dashboard-layout' : ''}`}>
        <nav className="side" aria-label="Main">
          <div className="sidebar-brand" style={{ padding: collapsed ? '0 8px' : '16px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed ? 10 : 18 }}>
            <span className="brand-mark" style={{ background: 'var(--red)', color: '#fff', width: 26, height: 26, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{me.name.slice(0, 1).toUpperCase()}</span>
            {!collapsed && <span className="brand-name" style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.02em', color: '#fff' }}>s.host</span>}
          </div>
          <div className="nav-section">
            {navItems.map((item) => {
              const isActive = item.id === active;
              const cls = ['nav-item', isActive ? 'on' : '', item.badge ? ' has-badge' : ''].join(' ');
              return (
                <a key={item.id} className={cls} href={item.href} style={{ color: isActive ? '#fff' : 'var(--ink-2)', background: isActive ? '#22c55e' : 'transparent' }}>
                  {item.icon}
                  {!collapsed && <span className="nav-label">{item.label}</span>}
                  {item.badge && <span className="nav-badge">!</span>}
                </a>
              );
            })}
          </div>
          <div className="nav-section" style={{ marginTop: 10 }}>
            {ACCOUNT.map((item) => (
              <a key={item.id} className="nav-item" href={item.href} style={{ color: 'var(--ink-2)', background: 'transparent' }}>
                {item.icon}
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </a>
            ))}
          </div>
          <div className="sidebar-spacer" />
          {!collapsed && (
            <div className="sidebar-account">
              <button className="sidebar-account-btn" onClick={() => {}} aria-label="Account">
                <img src={snbdLogo} alt="" className="sidebar-account-avatar" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)' }} />
                <div className="sidebar-account-info">
                  <div className="sidebar-account-name">{me.name}</div>
                  <div className="sidebar-account-email">{me.email}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', flexShrink: 0, marginLeft: 6 }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
          )}
        </nav>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
