import { useEffect, useState } from 'react';
import { Plus, TrashSimple } from '@phosphor-icons/react';
import { flattenPalette, isInShots, nextHex, normalizeHex, rebuildPalette, type Swatch } from '../../brand/palette.js';
import { ColorPicker } from '../../layout/ColorPicker.js';

interface BrandDocLike {
  json: any;
  patch: (fields: Record<string, unknown>, opts?: { debounce?: number }) => void;
}

/**
 * The palette.
 *
 * A list of rows, every control on every row visible at rest. Three earlier
 * shapes are worth not repeating:
 *
 * - **Tiles.** A swatch big enough to read as a colour is not big enough to also
 *   hold a name, a role and a delete; they ended up on top of the colour and on
 *   top of each other.
 * - **An overflow menu.** It tidied the row and made *deleting a colour* a
 *   hover-only affordance nested inside a popover. Tidy is not worth unreachable.
 * - **A star, an eye, then a checkbox.** Three attempts to let you set, per
 *   colour, whether it belongs in the palette instruction. All three were the
 *   wrong question. "Primary" buys one thing in this codebase — the avatar tint
 *   when a brand has no logo — so it is derived from position and never asked
 *   about. And whether a colour is a neutral is something the kit already
 *   knows: the scrape classifies near-white and near-black as neutrals, and the
 *   schema stores them in their own array.
 *
 * So there is no per-row control. A colour is its swatch, a role the kit already
 * knows, its hex, and a way to remove it. The role is a label, not a field —
 * asking someone to name "Primary" was a blank that looked like homework.
 * Neutrals are shown as their own group, because that is information, not a
 * decision waiting to be made.
 */
export function BrandPalette({ doc, suggestions }: { doc: BrandDocLike; suggestions?: { hex: string }[] }) {
  const stored = doc.json?.palette;
  const [colors, setColors] = useState<Swatch[]>(() => flattenPalette(stored));

  // Local state renders: a hex committed 40ms ago has not come back from the
  // server yet, and re-deriving mid-edit fights the input.
  const seed = JSON.stringify(stored ?? {});
  useEffect(() => {
    setColors(flattenPalette(stored));
  }, [seed]);

  const commit = (next: Swatch[], debounce = 0) => {
    setColors(next);
    doc.patch({ palette: rebuildPalette(next, stored) }, { debounce });
  };
  const editAt = (i: number, fields: Partial<Swatch>, debounce = 0) =>
    commit(
      colors.map((c, idx) => (idx === i ? { ...c, ...fields } : c)),
      debounce,
    );

  /**
   * Adding is one click and it lands a row.
   *
   * Gating creation behind the picker meant nothing existed until you had
   * committed to a colour — backwards, since the row is the thing being made and
   * the colour is one of its fields. Set it from the chip, whenever you like.
   */
  const add = () => commit([...colors, { hex: nextHex(colors), name: '', slot: colors.length ? 'accent' : 'primary' }]);

  const fresh = (suggestions ?? []).filter((s) => {
    const hex = normalizeHex(s.hex);
    return hex && !colors.some((c) => c.hex === hex);
  });

  const row = (c: Swatch, i: number) => (
    <SwatchRow
      key={`${c.slot}-${i}`}
      swatch={c}
      presets={colors.map((x) => x.hex)}
      /* Dragging the picker fires per pointer move; the document is saved on a
         pause rather than per frame. */
      onHex={(hex) => editAt(i, { hex }, 300)}
      onRemove={() => commit(colors.filter((_, idx) => idx !== i))}
    />
  );
  const indexed = colors.map((c, i) => [c, i] as const);
  const neutrals = indexed.filter(([c]) => !isInShots(c));

  return (
    <div className="sc-pal">
      {colors.length === 0 && (
        <p className="sc-pal-empty">No colours yet. Add one and it becomes a chip you can drop into any shot.</p>
      )}

      {indexed.filter(([c]) => isInShots(c)).map(([c, i]) => row(c, i))}

      {neutrals.length > 0 && (
        <>
          {/* Grounds and surfaces. Kept in the kit and in the export, but not
              listed as colours to favour — that is what turns every shot
              black-and-white. */}
          <p className="sc-pal-group">Neutrals</p>
          {neutrals.map(([c, i]) => row(c, i))}
        </>
      )}

      <div className="sc-pal-foot">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={add}>
          <Plus size={12} />
          Add colour
        </button>
        {fresh.length > 0 && (
          <span className="sc-pal-sugg">
            <small>From the website</small>
            {fresh.map((s) => {
              const hex = normalizeHex(s.hex) as string;
              return (
                <button
                  type="button"
                  key={hex}
                  className="sc-pal-sugg-chip"
                  style={{ background: hex }}
                  title={`Add ${hex}`}
                  aria-label={`Add ${hex}`}
                  onClick={() => commit([...colors, { hex, name: '', slot: 'accent' }])}
                />
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function SwatchRow({
  swatch,
  presets,
  onHex,
  onRemove,
}: {
  swatch: Swatch;
  presets: string[];
  onHex: (hex: string) => void;
  onRemove: () => void;
}) {
  const [hexDraft, setHexDraft] = useState(swatch.hex);
  useEffect(() => setHexDraft(swatch.hex), [swatch.hex]);

  // The schema pattern is exactly six digits and it rejects the whole document
  // on a miss, so a half-typed hex must never reach the save path.
  const commitHex = () => {
    const hex = normalizeHex(hexDraft);
    if (hex) onHex(hex);
    setHexDraft(hex ?? swatch.hex);
  };

  return (
    <div className="sc-pal-row">
      <ColorPicker
        value={swatch.hex}
        onChange={onHex}
        label={`${swatch.name} color`}
        presets={presets}
        className="sc-pal-chip"
      />

      <span className="sc-pal-name">{swatch.name}</span>

      <input
        className="sc-in sc-pal-hex"
        value={hexDraft}
        spellCheck={false}
        maxLength={7}
        aria-label={`${swatch.name} hex`}
        onChange={(e) => setHexDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />

      <button
        type="button"
        className="sc-pal-act"
        data-danger=""
        onClick={onRemove}
        aria-label={`Remove ${swatch.name}`}
        title="Remove"
      >
        <TrashSimple size={13} />
      </button>
    </div>
  );
}
