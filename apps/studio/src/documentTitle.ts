import { matchPath } from 'react-router';
import { P } from './routes.js';

const BRAND = 'Scenri';
const SEP = ' - ';

/** Past this, no tab strip draws the rest anyway. */
const MAX = 40;

/**
 * A dialog is the foreground, so it names the tab over whatever is behind it.
 * These are real URLs: they survive a refresh and answer to Back, so a tab
 * parked on one should say so.
 *
 * `new` is deliberately absent. The create form is a step inside the surface
 * you are already on, not a place you leave a tab sitting.
 */
const DIALOGS: ReadonlyArray<readonly [string, string]> = [
  ['whatsnew', "What's new"],
  ['setup', 'Providers'],
  ['settings', 'Settings'],
];

/**
 * Every route's section, and whether the thing on screen may speak for it.
 * First pattern that fits answers, which is why a shot overlay is a shot
 * rather than the set underneath it, and why the bare brand path is last.
 *
 * Every routed surface names itself, so the brand always follows the dash. The
 * bare word is the last resort only, for a path the table does not know, which
 * the router redirects away from anyway.
 */
const TITLES: ReadonlyArray<readonly [string, string, boolean]> = [
  [P.setup, 'Set up', false],
  [P.hubShot, 'Shot', false],
  [P.setShot, 'Shot', false],
  [P.hub, 'Create', false],
  [P.set, 'Create', true],
  [P.kit, 'Brand kit', false],
  [P.product, 'Products', true],
  [P.products, 'Products', false],
  [P.scene, 'Scenes', true],
  [P.scenes, 'Scenes', false],
  [P.presenter, 'Presenters', true],
  [P.presenters, 'Presenters', false],
  [P.brand, 'Home', false],
];

/**
 * A name on its way into the tab.
 *
 * `document.title` takes a string and is never parsed as markup, so there is
 * nothing here to escape. What does need handling is a name that is empty, is
 * only whitespace, carries a newline that arrived with a paste, or runs longer
 * than the tab will ever draw. Null for anything that leaves nothing behind,
 * which puts the section name back rather than the word "undefined".
 */
function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text;
}

/**
 * The browser-tab title for where you are: the dialog if one is open, else the
 * name of the thing on screen, else the section holding it. The section comes
 * from the route table alone, so a title never waits on data and every tab and
 * history entry names something real from the first paint.
 */
export function titleFor(pathname: string, search = '', entity: string | null = null): string {
  const params = new URLSearchParams(search);
  for (const [key, label] of DIALOGS) {
    if (params.has(key)) return label + SEP + BRAND;
  }

  for (const [pattern, section, named] of TITLES) {
    if (!matchPath(pattern, pathname)) continue;
    return ((named ? cleanTitle(entity) : null) ?? section) + SEP + BRAND;
  }
  return BRAND;
}
