import type { ReactNode } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { ContextMenu } from '@radix-ui/themes';
import { Link, useNavigate } from 'react-router';
import { thumbUrl } from '../api.js';
import { useHoverNone } from '../useMediaQuery.js';
import { catalogMenuItems } from './catalogMenu.js';
import { catalogBatchItems } from './catalogPick.js';
import { MenuGlyph } from './menuGlyph.js';

/**
 * Unfinished work, offered back: a presenter half cast, a scene still drawing
 * or drawn and not yet used.
 *
 * Creation is minutes of drawing, and the work it produces used to be
 * reachable only from the page it was started on: leave that page and a
 * finished face, or a scene drawn while you were elsewhere, sat with no door
 * to it. The card is that door.
 *
 * It sits in the same wall as the finished cards, first, so the page does not
 * change shape when a draft becomes the real thing. What marks it out is the
 * caption, which is always visible here and hover-revealed on a finished card:
 * a card whose job is to say "this is not done" cannot hide that behind a
 * pointer.
 *
 * One tap opens it, where a finished card on touch takes two. That is not an
 * inconsistency: the finished card arms on the first tap because it has a
 * second action to reveal and no hover to reveal it with. This has one thing
 * you can do, so asking for a tap to reveal it and another to take it would be
 * friction for nothing. Discard is a press of its own, always there, and the
 * right-click menu offers Continue and that same Discard. A wall that lets
 * its drafts be picked passes `onPick`; while a pick is being built a tap
 * toggles the card rather than opening it.
 */
export function DraftCard({
  id,
  name,
  hash,
  drawing,
  state,
  href,
  blank,
  onDiscard,
  chosen,
  batching,
  onPick,
  batch,
}: {
  id: string;
  name: string;
  hash: string | null | undefined;
  drawing: boolean;
  /** Where it stands, in words: "Drawing", "Face ready", "Drawn, not saved yet". */
  state: string;
  href: string;
  /** What stands in for the picture before there is one. */
  blank: ReactNode;
  onDiscard?: (id: string) => void;
  chosen?: boolean;
  batching?: boolean;
  onPick?: (id: string) => void;
  /** Set when this draft is in the pick: the right-click becomes the pick's menu. */
  batch?: { count: number; onAct: () => void } | null;
}) {
  const navigate = useNavigate();
  const touchUi = useHoverNone();
  const menu = batch
    ? catalogBatchItems({
        kind: 'draft',
        count: batch.count,
        openLabel: 'Continue',
        onOpen: () => navigate(href),
        href,
        onDeselect: () => onPick?.(id),
        onAct: batch.onAct,
      })
    : onDiscard
      ? catalogMenuItems({
          draft: {
            onContinue: () => navigate(href),
            href,
            onDiscard: () => onDiscard(id),
          },
          select: onPick ? { run: () => onPick(id) } : undefined,
        })
      : catalogMenuItems({ onOpen: () => navigate(href), href });
  const card = (
    <div
      className="sc-lookcard"
      data-variant="plain"
      data-size="grid"
      data-build
      data-building={drawing || undefined}
      data-picked={chosen || undefined}
      data-batching={batching || undefined}
    >
      <Link
        className="sc-lookcard-media"
        to={href}
        aria-label={batching ? `${chosen ? 'Deselect' : 'Select'} ${name}` : `Continue ${name}`}
        onClick={(e) => {
          if (batching && onPick) {
            e.preventDefault();
            onPick(id);
          }
        }}
      >
        {hash ? <img src={thumbUrl(hash, 'tile')} alt="" /> : <span className="sc-lookcard-blank">{blank}</span>}
        {drawing && <span className="sc-rendering" aria-hidden />}
        {/* Said on the picture, because the picture is what makes one of these
            look finished: a face or a place on a card reads as done until
            something on it says otherwise. */}
        <span className="sc-draftmark">Draft</span>
      </Link>
      {onPick && (
        <button
          type="button"
          className="sc-cell-ctl sc-lookcard-pick"
          data-on={chosen || undefined}
          aria-pressed={!!chosen}
          aria-label={chosen ? `Deselect ${name}` : `Select ${name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(id);
          }}
        >
          <Check size={13} weight="bold" />
        </button>
      )}
      {onDiscard && !batching && (
        <button type="button" className="sc-cardpuck" aria-label={`Discard ${name}`} onClick={() => onDiscard(id)}>
          <X size={13} />
        </button>
      )}
      <span className="sc-lookcard-cap">
        <b dir="auto">{name}</b>
        <span>{state}</span>
      </span>
    </div>
  );
  if (touchUi) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {menu.map((it) => (
          <span key={it.key} style={{ display: 'contents' }}>
            {it.separated && <ContextMenu.Separator />}
            <ContextMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
              <MenuGlyph name={it.icon} />
              {it.label}
            </ContextMenu.Item>
          </span>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
