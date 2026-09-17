import { Link } from 'react-router';
import { ActivityButton } from './bar/ActivityButton.js';
import { BarNav } from './bar/BarNav.js';
import { BrandButton } from './bar/BrandButton.js';
import { NewButton } from './bar/NewButton.js';
import { useCondensedBar } from './bar/useCondensedBar.js';
import { ScenriMark } from './ScenriMark.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../routes.js';

/**
 * The one chrome bar, mounted once by BrandLayout. Three tracks with equal side
 * columns, so nothing on the right can push the places off centre: the mark
 * alone on the left, the five destinations dead centre, and what you can do on
 * the right, ending in the brand's own mark.
 *
 * The mark is the symbol rather than the lockup. The wordmark spelled the
 * product's name in a row whose whole job is to say where you are inside it,
 * and the row it was spelling it in is the product. What the bar gives back is
 * the width, and the centre column is what takes it.
 *
 * Nothing about Scenri itself is in the row. What is new, the shortcuts and the
 * release you are running sit behind the help button in the corner of the page;
 * the brand's mark at the end keeps the brands, Settings and the way out.
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
        <Link className="sc-mark-btn" aria-label="Scenri home" to={brandPath(brand)}>
          <ScenriMark aria-hidden="true" />
        </Link>
      </div>
      <BarNav />
      <div className="sc-topbar-end">
        <ActivityButton />
        <NewButton />
        <BrandButton />
      </div>
    </header>
  );
}
