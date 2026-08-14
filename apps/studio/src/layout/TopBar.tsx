import { useEffect, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { CaretDown, SidebarSimple } from '@phosphor-icons/react';
import { BrandMenu } from './BrandMenu.js';
import { NewAssetButton } from '../create/NewAssetButton.js';
import { NotificationsButton } from './Notifications.js';
import { useMainNav } from './nav.js';
import { api } from '../api.js';
import { useAssetsPanel, useBrand } from '../app/BrandLayout.js';
import { P, brandPath, hubPath, setPath } from '../routes.js';

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
  const navigate = useNavigate();
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
        <button type="button" className="sc-wordmark sc-display" onClick={() => navigate(brandPath(brand))}>
          scenri
        </button>
        {set ? (
          <div className="sc-topbar-context">
            <SetCrumb slug={set.params.setSlug ?? ''} />
          </div>
        ) : null}
      </div>
      <MainNav />
      <div className="sc-topbar-end">
        {/* A page's primary action used to be portalled up here below 1280px.
            It is gone: the + beside it does the same job on every screen, and
            the two together overflowed a 360px bar. Above 1280px the library
            pages keep their own button, where it has always been. */}
        <NewAssetButton />
        {onHub ? <AssetsToggle /> : null}
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

/**
 * Second step of the breadcrumb, a switcher, and the only place a set can be
 * renamed or deleted — which the old project crumb never offered at all, so a
 * name typed once was a name kept forever.
 *
 * `slug` is what the path carries; an id still resolves, mid-rewrite.
 */
function SetCrumb({ slug }: { slug: string }) {
  const { brand, sets, refresh, applySet, dropSet } = useBrand();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [params, setParams] = useSearchParams();
  const here = sets.find((x) => x.slug === slug) ?? sets.find((x) => x.id === slug);

  // a set made from the feed arrives asking to be named, rather than keeping
  // "Untitled set" because nobody found where to change it
  useEffect(() => {
    if (params.get('rename') === null) return;
    setRenaming(true);
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete('rename');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);

  if (!here) return null;

  const rename = async (name: string) => {
    setRenaming(false);
    const clean = name.trim();
    if (!clean || clean === here.name) return;
    const saved = await api.renameSet(here.id, clean);
    // patch and navigate together, then reconcile. Refetching first left one
    // render where the list knew only the old slug and the URL still asked for
    // it, and /s/:slug read that as a deleted set and bounced to the feed
    applySet(saved);
    navigate(setPath(brand, saved), { replace: true });
    void refresh();
  };

  const remove = async () => {
    await api.deleteSet(here.id);
    dropSet(here.id);
    navigate(hubPath(brand), { replace: true });
    void refresh();
  };

  if (renaming) {
    return (
      <input
        className="sc-crumb-input"
        // the control exists only because you asked to rename: landing anywhere
        // but in it would mean a second click to do the thing you just chose
        // biome-ignore lint/a11y/noAutofocus: opened by an explicit Rename
        autoFocus
        defaultValue={here.name}
        aria-label="Set name"
        onBlur={(e) => void rename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
      />
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-crumb-btn">
          <b>{here.name}</b>
          <CaretDown size={11} className="sc-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {/* the hub, not Home: leaving a set is dropping a filter, not leaving */}
        <DropdownMenu.Item onSelect={() => navigate(hubPath(brand))}>All shots</DropdownMenu.Item>
        {sets.length > 1 && <DropdownMenu.Separator />}
        {sets
          .filter((s) => s.id !== here.id)
          .map((s) => (
            <DropdownMenu.Item key={s.id} onSelect={() => navigate(setPath(brand, s))}>
              {s.name}
            </DropdownMenu.Item>
          ))}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => setRenaming(true)}>Rename</DropdownMenu.Item>
        {/* the shots outlive the set: this is a label coming off, not a delete */}
        <DropdownMenu.Item color="red" onSelect={() => void remove()}>
          Delete set
        </DropdownMenu.Item>
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
