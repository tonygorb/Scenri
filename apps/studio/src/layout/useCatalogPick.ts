import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { CatalogPickKind } from './catalogPick.js';

interface Pick {
  kind: CatalogPickKind | null;
  ids: Set<string>;
}

const empty = (): Pick => ({ kind: null, ids: new Set() });

/**
 * One pick on a catalog wall.
 *
 * The first tick chooses the kind. A card of another kind keeps opening,
 * because a library scene and a scene you own are different jobs. Search and
 * the facet clear it: the set you were acting on just changed.
 */
export function useCatalogPick(filterKey: string) {
  const [pick, setPick] = useState<Pick>(empty);

  const clear = useCallback(() => setPick(empty()), []);

  useEffect(() => {
    clear();
  }, [filterKey, clear]);

  useEffect(() => {
    if (pick.ids.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== 'Escape') return;
      clear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pick.ids.size, clear]);

  const toggle = useCallback((next: CatalogPickKind, id: string) => {
    setPick((cur) => {
      if (cur.kind && cur.kind !== next) return cur;
      const ids = new Set(cur.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return ids.size ? { kind: cur.kind ?? next, ids } : empty();
    });
  }, []);

  const selectAll = useCallback((next: CatalogPickKind, all: string[]) => {
    setPick({ kind: next, ids: new Set(all) });
  }, []);

  /** Drop the cards that went. What is left is still the pick. */
  const retain = useCallback((keep: string[]) => {
    const allow = new Set(keep);
    setPick((cur) => {
      const ids = new Set([...cur.ids].filter((id) => allow.has(id)));
      return ids.size ? { kind: cur.kind, ids } : empty();
    });
  }, []);

  const forget = useCallback((id: string) => {
    setPick((cur) => {
      if (!cur.ids.has(id)) return cur;
      const ids = new Set(cur.ids);
      ids.delete(id);
      return ids.size ? { kind: cur.kind, ids } : empty();
    });
  }, []);

  /**
   * A click on empty wall, the pointer's Escape. A card, a control and the
   * toolbar keep their own meaning.
   */
  const onBlank = useCallback(
    (e: MouseEvent) => {
      if (pick.ids.size === 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('.sc-lookcard, .sc-picked, button, a, input, select, textarea, label, [role], [contenteditable]'))
        return;
      clear();
    },
    [pick.ids.size, clear],
  );

  const picking = useCallback((next: CatalogPickKind) => pick.kind === null || pick.kind === next, [pick.kind]);

  return {
    kind: pick.kind,
    ids: pick.ids,
    toggle,
    selectAll,
    clear,
    retain,
    forget,
    onBlank,
    picking,
    batching: pick.kind,
  };
}
