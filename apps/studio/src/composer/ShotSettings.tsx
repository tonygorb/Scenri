import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal } from '@phosphor-icons/react';
import { FORMATS } from './BriefInput.js';

export type QualityId = 'draft' | 'standard' | 'high';
/** Quality is the long edge we ask the engine for; aspect keeps the shape. */
export const QUALITIES: { id: QualityId; label: string; edge: number; note: string }[] = [
  { id: 'draft', label: 'Draft', edge: 768, note: 'fast look-see' },
  { id: 'standard', label: 'Standard', edge: 1024, note: 'everyday shots' },
  { id: 'high', label: 'High', edge: 1536, note: 'print and hero use' },
];

/**
 * Aspect, variants and quality for a phone. The row cannot hold six controls at
 * 390px, so below 768px these three collapse into one chip and come back as a
 * sheet under the thumb.
 *
 * Three named rows, each with every one of its answers on show. A dropdown per
 * row would have read tidier and cost two taps and a second surface for a
 * choice of four; here the whole state is legible at a glance and a change is
 * one tap. Nothing closes the sheet: the point of opening it is often to set
 * two things, and the scrim is always right there.
 *
 * The chip and the desktop pills render together and CSS picks one, so there is
 * no breakpoint in JS and no second copy of the state: both drive the same
 * prefs held by the Composer.
 */
export function ShotSettings({
  mode,
  formatId,
  onFormat,
  count,
  onCount,
  quality,
  onQuality,
}: {
  mode: 'generation' | 'edit';
  formatId: string;
  onFormat: (id: string) => void;
  count: number;
  onCount: (n: number) => void;
  quality: QualityId;
  onQuality: (q: QualityId) => void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const from = useRef<{ y: number; t: number } | null>(null);
  const moved = useRef(0);

  /**
   * The bar at the top is a real handle, not a picture of one: a sheet that
   * shows the affordance and then refuses the gesture is worse than a sheet
   * with no bar at all. Pointer events rather than touch, so a trackpad drag
   * behaves the same as a thumb.
   */
  const grab = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    from.current = { y: e.clientY, t: e.timeStamp };
    moved.current = 0;
    if (sheet.current) sheet.current.style.transition = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    if (!from.current || !sheet.current) return;
    // down only: an upward pull has nowhere to go
    moved.current = Math.max(0, e.clientY - from.current.y);
    sheet.current.style.transform = `translateY(${moved.current}px)`;
  };
  const release = (e: React.PointerEvent<HTMLElement>) => {
    const start = from.current;
    from.current = null;
    if (!start || !sheet.current) return;
    sheet.current.style.transition = '';
    // a short flick is as clear an intention as a long drag
    const speed = moved.current / Math.max(1, e.timeStamp - start.t);
    if (moved.current > 96 || speed > 0.45) {
      // the transform stays put: the exit animation outranks it in the cascade
      // and carries on from where the thumb left off
      setOpen(false);
      return;
    }
    sheet.current.style.transform = '';
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="sc-var sc-shotset" aria-label="Shot settings" title="Shot settings">
          <SlidersHorizontal size={16} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet"
          aria-describedby={undefined}
          /* Radix would otherwise pull focus to the chip, and the next
             keystroke meant for the brief would be lost */
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="sc-shotsheet-grip"
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <span className="sc-shotsheet-bar" aria-hidden />
            {/* the three named rows below say what this is; the heading is for
                the screen reader that cannot see them yet */}
            <Dialog.Title className="sc-vh">Shot settings</Dialog.Title>
          </div>

          <Field label="Aspect ratio">
            {FORMATS.map((f) => (
              <Opt key={f.id} on={f.id === formatId} label={f.label} onClick={() => onFormat(f.id)}>
                {f.hint}
              </Opt>
            ))}
          </Field>

          {mode === 'generation' && (
            /* Variants, not versions: these are the images one brief returns.
               A version is a branch off a finished shot, which is a different
               thing entirely, and the desktop pills for this same state have
               always said variants. CSS picks which of the two you see, so a
               disagreement here changed the word when the window narrowed. */
            <Field label="Variants">
              {[1, 2, 3, 4].map((n) => (
                <Opt key={n} on={n === count} label={`${n} variant${n === 1 ? '' : 's'}`} onClick={() => onCount(n)}>
                  {n}
                </Opt>
              ))}
            </Field>
          )}

          <Field label="Quality">
            {QUALITIES.map((q) => (
              <Opt key={q.id} on={q.id === quality} label={`${q.label}, ${q.edge}px`} onClick={() => onQuality(q.id)}>
                {q.label}
              </Opt>
            ))}
          </Field>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A named setting and every answer it has, on one line where there is room.
 * The name is a caption, not a group label: every option states itself in full
 * through its own aria-label ("Square", "2 variants", "Draft, 768px"), so a
 * screen reader gets the whole answer without a wrapper role.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sc-shotfield">
      <span className="sc-shotfield-lb">{label}</span>
      <div className="sc-seg">{children}</div>
    </div>
  );
}

/** The shown text is short enough to fit four across, so the long form is the label. */
function Opt({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sc-seg-o"
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
