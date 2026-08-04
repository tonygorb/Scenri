import { useNavigate } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { GearSix, Plus } from '@phosphor-icons/react';
import { BrandAvatar, brandName } from './nav.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
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
        <button type="button" className="bt-avatar-btn" aria-label={`${brandName(brand)} — brand and settings`}>
          <BrandAvatar brand={brand} size={30} round />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content align="end" sideOffset={8} className="bt-menu">
        <div className="bt-menu-head">
          <BrandAvatar brand={brand} size={34} />
          <span className="bt-menu-head-txt">
            <span dir="auto" className="bt-menu-name">
              {brandName(brand)}
            </span>
            <span className="bt-menu-sub">Current brand</span>
          </span>
        </div>

        <div className="bt-menu-sep" />

        {others.map((b) => (
          <DropdownMenu.Item key={b.id} className="bt-menu-item" onSelect={() => navigate(`/b/${b.id}`)}>
            <BrandAvatar brand={b} size={20} />
            <span dir="auto" className="bt-menu-lb">
              {brandName(b)}
            </span>
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Item className="bt-menu-item" onSelect={() => navigate('/setup')}>
          <Plus size={18} className="bt-menu-ic" />
          <span className="bt-menu-lb">Set up a brand</span>
        </DropdownMenu.Item>

        <div className="bt-menu-sep" />

        <DropdownMenu.Item className="bt-menu-item" onSelect={() => openSettings()}>
          <GearSix size={18} className="bt-menu-ic" />
          <span className="bt-menu-lb">Settings</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
