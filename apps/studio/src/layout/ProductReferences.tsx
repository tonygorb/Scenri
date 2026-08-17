import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLineUp, CaretLeft, CaretRight, ImageSquare, Plus } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';

export interface ProductRef {
  /** The stored `asset:<hash>` this reference is, and the handle every write uses. */
  file: string;
  url: string;
  /** Semantic slot when we know it — "front", "side". Never guessed from position. */
  angle?: string | null;
}

/**
 * Overflow state and paging for the reference thumbs.
 *
 * A mouse must not pan this row — the wheel belongs to the page, and the
 * arrows are the only desktop way along the set. The row does not loop:
 * order is the product contract, and the add tile sits outside the scroller
 * so it is always on screen.
 */
function useRefRail(itemCount: number) {
  const shellRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const rail = railRef.current;
    if (!shell || !rail) return;

    let fadeRaf = 0;
    const placeFades = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 1) {
        delete shell.dataset.overflowLeft;
        delete shell.dataset.overflowRight;
        return;
      }
      if (rail.scrollLeft > 2) shell.dataset.overflowLeft = '';
      else delete shell.dataset.overflowLeft;
      if (rail.scrollLeft < max - 2) shell.dataset.overflowRight = '';
      else delete shell.dataset.overflowRight;
    };

    const onScroll = () => {
      if (fadeRaf) return;
      fadeRaf = requestAnimationFrame(() => {
        fadeRaf = 0;
        placeFades();
      });
    };

    placeFades();
    const ro = new ResizeObserver(() => placeFades());
    ro.observe(rail);
    for (const child of rail.children) ro.observe(child);

    rail.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (fadeRaf) cancelAnimationFrame(fadeRaf);
      ro.disconnect();
      rail.removeEventListener('scroll', onScroll);
    };
  }, [itemCount]);

  /** One thumb at a time — the set is an index, not a gallery you skip through. */
  const page = useCallback((dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail?.firstElementChild) return;
    const cell = (rail.firstElementChild as HTMLElement).getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: dir * (cell + gap), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  return { shellRef, railRef, page };
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
  const showAdd = Boolean(addLabel && onAdd && refs.length > 0);
  const showRail = refs.length > 1 || showAdd;
  const { shellRef, railRef, page } = useRefRail(refs.length);

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

      {showRail && (
        <div className="sc-refrail-shell" ref={shellRef}>
          <div className="sc-refrail-track">
            {/* On the thumb track, not the shell: the add tile is pinned
                outside the scroller and must never wear an arrow. Same reveal
                as the look-page sliders — on hover or focus, when that side
                can move. */}
            <button
              type="button"
              className="sc-refrail-arrow prev"
              aria-label="Previous references"
              onClick={() => page(-1)}
            >
              <CaretLeft size={13} weight="bold" />
            </button>
            <button
              type="button"
              className="sc-refrail-arrow next"
              aria-label="Next references"
              onClick={() => page(1)}
            >
              <CaretRight size={13} weight="bold" />
            </button>
            <div className="sc-refrail" ref={railRef}>
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
            </div>
          </div>
          {showAdd && (
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
