/**
 * What the picture being refined is made of, worn as the source's own small
 * inverse cards in the composer's band: the product, the person and the
 * scene. Same tokens the hub's Refining chip wears, so the two shells cannot
 * drift. Each card opens the picture. Nothing here is droppable yet: the
 * band states what the next refinement carries, it does not edit it.
 */
export type SourceItem = { key: string; kind: string; label: string; thumb: string | null; crop?: 'top' };

export function SourceCards({ items, onOpen }: { items: SourceItem[]; onOpen: () => void }) {
  return (
    <div className="sc-source-chips">
      {items.map((it) => (
        <button
          type="button"
          className="sc-source-chip"
          key={it.key}
          title={`${it.label}. Open the image.`}
          aria-label={`Refining a shot of ${it.label}. Open the image.`}
          onClick={onOpen}
        >
          {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
          <span dir="auto">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
