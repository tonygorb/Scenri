import {
  ArrowCircleUp,
  GithubLogo,
  GraduationCap,
  HandWaving,
  Info,
  Keyboard,
  Lightning,
  Megaphone,
  Question,
} from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { useMatch } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { learnOpener, useOpenLearn, useOpenSettings, useOpenSetup, useOpenWelcome } from '../app/dialogs.js';
import { WELCOME } from '../guidedTasks.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { useUpdateCenter } from '../app/UpdateCenter.js';
import { FIRST_USE } from '../firstUse.js';
import { P } from '../routes.js';
import { Tip } from './Tip.js';

const GITHUB = 'https://github.com/tonygorb/scenri';

/**
 * Help, in one place (DESIGN.md, "First use"): Learn, every lesson there is
 * (the bar carries it too from 1024px), the welcome again, and the help the
 * app already has, gathered. It is always the corner float, never a second
 * icon in the top bar. From 1024px it sits 16px off the bottom-right, and
 * steps left of the assets rail. On a phone it parks above the tab bar, and
 * above a composer that has gone full width. Between those widths the
 * composer is an island, so the same 16px corner as desktop is free.
 */
export function HelpMenu() {
  const hub = useMatch(P.hub);
  const set = useMatch(P.set);
  const onCreate = !!hub || !!set;
  const whatsNew = useWhatsNew();
  const updates = useUpdateCenter();
  // The help button is where this machine's news lives now that the brand menu
  // is about brands: a waiting update or unread notes put the dot on it, and on
  // a source checkout, which gets no float, the dot and the row are all the
  // unprompted news there is.
  const updateAvailable = Boolean(updates.status?.available);
  const showDot = (updateAvailable && !updates.dismissed) || whatsNew.unread;
  const openSettings = useOpenSettings();
  const openSetup = useOpenSetup();
  const openLearn = useOpenLearn();
  const openWelcome = useOpenWelcome();
  const { engines } = useAppData();
  const noEngine = !engines.some((e) => e.available);

  return (
    <div className="sc-help-float">
      <DropdownMenu.Root>
        <Tip label="Help">
          <DropdownMenu.Trigger>
            <button type="button" className="sc-icon-btn sc-help-btn" aria-label="Help">
              <Question size={16} />
              {showDot && <span className="sc-upd-dot" aria-hidden="true" />}
            </button>
          </DropdownMenu.Trigger>
        </Tip>
        <DropdownMenu.Content align="end" side="top" sideOffset={8} className="sc-menu sc-help-menu">
          {updateAvailable && (
            <DropdownMenu.Item className="sc-menu-item" data-update="" onSelect={() => openSettings('updates')}>
              <ArrowCircleUp size={18} className="sc-menu-ic" />
              <span className="sc-menu-lb">Update available · {updates.status?.latest}</span>
            </DropdownMenu.Item>
          )}
          {/* The ways into first use, gone with it while it is paused (firstUse.ts). */}
          {FIRST_USE && (
            <>
              <DropdownMenu.Item
                className="sc-menu-item"
                onSelect={() => {
                  learnOpener.current = 'help';
                  openLearn();
                }}
              >
                <GraduationCap size={18} className="sc-menu-ic" />
                <span className="sc-menu-lb">Learn</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="sc-menu-item" onSelect={() => openWelcome()}>
                <HandWaving size={18} className="sc-menu-ic" />
                <span className="sc-menu-lb">{WELCOME.again}</span>
              </DropdownMenu.Item>
            </>
          )}
          {onCreate && (
            <DropdownMenu.Item
              className="sc-menu-item"
              onSelect={() => window.dispatchEvent(new Event('scenri:shortcuts'))}
            >
              <Keyboard size={18} className="sc-menu-ic" />
              <span className="sc-menu-lb">Keyboard shortcuts</span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className="sc-menu-item" onSelect={() => whatsNew.open()}>
            <Megaphone size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">What's new</span>
            {whatsNew.unread && (
              <>
                <span className="sc-menu-new" aria-hidden="true" />
                <span className="sc-vh">, not read yet</span>
              </>
            )}
          </DropdownMenu.Item>
          {noEngine && (
            <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSetup()}>
              <Lightning size={18} className="sc-menu-ic" />
              <span className="sc-menu-lb">Set up image generation</span>
            </DropdownMenu.Item>
          )}
          <div className="sc-menu-sep" />
          <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings('about')}>
            <Info size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">About Scenri</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="sc-menu-item" asChild>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">
              <GithubLogo size={18} className="sc-menu-ic" />
              <span className="sc-menu-lb">Scenri on GitHub</span>
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

/** The corner button, at every width. */
export function HelpFloat() {
  return <HelpMenu />;
}
