import { Link } from 'react-router';
import { useMainNav } from '../nav.js';

/**
 * The five places, centred, as words. The one you are on is underlined on the
 * bar's own hairline rather than filled: a filled pill in a row of five reads as
 * a button among labels, and the underline sits on the line the bar already
 * draws, so the active state costs the row no height.
 *
 * Hidden by CSS below 768px, not by a media query in JS: the places move to the
 * tab bar there, and a JS gate would flash the wrong one on mount.
 */
export function BarNav() {
  const items = useMainNav(16);
  return (
    <nav className="sc-nav sc-desktop-only" aria-label="Main">
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to={item.to}
              data-active={item.active || undefined}
              data-guide={`nav.${item.key}`}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
