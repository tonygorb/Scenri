import { useEffect, useMemo, useState } from 'react';
import { ArrowLineUp, ImageSquare, Plus } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';

export interface ProductRef {
  /** The stored `asset:<hash>` this reference is, and the handle every write uses. */
  file: string;
  url: string;
  /** Semantic slot when we know it — "front", "side". Never guessed from position. */
  angle?: string | null;
}

/**
 * A product's reference set.
 *
 * The compiler reads meaning straight off this list: `shots[0]` is the
 * essential reference, and only the first `cap` reach an engine at all. So the
 * page cannot present it as an unordered gallery — it has to show which images
 * are doing the work, and let the order be corrected. Promote and remove are
 * enough for that; with a cap of three, moving the right images to the front is
 * a click each, and drag-to-reorder would be furniture.
 *
 * Different from a scene's or a presenter's grid on purpose. Those sets are
 * read by scanning: several looks, all equal. This one is the same object from
 * different sides, and sides are compared by swapping one large frame.
 */
export function ProductReferences({
  refs,
  cap,
  note,
  addLabel,
  busy,
  onAdd,
  onPromote,
  onRemove,
}: {
  refs: ProductRef[];
  cap: number;
  note: string;
  addLabel: string | null;
  busy?: boolean;
  onAdd?: (file: File) => void;
  onPromote?: (file: string) => void;
  onRemove?: (file: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // The selection follows the image, not its index: promoting one moves every
  // index, and a page that jumped to a different photo when you pressed "Use
  // first" would look like it had promoted the wrong one.
  const current = useMemo(() => refs.find((r) => r.file === selected) ?? refs[0], [refs, selected]);
  useEffect(() => {
    if (refs.length && !refs.some((r) => r.file === selected)) setSelected(refs[0]?.file ?? null);
  }, [refs, selected]);

  const index = current ? refs.findIndex((r) => r.file === current.file) : -1;
  const canPromote = Boolean(onPromote) && index > 0;
  const canRemove = Boolean(onRemove) && Boolean(current) && refs.length > 1;

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onAdd?.(file);
  };

  return (
    <>
      <div className="sc-refstage">
        {current ? (
          <div className="sc-refstage-frame">
            <img src={current.url} alt="" />
          </div>
        ) : onAdd ? (
          <label
            className="sc-refstage-blank sc-refstage-drop"
            data-busy={busy || undefined}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = '';
              }}
            />
            {busy ? <Spinner size="2" /> : <Plus size={22} weight="bold" />}
            <span>Add a reference</span>
          </label>
        ) : (
          <span className="sc-refstage-blank">
            <ImageSquare size={22} />
          </span>
        )}
      </div>

      {(refs.length > 1 || (addLabel && onAdd && refs.length > 0)) && (
        <div className="sc-refrail">
          {refs.map((r, i) => (
            <button
              key={r.file}
              type="button"
              className="sc-refrail-item"
              data-on={current?.file === r.file ? '' : undefined}
              data-spare={i >= cap ? '' : undefined}
              aria-label={`Reference ${i + 1}`}
              aria-pressed={current?.file === r.file}
              onClick={() => setSelected(r.file)}
            >
              <img src={r.url} alt="" loading="lazy" />
            </button>
          ))}
          {addLabel && onAdd && refs.length > 0 && (
            <label className="sc-refrail-item sc-refrail-add" data-busy={busy || undefined}>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = '';
                }}
              />
              {busy ? <Spinner size="1" /> : <Plus size={16} weight="bold" />}
              <span className="sc-vh">{addLabel}</span>
            </label>
          )}
        </div>
      )}

      {(canPromote || canRemove) && (
        <div className="sc-refacts">
          <span className="sc-refacts-pair">
            {canPromote && (
              <button type="button" className="sc-refact sc-refact-lead" onClick={() => onPromote?.(current!.file)}>
                <ArrowLineUp size={14} weight="bold" />
                Use first
              </button>
            )}
            {canRemove && (
              <button type="button" className="sc-refact sc-refact-aside" onClick={() => onRemove?.(current!.file)}>
                Remove
              </button>
            )}
          </span>
        </div>
      )}

      <p className="sc-lookpage-note">{note}</p>
    </>
  );
}
