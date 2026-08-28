import { nodeLabel, type TreeNode } from '../../api.js';

/** One line of a shot's menu. Rendered by both surfaces that offer it. */
export interface ShotMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Destructive: rendered in red, and always below a rule. */
  danger?: boolean;
  /** A rule above this item, where management stops being curation. */
  separated?: boolean;
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
 */
export function shotMenuItems(
  node: TreeNode,
  {
    chosen,
    batching,
    versions,
    onOpen,
    onBranch,
    onPick,
    onVersions,
    onToggleExpand,
    onToggleKeep,
    onArchive,
    onDeletePermanently,
    shotHref,
  }: {
    chosen: boolean;
    /** A batch is being built, so single-shot work is not what is happening. */
    batching: boolean;
    versions: number;
    onOpen: (id: string) => void;
    /** The shot's real URL. Present: the menu offers "Open in new tab". */
    shotHref?: (id: string) => string;
    onBranch?: (id: string, imageIndex?: number) => void;
    onPick?: (id: string) => void;
    onVersions?: (id: string) => void;
    onToggleExpand?: (id: string) => void;
    onToggleKeep?: (node: TreeNode) => void;
    onArchive?: (node: TreeNode) => void;
    onDeletePermanently?: (node: TreeNode) => void;
  },
): ShotMenuItem[] {
  const items: ShotMenuItem[] = [{ key: 'open', label: `Open ${nodeLabel(node)}`, onSelect: () => onOpen(node.id) }];
  // Radix swallows the native contextmenu on the tile, so the browser's own
  // "Open link in new tab" can never appear there; this item stands in for it,
  // on both surfaces that render this list.
  if (shotHref) {
    items.push({ key: 'open-tab', label: 'Open in new tab', onSelect: () => window.open(shotHref(node.id), '_blank') });
  }

  // Not while a batch is being built: refining starts a new piece of work from
  // one picture, which is the opposite of what choosing a group is for. The
  // tile hides its Refine for the same reason, and a menu that quietly still
  // offered it would make the two surfaces disagree about the same question.
  if (onBranch && !batching)
    items.push({ key: 'branch', label: 'Refine from this', onSelect: () => onBranch(node.id) });
  if (onPick)
    items.push({ key: 'pick', label: chosen ? 'Deselect' : 'Select for set', onSelect: () => onPick(node.id) });
  if (onToggleKeep)
    items.push({
      key: 'keep',
      label: node.kept ? 'Remove from keepers' : 'Keep',
      onSelect: () => onToggleKeep(node),
    });
  if (versions > 0 && onVersions)
    items.push({
      key: 'versions',
      label: `${versions} version${versions === 1 ? '' : 's'}`,
      onSelect: () => onVersions(node.id),
    });
  if (node.images.length > 1 && onToggleExpand)
    items.push({ key: 'expand', label: 'Show all variants', onSelect: () => onToggleExpand(node.id) });
  if (onArchive)
    items.push({
      key: 'archive',
      label: node.archived ? 'Restore' : 'Archive',
      onSelect: () => onArchive(node),
      separated: true,
    });
  if (onDeletePermanently && node.archived)
    items.push({
      key: 'delete',
      label: 'Delete permanently',
      onSelect: () => onDeletePermanently(node),
      danger: true,
      separated: true,
    });

  return items;
}
