import type { CatalogMenuIcon, CatalogMenuItem } from './catalogMenu.js';

/**
 * What a catalog wall can do with a handful.
 *
 * A shot is seeded with one presenter, one scene and one product, so Use in a
 * shot does not become a batch verb. Duplicate and Edit need a name or a
 * route, so they stay on the one card. The dock carries the verb that already
 * scales. A Scenri presenter, scene or product is the catalog, not something
 * you manage in a handful, so it grows no tick.
 */
export type CatalogPickKind = 'presenter' | 'draft' | 'owned-scene' | 'product';

export interface CatalogPickVerb {
  /** The dock's tooltip. One word, the way Archive is one word on a shot. */
  tool: string;
  /** The right-click line. A handful names the count and the noun. */
  menu: string;
  icon: CatalogMenuIcon;
  danger: boolean;
}

/** The dock's tool and the menu's line for one kind of pick. */
export function catalogPickVerb(kind: CatalogPickKind, count: number): CatalogPickVerb {
  if (kind === 'draft') {
    return {
      tool: 'Discard',
      menu: count > 1 ? `Discard ${count} drafts` : 'Discard',
      icon: 'discard',
      danger: true,
    };
  }
  const one = kind === 'presenter' ? 'Delete presenter' : kind === 'product' ? 'Delete product' : 'Delete scene';
  const many = kind === 'presenter' ? 'presenters' : kind === 'product' ? 'products' : 'scenes';
  return {
    tool: 'Delete',
    menu: count > 1 ? `Delete ${count} ${many}` : one,
    icon: 'delete',
    danger: true,
  };
}

/**
 * What a delete leaves behind, said the same way on the card, the page and the
 * bulk bar.
 *
 * A shot's recipe names what it was made with by id, and nothing keeps a copy:
 * once the thing is gone the recipe cannot show it, open it or build with it
 * again, while the pictures stay. The confirmations used to promise that the
 * recipe survived too, and a person found out otherwise only after the
 * delete, which has no undo.
 */
export function deleteLeaves(kind: Exclude<CatalogPickKind, 'draft'>, count: number): string {
  const many = count > 1;
  if (kind === 'owned-scene')
    return many
      ? 'Shots already made here keep their images. Their recipe will say these scenes are gone, and building from one again will miss them.'
      : 'Shots already made here keep their images. Their recipe will say this scene is gone, and building from one again will miss it.';
  if (kind === 'product')
    return many
      ? 'Shots already made with them keep their images. Their recipe loses these products, and building from one again will miss them.'
      : 'Shots already made with it keep their images. Their recipe loses this product, and building from one again will miss it.';
  return many
    ? 'Shots already made with them keep their images. Their recipe loses these people, and building from one again will miss them.'
    : 'Shots already made with them keep their images. Their recipe loses this person, and building from one again will miss them.';
}

/** The dock tooltip and the menu line for Keepers, in the shot's words. */
export function keepersLine(
  count: number,
  allKept: boolean,
  noun: 'scenes' | 'presenters' | 'products',
): { tool: string; menu: string; icon: 'keep' | 'kept' } {
  return {
    tool: allKept ? 'Remove from keepers' : 'Keep',
    menu:
      count > 1
        ? allKept
          ? `Remove ${count} ${noun} from Keepers`
          : `Add ${count} ${noun} to Keepers`
        : allKept
          ? 'Remove from Keepers'
          : 'Add to Keepers',
    icon: allKept ? 'kept' : 'keep',
  };
}

/**
 * The right-click on a card that is in the pick.
 *
 * Open stays about the card under the pointer. Deselect stays about it too.
 * The verb after the rule is the dock's, and it names the whole pick.
 */
export function catalogBatchItems({
  kind,
  count,
  openLabel,
  onOpen,
  href,
  onDeselect,
  onAct,
  onKeep,
  allKept,
}: {
  kind: CatalogPickKind;
  count: number;
  /** A draft continues. Everything else opens. */
  openLabel: 'Open' | 'Continue';
  onOpen: () => void;
  href?: string;
  onDeselect: () => void;
  onAct: () => void;
  /** Keepers on the pick. Drafts have none. */
  onKeep?: () => void;
  allKept?: boolean;
}): CatalogMenuItem[] {
  const verb = catalogPickVerb(kind, count);
  const items: CatalogMenuItem[] = [
    {
      key: 'open',
      icon: openLabel === 'Continue' ? 'continue' : 'open',
      label: openLabel,
      onSelect: onOpen,
    },
  ];
  if (href) {
    items.push({
      key: 'open-tab',
      icon: 'open-tab',
      label: 'Open in new tab',
      onSelect: () => window.open(href, '_blank'),
    });
  }
  items.push({
    key: 'deselect',
    icon: 'select',
    label: count > 1 ? 'Deselect this' : 'Deselect',
    onSelect: onDeselect,
  });
  if (onKeep && kind !== 'draft') {
    const noun = kind === 'presenter' ? 'presenters' : kind === 'product' ? 'products' : 'scenes';
    const keep = keepersLine(count, !!allKept, noun);
    items.push({ key: 'keep', icon: keep.icon, label: keep.menu, onSelect: onKeep });
  }
  items.push({
    key: kind === 'draft' ? 'discard' : 'delete',
    icon: verb.icon,
    label: verb.menu,
    onSelect: onAct,
    danger: verb.danger || undefined,
    separated: true,
  });
  return items;
}

/**
 * Run one existing single-id call for each picked card.
 *
 * A 404 has already gone, so it counts as done. Anything else stays picked,
 * and the first failure is the one the toast reads. The caller refreshes once.
 */
export async function settlePicked(
  ids: string[],
  one: (id: string) => Promise<unknown>,
): Promise<{ failed: string[]; error: unknown }> {
  const failed: string[] = [];
  let error: unknown;
  for (const id of ids) {
    try {
      await one(id);
    } catch (e: unknown) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 404) continue;
      failed.push(id);
      error ??= e;
    }
  }
  return { failed, error };
}
