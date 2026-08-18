import { useEffect, useRef } from 'react';
import { FilmSlate, IdentificationBadge, Package, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import type { CreateKind } from '../createDraft.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';
import { useKindPreview } from './useKindPreview.js';

/**
 * Choosing which of the three to make.
 *
 * Three pictures rather than three text rows, because all three are visual
 * objects and a word for "scene" tells you far less than a room does. The
 * pictures are this brand's own — the newest product, a presenter they cast, a
 * place they built — so the dialog is a window onto their library rather than
 * a poster, and it is different on every machine.
 *
 * One press, not two. A picture is the choice and the choice is the action, so
 * there is no selected state to confirm and no Continue button under it. The
 * two-step version of this reads as a form about a decision instead of the
 * decision itself.
 *
 * Everything stays monochrome: the images carry all the colour, the chrome
 * carries none, and nothing here reaches for the one accent this system keeps
 * for credits and shimmer.
 */
const KINDS: {
  kind: CreateKind;
  label: string;
  line: string;
  noun: string;
  icon: typeof Package;
}[] = [
  { kind: 'product', label: 'Product', line: 'What you are photographing', noun: 'product', icon: Package },
  {
    kind: 'presenter',
    label: 'Presenter',
    line: 'Who appears in the shot',
    noun: 'presenter',
    icon: IdentificationBadge,
  },
  { kind: 'scene', label: 'Scene', line: 'Where it takes place', noun: 'scene', icon: FilmSlate },
];

const held = (n: number, noun: string) => (n === 0 ? 'None yet' : `${n} ${noun}${n === 1 ? '' : 's'}`);

export function AssetKindPicker({ suggest, onPick }: { suggest: CreateKind | null; onPick: (k: CreateKind) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const { close } = useDialogParam('new');
  const preview = useKindPreview();

  /** The card for the page you are on, or the first. Radix's own default lands
   *  on the close button, which is the one control nobody opened this to press. */
  const focusCard = () => {
    listRef.current?.querySelector<HTMLButtonElement>(suggest ? `[data-kind="${suggest}"]` : '[data-kind]')?.focus();
  };
  useEffect(focusCard, [suggest]);

  return (
    <DialogSheet
      className="sc-newpick"
      maxWidth="620px"
      onDismiss={close}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        focusCard();
      }}
    >
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Add to this brand</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>
      <p className="sc-newdlg-sub">The three things every shot is made from.</p>

      <div className="sc-newdlg-body">
        <div className="sc-pickgrid" ref={listRef}>
          {KINDS.map(({ kind, label, line, noun, icon: Icon }) => {
            const { url, count, own } = preview[kind];
            return (
              <button
                type="button"
                key={kind}
                className="sc-pick"
                data-kind={kind}
                onClick={() => onPick(kind)}
                aria-label={`${label}. ${line}. ${held(count, noun)}.`}
              >
                <span className="sc-pick-media">
                  {url ? (
                    <img src={url} alt="" loading="lazy" />
                  ) : (
                    <span className="sc-pick-blank">
                      <Icon size={22} />
                    </span>
                  )}
                  {/* Their own work says so. On a brand with nothing yet this is
                    our catalog, and claiming otherwise would be a small lie. */}
                  {own && <span className="sc-pick-mine">Yours</span>}
                </span>
                <span className="sc-pick-cap">
                  <b>{label}</b>
                  <small>{line}</small>
                </span>
                <span className="sc-pick-count">{held(count, noun)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </DialogSheet>
  );
}
