import type { FeedNode, ShotSet } from '../../api.js';

/**
 * The glyph a line wears. The same mark the verb already uses on the tile,
 * the selection bar, or the shot's own menu, at the menu's size.
 */
export type ShotMenuIcon =
  | 'open'
  | 'open-tab'
  | 'refine'
  | 'select'
  | 'keep'
  | 'kept'
  | 'unset'
  | 'versions'
  | 'archive'
  | 'restore'
  | 'delete';

/** One line of a shot's menu. Rendered by both surfaces that offer it. */
export interface ShotMenuItem {
  key: string;
  label: string;
  icon: ShotMenuIcon;
  onSelect: () => void;
  /** Destructive: rendered in red, and always below a rule. */
  danger?: boolean;
  /** A rule above this item, where management stops being curation. */
  separated?: boolean;
}

/**
 * Taking shots out of a set. One shot keeps the short name; a handful says
 * how many, the same sentence on the right-click and on the selection bar.
 */
export function removeFromSetLabel(count: number, name: string): string {
  return count > 1 ? `Remove ${count} shots from ${name}` : `Remove from ${name}`;
}

/** A selection's verb. One shot keeps the short name; a handful names the count and the noun. */
function pickedVerb(count: number, one: string, many: (n: number) => string): string {
  return count > 1 ? many(count) : one;
}

/** Membership verbs for a pick of more than one. Same names as the selection bar. */
export interface ShotMenuBatch {
  count: number;
  allKept: boolean;
  archived: boolean;
  onKeep: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onRemoveFromSet?: (set: ShotSet) => void;
}

/**
 * Everything you can do to one shot, as data rather than as markup.
 *
 * There are two surfaces that offer this list — the right-click menu on the
 * tile, and the tile's own overflow button — and Radix gives them different
 * component families, so writing the items twice was the obvious thing and
 * the wrong one: the two copies would answer the same question differently
 * within a release. The items are built once here and each surface only
 * decides how to draw a line of text.
 *
 * Which is also why the tile itself can afford to be quiet. Keep and Archive
 * used to be two more buttons blooming over the photograph on every hover;
 * they are management, they are in here, and the picture keeps its corner.
 *
 * A right-click on a picked tile while a batch is being built is the
 * selection's menu, not that tile's: Keepers, the set, Archive and Delete act
 * on every picked shot. Open and Deselect stay about the picture under the
 * pointer. A verb that covers the pick names the count and the noun
 * (`Archive 3 shots`); Open stays Open.
 */
