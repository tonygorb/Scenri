import { memo, useEffect, useState, type KeyboardEvent } from 'react';
import { Check, ImageSquare, X } from '@phosphor-icons/react';
import { SitOutTooltip } from '../SitOutTooltip.js';
import { KIND_ONE, type AttachCard } from './attachRules.js';

/**
 * One thing the picker can add, drawn once for every kind.
 *
 * The picture is the tile: a face, a packshot, a scene's light, a swatch.
 * The caption is one fixed line (two for a product, whose brand is the only
 * thing a packshot cannot say), so a row of tiles is a row, whatever their
 * names. A tile already in the shot wears a tick and is a toggle: pressing
 * it again takes the chip back out, and the tick turns into an x under the
 * pointer so the second press is never a surprise. A tile that sits out is
 * inert through aria-disabled, never the attribute, so the tooltip that says
 * why can still open.
 *
 * Memoised on primitives: the composer repaints on every keystroke, and
 * sixty tiles re-rendering with it is what a picker over a brief cannot do.
 */
export const AttachTile = memo(function AttachTile({
  card,
  index,
  active,
  ticked,
  why,
  onPick,
  onFocus,
}: {
  card: AttachCard;
  index: number;
  active: boolean;
  ticked: boolean;
  why: string | null;
  onPick: (index: number) => void;
  onFocus: (index: number) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // a native button fires click on Enter and Space already; this only keeps
    // the pair from reaching the line behind the panel, where Space is a space
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  const tile = (
    <button
      type="button"
      className="sc-ap-card"
      data-shape={card.shape}
      data-group={card.group}
      data-nav={index}
      data-on={ticked ? '' : undefined}
      tabIndex={active ? 0 : -1}
      aria-disabled={why ? true : undefined}
      aria-pressed={ticked}
      title={why ?? (ticked ? `${card.label} is in the shot. Press to remove it.` : card.full)}
      onClick={why ? undefined : () => onPick(index)}
      onFocus={() => onFocus(index)}
      onKeyDown={onKeyDown}
    >
      {card.shape === 'swatch' ? (
        <span className="sc-ap-swatch" style={{ background: card.swatch }} aria-hidden />
      ) : (
        <Thumb src={card.thumb} crop={card.crop} />
      )}
      <span className="sc-ap-cap">
        <span className="sc-vh">{KIND_ONE[card.group]}: </span>
        <b dir="auto">{card.label}</b>
        {card.sub && <span dir="auto">{card.sub}</span>}
      </span>
      {ticked && (
        <span className="sc-ap-tick" aria-hidden>
          <Check className="sc-ap-tick-on" size={11} weight="bold" />
          <X className="sc-ap-tick-off" size={11} weight="bold" />
        </span>
      )}
      {ticked && <span className="sc-vh">{' In the shot.'}</span>}
    </button>
  );
  return <SitOutTooltip why={why}>{tile}</SitOutTooltip>;
});

/**
 * The picture in its frame. The frame is what the states paint (a hairline at
 * rest, stronger under the pointer, the selected line when in the shot, the
 * ring when focused), the same way the rail's asset card frames the same
 * pictures. A catalog import whose image never downloaded has a product but
 * no picture, and keeps the frame.
 */
function Thumb({ src, crop }: { src?: string | null; crop?: 'top' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className="sc-ap-thumb" data-empty={!src || broken ? '' : undefined}>
      {!src || broken ? (
        <ImageSquare size={16} />
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" data-crop={crop} onError={() => setBroken(true)} />
      )}
    </span>
  );
}
