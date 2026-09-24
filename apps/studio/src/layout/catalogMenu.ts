/**
 * One catalog card's menu, as data.
 *
 * The right-click and the overflow are different Radix families, the same
 * split the shot menu already refuses to write twice. Each card type passes
 * the verbs its own page already has. A verb that does not apply is absent,
 * so a library scene and a product you own do not share a list.
 */
export type CatalogMenuIcon =
  | 'open'
  | 'open-tab'
  | 'continue'
  | 'use'
  | 'keep'
  | 'kept'
  | 'rename'
  | 'duplicate'
  | 'edit'
  | 'delete'
  | 'discard'
  | 'select'
  | 'cover'
  | 'redraw';

export interface CatalogMenuItem {
  key: string;
  label: string;
  icon: CatalogMenuIcon;
  onSelect: () => void;
  /** Destructive: rendered in red, under a rule. */
  danger?: boolean;
  /** A rule above this item. */
  separated?: boolean;
}

export interface CatalogMenuSpec {
  /** Open the record. Absent when the card attaches instead of navigating. */
  onOpen?: () => void;
  /** The record's real URL. Present: the menu offers Open in new tab. */
  href?: string;
  /** The fast path, in that card's own words. */
  use?: { label: string; run: () => void };
  /** Join the wall's pick. Absent on a Scenri card, which has no tick. */
  select?: { run: () => void };
  /** Add to Keepers, or take it back off. */
  keep?: { on: boolean; run: () => void };
  /**
   * Change the name. The same write the record's own page already makes.
   * Absent when the name is not yours: a Scenri card, and a store product
   * whose title the next import would put back.
   */
  onRename?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  /** Delete, named for the thing. Sits last, under a rule, in red. */
  remove?: { label: string; run: () => void };
  /** A draft still being made. Continue, then Discard. */
  draft?: { onContinue: () => void; href?: string; onDiscard: () => void };
  /**
   * The whole menu is this one line. The Home shelf attaches, and an example
   * recreates: neither has a page of its own behind a second verb.
   */
  only?: { label: string; run: () => void };
}

function openTab(href: string): CatalogMenuItem {
  return {
    key: 'open-tab',
    icon: 'open-tab',
    label: 'Open in new tab',
    onSelect: () => window.open(href, '_blank'),
  };
}

function selectLine(run: () => void): CatalogMenuItem {
  return { key: 'select', icon: 'select', label: 'Select', onSelect: run };
}

export function catalogMenuItems(spec: CatalogMenuSpec): CatalogMenuItem[] {
  if (spec.only) {
    return [{ key: 'only', icon: 'use', label: spec.only.label, onSelect: spec.only.run }];
  }
  if (spec.draft) {
    const items: CatalogMenuItem[] = [
      { key: 'continue', icon: 'continue', label: 'Continue', onSelect: spec.draft.onContinue },
    ];
    if (spec.draft.href) items.push(openTab(spec.draft.href));
    if (spec.select) items.push(selectLine(spec.select.run));
    items.push({
      key: 'discard',
      icon: 'discard',
      label: 'Discard',
      onSelect: spec.draft.onDiscard,
      danger: true,
      separated: true,
    });
    return items;
  }

  const items: CatalogMenuItem[] = [];
  if (spec.onOpen) items.push({ key: 'open', icon: 'open', label: 'Open', onSelect: spec.onOpen });
  if (spec.href) items.push(openTab(spec.href));
  if (spec.use) items.push({ key: 'use', icon: 'use', label: spec.use.label, onSelect: spec.use.run });
  if (spec.select) items.push(selectLine(spec.select.run));
  if (spec.keep) {
    items.push({
      key: 'keep',
      icon: spec.keep.on ? 'kept' : 'keep',
      label: spec.keep.on ? 'Remove from Keepers' : 'Add to Keepers',
      onSelect: spec.keep.run,
    });
  }
  if (spec.onRename) items.push({ key: 'rename', icon: 'rename', label: 'Rename', onSelect: spec.onRename });
  if (spec.onDuplicate) {
    items.push({ key: 'duplicate', icon: 'duplicate', label: 'Duplicate presenter', onSelect: spec.onDuplicate });
  }
  if (spec.onEdit) items.push({ key: 'edit', icon: 'edit', label: 'Edit presenter', onSelect: spec.onEdit });
  if (spec.remove) {
    items.push({
      key: 'delete',
      icon: 'delete',
      label: spec.remove.label,
      onSelect: spec.remove.run,
      danger: true,
      separated: true,
    });
  }
  return items;
}
