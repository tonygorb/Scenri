/**
 * Which part of scenri a DOM node belongs to.
 *
 * The app has no data-testid — the `sc-` class names are the contract, and the
 * e2e suite already selects on them, so they cannot drift without something
 * else breaking first. Walking up to the nearest recognised one turns a click
 * into "Shot tile" or "Assets panel" without touching a single component.
 *
 * The order is load-bearing: the first match wins, so anything nested inside
 * another surface has to come before its container. A click on the overlay's
 * stage is about the image, not about the overlay.
 */
export const AREAS: readonly (readonly [className: string, area: string])[] = [
  // transient layers, which sit above everything and are what you meant
  ['sc-cmd', 'Command menu'],
  ['sc-toast', 'Toast'],
  ['sc-menu', 'Menu'],
  ['sc-attachpanel', 'Attach panel'],
  // settings, and the one surface that holds a credential
  ['sc-setup-key', 'Provider key form'],
  ['sc-set-row', 'Settings row'],
  // a shot, from most specific outwards
  ['sc-ovl-stage', 'Shot stage'],
  ['sc-ovl-meta', 'Shot inspector'],
  ['sc-fr', 'Version filmstrip'],
  ['sc-prov', 'Provenance thumb'],
  ['sc-ctx-chip', 'Ingredient chip'],
  ['sc-ovl', 'Shot overlay'],
  ['sc-cell', 'Shot tile'],
  // the composer
  ['sc-brief-line', 'Brief line'],
  ['sc-canvas-dock', 'Composer dock'],
  // catalogs
  ['sc-lookcard', 'Catalog card'],
  ['sc-lookpage', 'Catalog page'],
  ['sc-masonry', 'Catalog grid'],
  ['sc-shelf', 'Example shelf'],
  ['sc-thumb', 'Thumbnail'],
  // panels and bars
  ['sc-assets', 'Assets panel'],
  ['sc-toolbar', 'Feed toolbar'],
  ['sc-feed', 'Shot feed'],
  ['sc-topbar', 'Top bar'],
  ['sc-tabbar', 'Tab bar'],
  // screens, last: any of the above is a better answer
  ['sc-canvas', 'Create canvas'],
  ['sc-home', 'Home'],
  ['sc-work', 'Create screen'],
  ['sc-shell', 'App shell'],
] as const;

/**
 * Every recognised area on the path from `el` to the root, nearest first.
 * The head is the answer; the tail is the trail, which is what makes a report
 * greppable — "Shot tile" inside "Shot feed" inside "Create canvas".
 */
export function areaChain(el: Element | null): string[] {
  const out: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const list = n.classList;
    if (!list?.length) continue;
    for (const [cls, area] of AREAS) {
      if (list.contains(cls) && !out.includes(area)) out.push(area);
    }
  }
  return out;
}

/** The single best name for what was clicked, or null if nothing is recognised. */
export const areaOf = (el: Element | null): string | null => areaChain(el)[0] ?? null;
