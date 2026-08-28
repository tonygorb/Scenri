import { Link, useMatch } from 'react-router';
import { BrandMenu } from './BrandMenu.js';
import { NewAssetButton } from '../create/NewAssetButton.js';
import { NotificationsButton } from './Notifications.js';
import { ScenriLockup } from './ScenriMark.js';
import { useMainNav } from './nav.js';
import { useBrand } from '../app/BrandLayout.js';
import { P, brandPath } from '../routes.js';

/**
 * The one chrome bar, mounted once by BrandLayout. Three tracks: where you are,
 * the nav dead centre, what you can do.
 *
 * Everything here is subtraction. No track under the nav, no outline on any
 * control, no divider, nothing uppercase, one hairline at the bottom and 52px
 * of height. The shape of a top bar is not the problem worth solving twice; the
 * amount of furniture in it is. Active is stated by ink and weight alone, which
 * is all it has ever needed.
 */
export function TopBar() {
  const { brand } = useBrand();
  const set = useMatch({ path: P.set, end: false });
  // taken unconditionally: a hook behind || is a hook that only sometimes runs,
  // and React counts them by position
  const hub = useMatch({ path: P.hub, end: false });
  // the assets rail belongs to the hub alone. On Home it was furniture from a
  // screen you were not on.
  const onHub = !!hub || !!set;

  return (
    <header className="sc-topbar" data-project={onHub ? '' : undefined}>
      <a className="sc-skip" href="#main">
        Skip to content
      </a>
      <div className="sc-topbar-lead">
        {/* The lockup at every width. The nav drops to the bottom TabBar below
            768px, which leaves the middle of this bar empty: 155px of clear run
            even at 320, against the 79px the mark asks for. */}
        <Link className="sc-wordmark" aria-label="Scenri home" to={brandPath(brand)}>
          <ScenriLockup />
        </Link>
      </div>
      <MainNav />
      <div className="sc-topbar-end">
        {/* A page's primary action used to be portalled up here below 1280px.
            It is gone: the + beside it does the same job on every screen, and
            the two together overflowed a 360px bar. Above 1280px the library
            pages keep their own button, where it has always been. */}
        <NewAssetButton />
        {/* The assets rail's switch used to sit here, gated on `onHub` — a
            control for one screen's panel, appearing and disappearing from
            the app's chrome as you moved around. It lives in that screen's own
            toolbar now, beside the sort and the tile size, which is the row
            that already answers "how am I looking at this". */}
        <NotificationsButton />
        <BrandMenu />
      </div>
    </header>
  );
}

function MainNav() {
  const items = useMainNav(16);
  return (
    <nav className="sc-nav sc-desktop-only" aria-label="Main">
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <Link to={item.to} data-active={item.active || undefined} aria-current={item.active ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
