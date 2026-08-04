import { useMainNav } from './nav.js';

/**
 * The phone's navigation. Destinations belong under the thumb, not behind a
 * button in the top corner, so below 768px the four of them become a real tab
 * bar and the top row goes back to being only about where you are.
 *
 * It is a row of the shell grid rather than a fixed overlay, so the screen above
 * it is genuinely shorter and nothing has to be padded out of its way.
 */
export function TabBar() {
  const items = useMainNav(22);
  return (
    <nav className="sc-tabbar" aria-label="Main">
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              data-on={item.active || undefined}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.go}
            >
              <span className="sc-tab-ic">{item.icon}</span>
              <span className="sc-tab-lb">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
