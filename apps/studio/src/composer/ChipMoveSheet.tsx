import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Trash } from '@phosphor-icons/react';
import { useSheetDrag } from '../useSheetDrag.js';
import type { CloseReason } from './IngredientPicker.js';

/**
 * The touch door for a reference or brand-mark chip.
 *
 * These chips have nothing to swap to, so they never earned a picker — which
 * on a phone left a tap with nothing to do but raise the software keyboard,
 * while the chip's own label promised "Remove or move". This is the smallest
 * honest answer: the same sheet shell every other chip already opens, holding
 * exactly the two verbs a reference has. Touch-only by construction: the
 * pointer has the drag and the keyboard has Alt+Arrow, so BriefInput routes
 * only its touch path here.
 */
export function ChipMoveSheet({
  kind,
  label,
  thumb,
  onInspect,
  onMove,
  onRemove,
  onClose,
}: {
  kind: 'ref' | 'mark';
  label: string;
  thumb: string | null;
  /** Tapping the picture opens it full size: a finger's way to the lightbox. */
  onInspect: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onClose: (reason: CloseReason) => void;
}) {
  const { sheet, grip } = useSheetDrag(() => onClose('dismiss'));
  const noun = kind === 'mark' ? 'brand mark' : 'reference image';

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose('dismiss')}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet sc-swapsheet"
          data-kind={kind}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            sheet.current?.focus({ preventScroll: true });
          }}
          // Radix would hand focus back to the chip, and the chip is inside a
          // contenteditable: the software keyboard would come straight up.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose('escape');
          }}
        >
          <div className="sc-shotsheet-grip" {...grip}>
            <span className="sc-shotsheet-bar" aria-hidden />
            <Dialog.Title className="sc-vh">Move or remove {noun}</Dialog.Title>
          </div>
          <div className="sc-movesheet-head">
            {/* The src is the token's own hash, so a 404 here means the image
                is genuinely gone: drop to the label rather than let the browser
                draw its broken-image glyph, which is what the chip does too. */}
            {thumb && (
              <button type="button" className="sc-movesheet-face" onClick={onInspect} aria-label={`Open ${noun}`}>
                <img src={thumb} alt="" onError={(e) => e.currentTarget.remove()} />
              </button>
            )}
            <span className="sc-movesheet-txt">
              <b dir="auto">{label || noun}</b>
              <span>{noun}</span>
            </span>
          </div>
          <div className="sc-swap-foot">
            <div className="sc-swap-move">
              {/* the same move, the same announcement, as Alt+Arrow; the
                  sheet stays open so the chip can keep walking */}
              <button type="button" className="sc-btn" onClick={() => onMove(-1)}>
                <ArrowLeft size={13} /> Move earlier
              </button>
              <button type="button" className="sc-btn" onClick={() => onMove(1)}>
                Move later <ArrowRight size={13} />
              </button>
            </div>
            <button type="button" className="sc-swap-remove" onClick={onRemove}>
              <Trash size={13} />
              Remove {kind === 'mark' ? 'mark' : 'reference'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
