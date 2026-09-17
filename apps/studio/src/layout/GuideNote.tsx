import { X } from '@phosphor-icons/react';
import { Tip } from './Tip.js';

/**
 * One sentence from the guide, sitting in a surface's own slot (DESIGN.md,
 * "First use"). It only says; the surface around it is where the person acts.
 * It never takes focus, and its close leaves the surface exactly as it was.
 */
export function GuideNote({ text, closeLabel, onClose }: { text: string; closeLabel: string; onClose: () => void }) {
  return (
    <div className="sc-banner" data-tone="hint" data-guide="note" role="note">
      <span className="sc-banner-txt">{text}</span>
      <Tip label={closeLabel}>
        <button type="button" className="sc-coach-x" aria-label={closeLabel} onClick={onClose}>
          <X size={14} />
        </button>
      </Tip>
    </div>
  );
}
