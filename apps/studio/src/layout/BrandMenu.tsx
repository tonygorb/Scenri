import { useNavigate } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { GearSix, Palette, Plus } from '@phosphor-icons/react';
import { BrandAvatar, brandName } from './nav.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../routes.js';
import { useOpenSettings } from '../views/SettingsDialog.js';

/**
 * The one identity control, at the end of the bar. The avatar is the brand's own
 * logo rather than a person, because there is no person: scenri has no accounts,
 * no session and no profile, and the only identity the server knows is a machine
 * token. It carries the whole brand block, so switching client and reaching
 * Settings are one gesture instead of two controls at opposite ends of the row.
 *
 * The trigger is the avatar alone, so the menu has to say which brand you are in
 * the moment it opens: that is the header, and it is why the list below offers
 * only the *other* brands. Naming the current one twice would be furniture.
 *
 * Theme is deliberately absent. Settings already owns an Appearance pane with
 * the same three choices, and a segmented picker in here outweighed everything
 * around it for a setting nobody changes twice.
 *
 * The brand kit is here rather than in the top nav for the same reason the nav
 * has five items and not six: it is filled in once and revisited rarely, and a
 * nav slot has to earn itself against work you do every session. This menu is
 * already the brand-identity control, so it is where someone looks.
 */
export function BrandMenu() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const others = brands.filter((b) => b.id !== brand.id);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-avatar-btn" aria-label={`${brandName(brand)} — brand and settings`}>
          <BrandAvatar brand={brand} size={30} round />
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

        <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings('brand')}>
          <Palette size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Brand kit</span>
        </DropdownMenu.Item>

        <div className="sc-menu-sep" />

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

        <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings()}>
          <GearSix size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Settings</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
