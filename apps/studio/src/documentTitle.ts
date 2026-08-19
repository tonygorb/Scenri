import { matchPath } from 'react-router';
import { P } from './routes.js';

/**
 * The browser-tab title for a pathname, derived from the route table alone.
 * Detail pages get their section rather than an entity name, so the title
 * never waits on data and every tab and history entry still names the surface
 * it holds. First pattern that fits answers.
 */
const TITLES: ReadonlyArray<readonly [string, string]> = [
  [P.setup, 'Setup'],
  [P.hubShot, 'Create'],
  [P.hub, 'Create'],
  [P.setShot, 'Create'],
  [P.set, 'Create'],
  [P.kit, 'Brand kit'],
  [P.product, 'Products'],
  [P.products, 'Products'],
  [P.scene, 'Scenes'],
  [P.scenes, 'Scenes'],
  [P.presenter, 'Presenters'],
  [P.presenters, 'Presenters'],
];

export function titleFor(pathname: string): string {
  for (const [pattern, section] of TITLES) {
    if (matchPath(pattern, pathname)) return `${section} · scenri`;
  }
  return 'scenri studio';
}
