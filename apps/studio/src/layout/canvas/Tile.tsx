import { memo } from 'react';
import { Link } from 'react-router';
import { ContextMenu } from '@radix-ui/themes';
import { imgUrl, nodeLabel, thumbUrl, type FeedNode } from '../../api.js';
import { aspectOfFormat } from '../../composer/formats.js';
import { FeedImage } from './FeedImage.js';
import { ShotChrome } from './ShotChrome.js';
import { shotMenuItems } from './shotMenu.js';

/**
 * A tile's shape: recorded pixels when the run wrote them, the brief's format
 * as the guess for everything older. The record ends the guessing, which is
 * what lets the box hold its shape after load instead of reflowing the column.
 */
export function aspectOfImage(n: FeedNode, i: number): { aspect: number | undefined; guess: boolean } {
  const size = (n.brief as { rendered?: { sizes?: [number, number][] } } | null)?.rendered?.sizes?.[i];
  if (size && size[0] > 0 && size[1] > 0) return { aspect: size[0] / size[1], guess: false };
  return { aspect: aspectOfFormat((n.brief as { format?: string } | null)?.format), guess: true };
}

/**
 * What every tile can do, as one object the feed keeps stable across its own
 * renders: a tile re-renders when its shot or its own state changes, never
 * because the feed did.
 */
export interface TileHandlers {
  onOpen: (id: string) => void;
  shotHref: (id: string) => string;
  onBranch?: (id: string) => void;
  onPick?: (id: string) => void;
  onVersions?: (id: string) => void;
  onToggleKeep?: (node: FeedNode) => void;
  onArchive?: (node: FeedNode) => void;
  /** Asks; the feed owns the one confirm dialog for the whole grid. */
  onDeleteAsk?: (node: FeedNode) => void;
}

/** A finished shot: the picture, its chrome, and the same verbs in a context menu. */
export const Tile = memo(function Tile({
  node: n,
  selected,
  armed,
  chosen,
  picking,
  batching,
  versions,
  handlers: h,
}: {
  node: FeedNode;
  selected: boolean;
  /** The composer is pointed at this exact image. */
  armed: boolean;
  chosen: boolean;
  picking: boolean;
  batching: boolean;
  versions: number;
  handlers: TileHandlers;
}) {
  /** The shot's verbs, built once so the two menus offering them agree. */
  const menu = shotMenuItems(n, {
    chosen,
    batching,
    versions,
    onOpen: h.onOpen,
    shotHref: h.shotHref,
    onBranch: h.onBranch,
    onPick: h.onPick,
    onVersions: h.onVersions,
    onToggleKeep: h.onToggleKeep,
    onArchive: h.onArchive,
    onDeletePermanently: h.onDeleteAsk,
  });
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div
          className="sc-cell"
          data-fb-node={n.id}
          data-selected={selected}
          // the composer is pointed at this exact image; the card says so
          // with the same gold line its own Refine button lights up with
          data-armed={armed || undefined}
          data-batching={batching || undefined}
          data-picked={chosen || undefined}
        >
          <Link
            className="sc-cell-open"
            to={h.shotHref(n.id)}
            aria-label={batching ? `${chosen ? 'Deselect' : 'Select'} ${nodeLabel(n)}` : `Open ${nodeLabel(n)}`}
            onClick={(e) => {
              if (batching) {
                e.preventDefault();
                h.onPick?.(n.id);
              }
            }}
          >
            <FeedImage src={thumbUrl(n.images[0], 'tile')} fallback={imgUrl(n.images[0])} {...aspectOfImage(n, 0)} />
          </Link>
          <ShotChrome
            node={n}
            chosen={chosen}
            picking={picking}
            batching={batching}
            armed={armed}
            menu={menu}
            onPick={h.onPick}
            onBranch={h.onBranch}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {menu.map((it) => (
          <span key={it.key} style={{ display: 'contents' }}>
            {it.separated && <ContextMenu.Separator />}
            <ContextMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
              {it.label}
            </ContextMenu.Item>
          </span>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
});
