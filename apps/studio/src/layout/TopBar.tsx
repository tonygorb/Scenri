import { useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { DropdownMenu, Popover } from '@radix-ui/themes';
import { CaretDown, SidebarSimple } from '@phosphor-icons/react';
import { BrandMenu } from './BrandMenu.js';
import { Coin } from './Coin.js';
import { NotificationsButton } from './Notifications.js';
import { summarizeCredits, useMainNav } from './nav.js';
import type { EngineInfo } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useAssetsPanel, useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../app/brandPath.js';

/**
 * The one chrome bar, mounted once by BrandLayout. Three tracks: where you are,
 * the nav dead centre, what you can do.
 *
 * Everything here is subtraction. No track under the nav, no outline on any
 * control, no fill on the credits, no divider, nothing uppercase, one hairline
 * at the bottom and 52px of height. The shape of a top bar is not the problem
 * worth solving twice; the amount of furniture in it is. Active is stated by
 * ink and weight alone, which is all it has ever needed.
 */
export function TopBar() {
  const { engines } = useAppData();
  const project = useMatch({ path: '/b/:brandId/p/:projectId', end: false });

  return (
    <header className="sc-topbar" data-project={project ? '' : undefined}>
      <a className="sc-skip" href="#main">
        Skip to content
      </a>
      <div className="sc-topbar-lead">
        <span className="sc-wordmark sc-display">scenri</span>
        {project ? (
          <div className="sc-topbar-context">
            <ProjectCrumb slug={project.params.projectId ?? ''} />
          </div>
        ) : null}
      </div>
      <MainNav />
      <div className="sc-topbar-end">
        {project ? <AssetsToggle /> : null}
        <NotificationsButton />
        <Credits engines={engines} />
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
            <button
              type="button"
              data-active={item.active || undefined}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.go}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Second step of the breadcrumb, and a switcher in its own right. */
/** `slug` is what the path carries; an id still resolves, mid-rewrite. */
function ProjectCrumb({ slug }: { slug: string }) {
  const { brand, projects } = useBrand();
  const navigate = useNavigate();
  const here = projects.find((x) => x.slug === slug) ?? projects.find((x) => x.id === slug);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-crumb-btn">
          <b>{here?.name ?? 'Project'}</b>
          <CaretDown size={11} className="sc-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {projects.map((pr) => (
          <DropdownMenu.Item key={pr.id} onSelect={() => navigate(brandPath(brand, `/p/${pr.slug}`))}>
            {pr.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** Reachable at every width: closing the panel on a phone used to be final. */
function AssetsToggle() {
  const { open, toggle } = useAssetsPanel();
  return (
    <button
      type="button"
      className="sc-icon-btn"
      data-on={open || undefined}
      onClick={toggle}
      aria-label="Toggle assets panel"
      aria-pressed={open}
      title="Assets panel (.)"
    >
      <SidebarSimple size={16} mirrored />
    </button>
  );
}

/**
 * Credits are generations, not dollars. Money stays in Settings, where caps are
 * actually configured; the bar only ever says how much work is left.
 */
function Credits({ engines }: { engines: EngineInfo[] }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { left, low, freeOnly, label } = summarizeCredits(engines);

  // the bar outlives the screen now, so an open popover would follow you around
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className="sc-credits-pill"
          data-low={low || undefined}
          aria-label={freeOnly ? 'Unlimited generations on your free engines' : `${left} generations left`}
        >
          <Coin size={14} dim={low} />
          <span className="sc-credits-label">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" className="sc-credits-pop">
        {engines
          .filter((e) => e.available || !e.free)
          .map((e) => (
            <div key={e.id} className="sc-credits-row">
              <div className="sc-credits-line">
                <span className="sc-credits-name">{e.displayName}</span>
                {e.free ? (
                  <span className="sc-credits-free">{e.localOnly ? 'Free · yours' : 'Free'}</span>
                ) : e.generationsLeft === null ? (
                  <span className="sc-credits-none">No limit set</span>
                ) : (
                  <span className="sc-credits-num">
                    {e.generationsLeft} / {e.generationsTotal}
                  </span>
                )}
              </div>
              {!e.free && e.generationsTotal ? (
                <div className="sc-credits-meter">
                  <div style={{ width: `${((e.generationsLeft ?? 0) / e.generationsTotal) * 100}%` }} />
                </div>
              ) : null}
            </div>
          ))}
        <p className="sc-credits-note">Credits are generations. Free engines never count. Set limits in Settings.</p>
      </Popover.Content>
    </Popover.Root>
  );
}