export function shotMenuItems(
  node: FeedNode,
  {
    chosen,
    batching,
    versions,
    onOpen,
    onBranch,
    onPick,
    onVersions,
    onToggleKeep,
    onArchive,
    onDeletePermanently,
    shotHref,
    inSet,
    filedIn,
    onRemoveFromSet,
    batch,
  }: {
    chosen: boolean;
    /** A batch is being built, so single-shot work is not what is happening. */
    batching: boolean;
    versions: number;
    onOpen: (id: string) => void;
    /** The shot's real URL. Present: the menu offers "Open in new tab". */
    shotHref?: (id: string) => string;
    onBranch?: (id: string) => void;
    onPick?: (id: string) => void;
    onVersions?: (id: string) => void;
    onToggleKeep?: (node: FeedNode) => void;
    onArchive?: (node: FeedNode) => void;
    onDeletePermanently?: (node: FeedNode) => void;
    /** The set this feed is, when it is one. Remove is of this place. */
    inSet?: ShotSet | null;
    /** Sets this shot is filed in, used when the feed is All shots. */
    filedIn?: ShotSet[];
    onRemoveFromSet?: (set: ShotSet) => void;
    /** Present when this tile is in the pick: membership verbs use these. */
    batch?: ShotMenuBatch | null;
  },
): ShotMenuItem[] {
  const items: ShotMenuItem[] = [{ key: 'open', icon: 'open', label: 'Open', onSelect: () => onOpen(node.id) }];
  // Radix swallows the native contextmenu on the tile, so the browser's own
  // "Open link in new tab" can never appear there; this item stands in for it,
  // on both surfaces that render this list.
  if (shotHref) {
    items.push({
      key: 'open-tab',
      icon: 'open-tab',
      label: 'Open in new tab',
      onSelect: () => window.open(shotHref(node.id), '_blank'),
    });
  }

  // Not while a batch is being built: refining starts a new piece of work from
  // one picture, which is the opposite of what choosing a group is for. The
  // tile hides its Refine for the same reason, and a menu that quietly still
  // offered it would make the two surfaces disagree about the same question.
  if (onBranch && !batching)
    items.push({ key: 'branch', icon: 'refine', label: 'Refine', onSelect: () => onBranch(node.id) });

  const onPicked = Boolean(batching && chosen && batch && batch.count > 0);
  const group = Boolean(onPicked && batch && batch.count > 1);

  if (onPick) {
    items.push({
      key: 'pick',
      icon: 'select',
      label: chosen ? (group ? 'Deselect this shot' : 'Deselect') : 'Select',
      onSelect: () => onPick(node.id),
    });
  }

  const keepOne = (kept: boolean) => (kept ? 'Remove from Keepers' : 'Add to Keepers');
  const keepMany = (kept: boolean, n: number) =>
    kept ? `Remove ${n} shots from Keepers` : `Add ${n} shots to Keepers`;

  if (onPicked && batch) {
    items.push({
      key: 'keep',
      icon: batch.allKept ? 'kept' : 'keep',
      label: pickedVerb(batch.count, keepOne(batch.allKept), (n) => keepMany(batch.allKept, n)),
      onSelect: batch.onKeep,
      separated: group,
    });
  } else if (onToggleKeep) {
    items.push({
      key: 'keep',
      icon: node.kept ? 'kept' : 'keep',
      label: keepOne(node.kept),
      onSelect: () => onToggleKeep(node),
    });
  }

  // A batch only unsets the set you are standing in. This tile's other
  // memberships are not the group's: mixing them into one Remove would take
  // shots out of sets they were never picked from.
  const remove = onPicked ? batch?.onRemoveFromSet : onRemoveFromSet;
  const targets = onPicked ? (inSet ? [inSet] : []) : inSet ? [inSet] : (filedIn ?? []);
  if (remove) {
    for (const s of targets) {
      items.push({
        key: `unset-${s.id}`,
        icon: 'unset',
        label: removeFromSetLabel(onPicked && batch ? batch.count : 1, s.name),
        onSelect: () => remove(s),
      });
    }
  }

  if (versions > 0 && onVersions && !batching)
    items.push({
      key: 'versions',
      icon: 'versions',
      label: `Show ${versions} version${versions === 1 ? '' : 's'}`,
      onSelect: () => onVersions(node.id),
    });

  if (onPicked && batch) {
    items.push({
      key: 'archive',
      icon: batch.archived ? 'restore' : 'archive',
      label: batch.archived
        ? pickedVerb(batch.count, 'Restore', (n) => `Restore ${n} shots`)
        : pickedVerb(batch.count, 'Archive', (n) => `Archive ${n} shots`),
      onSelect: batch.archived ? batch.onRestore : batch.onArchive,
      danger: !batch.archived,
      separated: true,
    });
    if (batch.archived) {
      items.push({
        key: 'delete',
        icon: 'delete',
        label: pickedVerb(batch.count, 'Delete permanently', (n) => `Delete ${n} shots permanently`),
        onSelect: batch.onDelete,
        danger: true,
        separated: true,
      });
    }
  } else {
    if (onArchive)
      items.push({
        key: 'archive',
        icon: node.archived ? 'restore' : 'archive',
        label: node.archived ? 'Restore' : 'Archive',
        onSelect: () => onArchive(node),
        danger: !node.archived,
        separated: true,
      });
    if (onDeletePermanently && node.archived)
      items.push({
        key: 'delete',
        icon: 'delete',
        label: 'Delete permanently',
        onSelect: () => onDeletePermanently(node),
        danger: true,
        separated: true,
      });
  }

  return items;
}
