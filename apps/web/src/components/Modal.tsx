import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';
import { animateModalClose, animateModalOpen } from '../motion';

export function Modal({ titleId, title, onClose, children, wide }: { titleId: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    animateModalClose(backdropRef.current, ref.current, onClose);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button, [href]')?.focus();
    const stopOpen = animateModalOpen(backdropRef.current, ref.current);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopOpen();
    };
  }, [handleClose]);

  return (
    <div ref={backdropRef} className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} style={wide ? { maxWidth: 640 } : undefined}>
        <div className="modal-head">
          <h2 id={titleId} className="card-title">{title}</h2>
          <button className="icon-btn" onClick={handleClose} aria-label="Close dialog"><IconClose /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
