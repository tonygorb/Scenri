import { Link } from 'react-router';
import { ActivityButton } from './bar/ActivityButton.js';
import { BarNav } from './bar/BarNav.js';
import { BrandButton } from './bar/BrandButton.js';
import { LearnButton } from './bar/LearnButton.js';
import { NewButton } from './bar/NewButton.js';
import { useCondensedBar } from './bar/useCondensedBar.js';
import { ScenriLockup } from './ScenriMark.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../routes.js';

/**
 * The one chrome bar, mounted once by BrandLayout. Three tracks with equal side
 * columns, so nothing on the right can push the places off centre: the mark
 * alone on the left, the five destinations dead centre, and what you can do on
 * the right, ending in the brand's own mark.
 *
 * The mark is the full lockup, symbol and name, bare: no box behind it at rest
 * or under the pointer. It is the product's signature at the start of the row
 * and the way home, not a button, so the pointer and the ring on keyboard focus
 * are all it needs to say it can be pressed.
 *
 * Nothing about Scenri itself is in the row. What is new, the shortcuts and the
 * release you are running are help's business, not the bar's; the brand's mark
 * at the end keeps the brands, Settings and the way out.
 */
export function TopBar() {
  const { brand } = useBrand();
  useCondensedBar();

  return (
    <header className="sc-topbar">
      <a className="sc-skip" href="#main">
        Skip to content
      </a>
      <div className="sc-topbar-lead">
        {/* The mark's ink starts on the gutter line rather than its box, which
            is what the eye measures the row's left edge by. */}
        <Link className="sc-wordmark" aria-label="Scenri home" to={brandPath(brand)}>
          <ScenriLockup aria-hidden="true" />
        </Link>
      </div>
      <BarNav />
      <div className="sc-topbar-end">
        <LearnButton />
        <ActivityButton />
        <NewButton />
        <BrandButton />
      </div>
    </header>
  );
}
