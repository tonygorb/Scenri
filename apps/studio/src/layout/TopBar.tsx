import type { ReactNode } from 'react';
import { Popover } from '@radix-ui/themes';
import { Moon, Sun } from '@phosphor-icons/react';
import { Coin } from './Coin.js';
import { useThemeMode } from '../theme.js';
import type { EngineInfo } from '../api.js';

export interface NavItem {
  label: string;
  /** Shown instead of the label under 768px. */
  icon?: ReactNode;
  active?: boolean;
  onClick: () => void;
}

/**
 * Shared chrome bar: view-specific content left, pill nav centered, credits
 * and theme on the right. Nav items arrive as props so the bar never claims
 * a surface that does not exist yet.
 */
export function TopBar({
  left,
  right,
  nav,
  engines,
}: {
  left: ReactNode;
  right?: ReactNode;
  nav?: NavItem[];
  engines: EngineInfo[];
}) {
  return (
    <div className="bt-topbar">
      <div className="bt-topbar-left">{left}</div>
      {nav && nav.length > 0 && (
        <nav className="bt-nav" aria-label="Main">
          {nav.map((item) => (
            <button
              type="button"
              key={item.label}
              data-active={item.active || undefined}
              onClick={item.onClick}
              aria-label={item.label}
            >
              {item.icon && <span className="bt-nav-ic">{item.icon}</span>}
              <span className="bt-nav-lb">{item.label}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="bt-topbar-right">
        {right}
        <Credits engines={engines} />
        <ThemeButton />
      </div>
    </div>
  );
}

export function Wordmark() {
  return (
    <span className="bt-display" style={{ fontSize: 15 }}>
      scenri
    </span>
  );
}

function ThemeButton() {
  const { mode, toggle } = useThemeMode();
  return (
    <button
      type="button"
      className="bt-icon-btn"
      onClick={toggle}
      title="Theme"
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

/**
 * Credits, not dollars: chrome speaks in generations remaining. Free engines
 * lead the list so the resting state reads as abundance; money stays in
 * Settings where caps are actually configured.
 */
export function Credits({ engines }: { engines: EngineInfo[] }) {
  const metered = engines.filter((e) => !e.free && e.generationsLeft !== null);
  const left = metered.reduce((s, e) => s + (e.generationsLeft ?? 0), 0);
  const total = metered.reduce((s, e) => s + (e.generationsTotal ?? 0), 0);
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 1;
  const low = total > 0 && pct < 0.15;
  const freeOnly = metered.length === 0;
  const label = freeOnly ? 'Unlimited' : `${left} left`;

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button
          type="button"
          className="bt-credits-pill"
          aria-label={freeOnly ? 'Unlimited generations on your free engines' : `${left} generations left`}
        >
          <Coin size={14} dim={low} />
          <span className="bt-credits-label">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" style={{ width: 268, padding: 6 }}>
        {engines
          .filter((e) => e.available || !e.free)
          .map((e) => (
            <div key={e.id} style={{ padding: '9px 10px', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{e.displayName}</span>
                {e.free ? (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 650,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      border: '1px solid color-mix(in srgb, var(--bt-gold) 45%, transparent)',
                      color: 'var(--bt-star)',
                      padding: '1px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {e.localOnly ? 'Free · yours' : 'Free'}
                  </span>
                ) : e.generationsLeft === null ? (
                  <span style={{ fontSize: 12, color: 'var(--bt-fg3)' }}>No limit set</span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bt-fg2)' }}>
                    {e.generationsLeft} / {e.generationsTotal}
                  </span>
                )}
              </div>
              {!e.free && e.generationsTotal ? (
                <div
                  style={{ height: 3, borderRadius: 2, background: 'var(--bt-line)', overflow: 'hidden', marginTop: 6 }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${((e.generationsLeft ?? 0) / e.generationsTotal) * 100}%`,
                      background: 'var(--bt-gold)',
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--bt-fg3)',
            padding: '8px 10px',
            borderTop: '1px solid var(--bt-line)',
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          Credits are generations. Free engines never count. Set limits in Settings.
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
