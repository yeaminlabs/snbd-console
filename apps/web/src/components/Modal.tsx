import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';

export function Modal({ titleId, title, onClose, children }: { titleId: string; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button, [href]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId} className="card-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><IconClose /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
