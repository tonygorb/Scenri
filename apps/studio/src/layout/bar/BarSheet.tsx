import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSheetDrag } from '../../useSheetDrag.js';

/**
 * A panel off the bottom edge, for a phone. The top right corner of a phone is
 * the furthest point from a thumb, so a card anchored there is a popover in name
 * only; the studio's other panels already come up from the bottom with a grip
 * that is a real handle, and these are those.
 *
 * Escape and an outside press are what a sheet owes you. Radix gives the pointer
 * surfaces theirs for free, and this is the half of the app that has to earn
 * them. The drag comes from the app's own hook, thresholds and all, and the exit
 * animation deliberately outranks the inline transform the hook leaves behind,
 * so a dismissed sheet carries on from where the thumb left it.
 */
export function BarSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { sheet, grip } = useSheetDrag(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="sc-notif-scrim" onClick={onClose} aria-hidden />
      <div ref={sheet} className="sc-notif-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sc-shotsheet-grip" {...grip}>
          <span className="sc-shotsheet-bar" aria-hidden />
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
