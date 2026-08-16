import { useNavigate } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { ArrowCircleUp, CaretDown, GearSix, Plus } from '@phosphor-icons/react';
import { BrandAvatar, brandName } from './nav.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useUpdateCenter } from '../app/UpdateCenter.js';
import { brandPath } from '../routes.js';
import { useOpenSettings } from '../app/dialogs.js';

/**
 * The one identity control, at the end of the bar. The mark is the brand's own
 * logo rather than a person, because there is no person: scenri has no accounts,
 * no session and no profile, and the only identity the server knows is a machine
 * token. It carries the whole brand block, so switching client and reaching
 * Settings are one gesture instead of two controls at opposite ends of the row.
 *
 * The trigger names the brand, because a lone circle in this corner reads as an
 * account in an app that has none. Below 1024px the name and caret drop and the
 * mark stands alone: the phone bar was better as a mark, and it is also where
 * the set crumb needs the room. The header below is rendered at every width and
 * hidden by CSS above 1024: it answers "which brand am I in" only where the
 * trigger cannot. The list offers the *other* brands throughout, because naming
 * the current one in a list of things to switch to is asking you to switch to
 * where you already are.
 *
 * Theme is deliberately absent. Settings already owns an Appearance pane with
 * the same three choices, and a segmented picker in here outweighed everything
 * around it for a setting nobody changes twice.
 *
 * The brand kit has no row of its own. It is the first pane in Settings and the
 * one Settings opens on, so a second door beside "Settings" was two names for
 * one place. It stays out of the top nav for the same reason the nav has five
 * items and not six: it is filled in once and revisited rarely, and a nav slot
 * has to earn itself against work you do every session.
 */
export function BrandMenu() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const updates = useUpdateCenter();
  const others = brands.filter((b) => b.id !== brand.id);
  // Gold reads as "notice", never as selection (active state is monochrome by
  // doctrine). The dot follows the banner's dismissal: waved away is waved away.
  const updateAvailable = Boolean(updates.status?.available);
  const showDot = updateAvailable && !updates.dismissed;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-org-btn" aria-label={`${brandName(brand)}, brand and settings`}>
          <BrandAvatar brand={brand} size={22} />
          <span dir="auto" className="sc-org-name">
            {brandName(brand)}
          </span>
          <CaretDown size={11} className="sc-caret" />
          {showDot && <span className="sc-upd-dot" aria-hidden="true" />}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content align="end" sideOffset={8} className="sc-menu">
        <div className="sc-menu-head">
          <BrandAvatar brand={brand} size={34} />
          <span className="sc-menu-head-txt">
            <span dir="auto" className="sc-menu-name">
              {brandName(brand)}
            </span>
            <span className="sc-menu-sub">Current brand</span>
          </span>
        </div>

        {others.map((b) => (
          <DropdownMenu.Item key={b.id} className="sc-menu-item" onSelect={() => navigate(brandPath(b))}>
            <BrandAvatar brand={b} size={20} />
            <span dir="auto" className="sc-menu-lb">
              {brandName(b)}
            </span>
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => navigate('/setup')}>
          <Plus size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Set up a brand</span>
        </DropdownMenu.Item>

        <div className="sc-menu-sep" />

        {updateAvailable && (
          <DropdownMenu.Item className="sc-menu-item" data-update="" onSelect={() => openSettings('about')}>
            <ArrowCircleUp size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Update available — {updates.status?.latest}</span>
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings()}>
          <GearSix size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Settings</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
