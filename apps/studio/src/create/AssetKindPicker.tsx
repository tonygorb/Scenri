import { useEffect, useRef } from 'react';
import { Dialog } from '@radix-ui/themes';
import { CaretRight, FilmSlate, IdentificationBadge, Package, X } from '@phosphor-icons/react';
import type { CreateKind } from '../createDraft.js';

/**
 * The three things a shot is made from, as three rows.
 *
 * Rows rather than tiles, deliberately: three side-by-side icon-heading-text
 * cards is the generic-dashboard grid this system rejects by name, and this is
 * a menu — a thing you pass through, not a thing you look at. The glyphs are
 * the nav's own, so a row is recognisable before its label is read.
 *
 * The order never changes with the page you happen to be on. Only focus moves:
 * on Presenters, the presenter row is where the keyboard lands. Reordering
 * furniture per screen would spend the recognition those shared glyphs buy.
 */
const KINDS: { kind: CreateKind; label: string; line: string; icon: typeof Package }[] = [
  { kind: 'product', label: 'Product', line: 'Packshots of a thing you sell', icon: Package },
  { kind: 'presenter', label: 'Presenter', line: 'One person, the same every time', icon: IdentificationBadge },
  { kind: 'scene', label: 'Scene', line: 'A place, its light and materials', icon: FilmSlate },
];

export function AssetKindPicker({ suggest, onPick }: { suggest: CreateKind | null; onPick: (k: CreateKind) => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  /** The row for the page you are on, or the first. Radix's own default lands
   *  on the close button, which is the one control nobody opened this to press. */
  const focusRow = () => {
    const row = listRef.current?.querySelector<HTMLButtonElement>(suggest ? `[data-kind="${suggest}"]` : '[data-kind]');
    row?.focus();
  };
  useEffect(focusRow, [suggest]);

  return (
    <Dialog.Content
      className="sc-newdlg"
      maxWidth="380px"
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        focusRow();
      }}
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <div className="sc-newdlg-head">
        <Dialog.Title className="sc-newdlg-title">Add to this brand</Dialog.Title>
        <Dialog.Close>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </Dialog.Close>
      </div>
      <p className="sc-newdlg-sub">The three things every shot is made from.</p>

      <div className="sc-newlist" ref={listRef}>
        {KINDS.map(({ kind, label, line, icon: Icon }) => (
          <button type="button" key={kind} className="sc-newrow" data-kind={kind} onClick={() => onPick(kind)}>
            <span className="sc-newrow-ico">
              <Icon size={19} />
            </span>
            <span className="sc-newrow-txt">
              <b>{label}</b>
              <small>{line}</small>
            </span>
            <CaretRight size={13} className="sc-newrow-go" />
          </button>
        ))}
      </div>
    </Dialog.Content>
  );
}
