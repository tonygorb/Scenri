import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { House, PlusCircle, Stack, UsersThree } from '@phosphor-icons/react';
import { assetUrl, type Brand, type EngineInfo } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';

/**
 * The four destinations, and the credit maths, shared by the bar and the sheet.
 * They live here rather than in TopBar so the two navs cannot drift: a label or
 * an active rule fixed in one is fixed in both.
 */
export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  go: () => void;
}

/**
 * The nav reads where it is from the router, so no screen can hand it a wrong
 * answer. Create is the odd one out: with nothing open it asks which project
 * rather than guessing the newest.
 */
export function useMainNav(iconSize: number): NavItem[] {
  const { brand } = useBrand();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const picker = useDialogParam('picker');
  const base = `/b/${brand.id}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  const onCreate = rest.startsWith('/p/');

  // the glyph fills where you are: a real Phosphor weight, not a stroked icon
  // told to fill, which thickens the counters and reads as a smudge
  const w = (on: boolean) => (on ? ('fill' as const) : ('regular' as const));

  const home = rest === '' || rest === '/';
  const looks = rest.startsWith('/looks');
  const brandPage = rest.startsWith('/brand');

  return [
    {
      key: 'home',
      label: 'Home',
      icon: <House size={iconSize} weight={w(home)} />,
      active: home,
      go: () => navigate(base),
    },
    {
      key: 'create',
      label: 'Create',
      icon: <PlusCircle size={iconSize} weight={w(onCreate)} />,
      active: onCreate,
      go: () => {
        if (!onCreate) picker.open('1');
      },
    },
    {
      key: 'looks',
      label: 'Looks',
      icon: <Stack size={iconSize} weight={w(looks)} />,
      active: looks,
      go: () => navigate(`${base}/looks`),
    },
    {
      key: 'brand',
      label: 'Brand',
      icon: <UsersThree size={iconSize} weight={w(brandPage)} />,
      active: brandPage,
      go: () => navigate(`${base}/brand`),
    },
  ];
}

export interface CreditsSummary {
  left: number;
  total: number;
  low: boolean;
  freeOnly: boolean;
  label: string;
}

/**
 * Credits, not dollars: chrome speaks in generations remaining. Free engines
 * never count, so a machine running only free engines reads as abundance.
 */
export function summarizeCredits(engines: EngineInfo[]): CreditsSummary {
  const metered = engines.filter((e) => !e.free && e.generationsLeft !== null);
  const left = metered.reduce((s, e) => s + (e.generationsLeft ?? 0), 0);
  const total = metered.reduce((s, e) => s + (e.generationsTotal ?? 0), 0);
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 1;
  const freeOnly = metered.length === 0;
  return { left, total, low: total > 0 && pct < 0.15, freeOnly, label: freeOnly ? 'Unlimited' : `${left} left` };
}

export const brandName = (b: Brand): string => b.json?.meta?.name ?? b.slug;

/** First letter that carries meaning, which is not always the first character. */
function monogram(name: string): string {
  const first = [...name.trim()].find((c) => /\p{L}|\p{N}/u.test(c));
  return (first ?? '?').toUpperCase();
}

/** Black or white, whichever the brand's own colour can actually carry. */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.42 ? '#0a0a0a' : '#ffffff';
}

/**
 * A 7px square of colour said "a brand exists". This says which one: the kit's
 * own logo when it has one, and otherwise its initial on its own primary, which
 * is what every workspace switcher worth copying does.
 */
export function BrandAvatar({ brand, size = 20, round }: { brand: Brand; size?: number; round?: boolean }) {
  const logo = assetUrl(brand.json?.logos?.[0]?.file);
  const hex: string = brand.json?.palette?.primary?.hex ?? '#6b6b6b';
  return (
    <span
      className="bt-brand-av"
      data-logo={logo ? '' : undefined}
      data-round={round ? '' : undefined}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        ...(logo ? {} : { background: hex, color: inkOn(hex) }),
      }}
      aria-hidden
    >
      {logo ? <img src={logo} alt="" /> : monogram(brandName(brand))}
    </span>
  );
}
