import type { ReactNode } from 'react';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const icon = (d: ReactNode) => ({ className }: { className?: string } = {}) => <svg {...base} className={className}>{d}</svg>;

export const IconServers = icon(<><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></>);
export const IconKey = icon(<><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H21M18 12v3" /></>);
export const IconBackup = icon(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>);
export const IconActivity = icon(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const IconReceipt = icon(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>);
export const IconSupport = icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /></>);
export const IconCopy = icon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>);
export const IconArrowUpRight = icon(<path d="M7 17L17 7M9 7h8v8" />);
export const IconBot = icon(<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /></>);
export const IconClose = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const IconChevronRight = icon(<path d="M9 6l6 6-6 6" />);
export const IconFile = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);
export const IconTerminal = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></>);
export const IconRestart = icon(<><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>);
export const IconCheckCircle = icon(<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.3 2.3L16 10" /></>);
