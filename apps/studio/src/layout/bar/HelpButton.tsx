import { useState } from 'react';
import { ArrowCircleUp, Info, Keyboard, Question, Sparkle } from '@phosphor-icons/react';
import { BarMenu, BarRow } from './BarMenu.js';
import { Shortcuts } from '../Shortcuts.js';
import { useOpenSettings } from '../../app/dialogs.js';
import { useUpdateCenter } from '../../app/UpdateCenter.js';
import { useWhatsNew } from '../../app/WhatsNew.js';

/**
 * Help, in the corner of the page rather than in the bar.
 *
 * Everything here answers "what is this" or "what changed": the release waiting
 * to be installed, what is new in it, the keys, and what you are running. None
 * of that is about the brand you are in, which is why it left the brand's menu,
 * and none of it is a place you go, which is why it is not in the row of places.
 *
 * It sits in the page's corner because that is where help has waited in every
 * application for twenty years, and the bar has better things to spend a slot
 * on. Its menu opens upward out of it.
 */
export function HelpButton() {
  const openSettings = useOpenSettings();
  const updates = useUpdateCenter();
  const whatsNew = useWhatsNew();
  const [keysOpen, setKeysOpen] = useState(false);

  const updateAvailable = Boolean(updates.status?.available);
  // Gold reads as "notice", never as selection. One dot for two reasons — a
  // newer Scenri, or notes not yet read — because two dots on one control says
  // nothing twice. The rows say which it is.
  const showDot = (updateAvailable && !updates.dismissed) || whatsNew.unread;

  return (
    <>
      <BarMenu
        label="Help"
        className="sc-menu-help"
        side="top"
        tip="Help"
        trigger={
          <button type="button" className="sc-help-btn" aria-label="Help">
            <Question size={20} weight="bold" aria-hidden="true" />
            {showDot && <span className="sc-upd-dot" aria-hidden="true" />}
          </button>
        }
      >
        {updateAvailable && (
          <BarRow data-update="" onSelect={() => openSettings('about')}>
            <ArrowCircleUp size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Update available · {updates.status?.latest}</span>
          </BarRow>
        )}
        {/* Permanent, and gated on nothing: the release you are running is
            always a thing you are allowed to read about. */}
        <BarRow onSelect={() => whatsNew.open()}>
          <Sparkle size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">What's new</span>
          {whatsNew.unread && (
            <>
              <span className="sc-menu-new" aria-hidden="true" />
              {/* unread must survive a monochrome display and a screen reader */}
              <span className="sc-vh">, not read yet</span>
            </>
          )}
        </BarRow>
        <BarRow onSelect={() => setKeysOpen(true)}>
          <Keyboard size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Keyboard shortcuts</span>
        </BarRow>
        <BarRow onSelect={() => openSettings('about')}>
          <Info size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">About Scenri</span>
        </BarRow>
      </BarMenu>
      {/* Beside the menu, not in it: a menu item unmounts on select. */}
      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} />
    </>
  );
}
