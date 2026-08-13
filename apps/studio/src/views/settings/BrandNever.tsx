import { ChipsInput } from '../../layout/ChipsInput.js';
import { unusedPresets } from '../../brand/neverPresets.js';

interface BrandDocLike {
  json: any;
  patch: (fields: Record<string, unknown>, opts?: { debounce?: number }) => void;
}

/**
 * The one thing a brand kit can state that an ordinary person can answer.
 *
 * What this replaced is worth recording. The section here was "Art direction" —
 * five free-text fields — then "Look and feel" — a register plus prose plus
 * this list. Both asked the user to describe how their pictures *read*, and
 * neither could be answered without creative vocabulary; the product's own
 * owner could not fill it in for his own brand.
 *
 * It was also redundant. `docs/product/generation-contracts.md` ranks scene
 * direction above brand style for look and composition, so on the normal path —
 * where a shot carries a scene — everything typed there was overruled anyway.
 *
 * What survives is the part that is concrete, that no scene supplies, and that
 * actually protects a brand in a generated image: the things it never shows.
 */
export function BrandNever({ doc }: { doc: BrandDocLike }) {
  const rules = doc.json?.rules ?? {};
  const never: string[] = rules.never ?? [];

  const write = (next: string[]) => {
    const rest = { ...rules };
    // An absent key, never a stored empty array — it would sit in every export.
    if (next.length) rest.never = next;
    else delete rest.never;
    doc.patch({ rules: rest });
  };

  return (
    <div className="sc-nv">
      <ChipsInput
        label="Things this brand never shows"
        value={never}
        placeholder="anything else you never want to see"
        suggestions={unusedPresets(never)}
        max={24}
        onChange={write}
      />
      <small className="sc-nv-hint">
        Each one becomes an instruction the model is held to, on any shot that asks for the kit.
      </small>
    </div>
  );
}
