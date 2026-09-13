import { useMemo, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../../layout/DialogSheet.js';
import { CatalogCard } from '../../layout/CatalogCard.js';
import type { CommerceScan } from '../../api.js';

/**
 * Which of the products found on a website to actually import.
 *
 * The scan read a couple of dozen pages out of however many the store has, so
 * this is a sample and says so. Everything is ticked to begin with, because
 * someone who pasted their own shop's address wants their own products; the
 * ticks exist so they can drop the gift cards and the sample packs, not so
 * they have to opt in one at a time.
 *
 * Nothing here is new furniture. `DialogSheet` is the sheet every dialog uses
 * and is what makes the phone case right on its own, and `CatalogCard` in its
 * `select` variant is the same card the product library shows.
 */
export function ProductChoice({
  scan,
  busy,
  onImport,
  onDismiss,
}: {
  scan: CommerceScan;
  busy?: boolean;
  onImport: (urls: string[]) => void;
  onDismiss: () => void;
}) {
  const shown = scan.candidates;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(shown.map((c) => c.externalKey)));
  const byKey = useMemo(() => new Map(shown.map((c) => [c.externalKey, c])), [shown]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chosenUrls = () =>
    [...picked].map((key) => byKey.get(key)?.url).filter((u): u is string => typeof u === 'string' && !!u);

  const all = picked.size === shown.length;
  const rest = scan.count - shown.length;

  return (
    <DialogSheet open className="sc-wizpick" maxWidth="720px" described onDismiss={onDismiss}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Products on your site</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <SheetDescription className="sc-wizpick-sub">
        {scan.truncated && rest > 0
          ? `Here are ${shown.length} of about ${scan.count.toLocaleString()}. Import these now and add the rest whenever you like.`
          : `We found ${shown.length === 1 ? 'one product' : `${shown.length} products`}.`}
      </SheetDescription>

      <div className="sc-wizpick-tools">
        <button
          type="button"
          className="sc-wiz-skip"
          onClick={() => setPicked(all ? new Set() : new Set(shown.map((c) => c.externalKey)))}
        >
          {all ? 'Select none' : 'Select all'}
        </button>
        <span className="sc-wizpick-count">{picked.size} selected</span>
      </div>

      <div className="sc-wizpick-grid">
        {shown.map((c) => (
          <CatalogCard
            key={c.externalKey}
            id={c.externalKey}
            previewUrl={c.images?.[0]?.url ?? null}
            title={c.title}
            primary={c.title}
            secondary={c.price != null ? `${c.currency ?? ''} ${c.price}`.trim() : (c.category ?? '')}
            useLabel="Import"
            variant="select"
            selected={picked.has(c.externalKey)}
            onToggle={toggle}
            size="grid"
          />
        ))}
      </div>

      <div className="sc-wizpick-foot">
        <button type="button" className="sc-wiz-skip" onClick={onDismiss}>
          Not now
        </button>
        <button
          type="button"
          className="sc-wiz-cta"
          disabled={!picked.size || busy}
          onClick={() => onImport(chosenUrls())}
        >
          {busy ? 'Importing' : `Import ${picked.size === 1 ? '1 product' : `${picked.size} products`}`}
        </button>
      </div>
    </DialogSheet>
  );
}
