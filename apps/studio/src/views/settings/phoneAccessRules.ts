import type { AllowResult, FirewallVerdict, PhoneStatus } from '../../apiTypes.js';

/** How long the page shows the QR code before "Not opening?" opens by itself. */
export const STUCK_AFTER_MS = 30_000;
/** A phone that opened Scenri this recently, before the code was shown, still counts. */
const RECENT_MS = 5 * 60_000;

export type RowAction = 'copy' | 'check' | null;

/** The row's one sentence and one button, the About rows' rule. */
export function phoneRow(s: PhoneStatus | null, failed = false): { sentence: string; action: RowAction } {
  if (failed) return { sentence: "Could not read this computer's network.", action: 'check' };
  if (!s) return { sentence: "Checking this computer's network.", action: null };
  if (s.reach === 'this-computer') {
    return {
      sentence: 'Scenri was started for this computer only. Start it without SCENRI_HOST to open it on your phone.',
      action: null,
    };
  }
  if (s.problem === 'no-network') {
    return { sentence: 'Connect this computer to Wi-Fi, then check again.', action: 'check' };
  }
  if (s.problem === 'blocked' || !s.url) {
    return { sentence: 'Another app is holding this address, so phones cannot open Scenri yet.', action: 'check' };
  }
  return {
    sentence: "Point your phone's camera at the code, or copy the link for another computer.",
    action: 'copy',
  };
}

/**
 * The one link everything carries: the QR code, Copy link. The terminal
 * prints the same value from the same server field.
 */
export const phoneLink = (s: PhoneStatus): string | null => s.url;

/** The code as a person reads it off this screen: two groups of three, "482 913". */
export const groupCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export type Arrival = 'waiting' | 'connected' | 'stuck';

/** Whether a phone has arrived since the code went up. */
export function arrival(s: PhoneStatus, shownAt: number, now: number): Arrival {
  if (s.lastVisit && s.lastVisit.at >= shownAt - RECENT_MS) return 'connected';
  return now - shownAt >= STUCK_AFTER_MS ? 'stuck' : 'waiting';
}

export function arrivalLine(state: Arrival, s: PhoneStatus): string {
  if (state === 'connected') return `Connected. Scenri opened on your ${s.lastVisit?.device ?? 'device'}.`;
  if (state === 'stuck') return 'No phone has opened it yet.';
  return 'Waiting for your phone…';
}

/**
 * The firewall, said up front the moment the code shows, never left for a
 * phone to discover. Blocked is fixable with one press; blocking everything
 * is the person's own setting, so it gets the way to undo it and no button.
 */
export function firewallNotice(
  verdict: FirewallVerdict | null,
  platform: string,
): { text: string; canAllow: boolean } | null {
  if (verdict === 'blocked' && platform === 'darwin') {
    return { text: "Your Mac's firewall is blocking Scenri, so your phone cannot open it yet.", canAllow: true };
  }
  if (verdict === 'blocked' && platform === 'win32') {
    return {
      text: 'Windows Firewall is blocking Scenri on this network, so your phone cannot open it yet.',
      canAllow: true,
    };
  }
  if (verdict === 'blocks-all') {
    return {
      text: "Your Mac's firewall blocks every incoming connection. To open Scenri on your phone, turn off Block all incoming connections in System Settings, Network, Firewall, Options.",
      canAllow: false,
    };
  }
  return null;
}

export type AllowState = 'idle' | 'asking' | AllowResult;

/** What pressing Allow Scenri is doing, or how it ended. */
export function allowLine(state: AllowState, platform: string): string | null {
  const mac = platform === 'darwin';
  switch (state) {
    case 'asking':
      return mac ? 'Enter your Mac password to allow Scenri.' : 'Choose Yes when Windows asks to allow Scenri.';
    case 'done':
      return 'Allowed. Scan the code again.';
    case 'cancelled':
      return 'Nothing changed. Press Allow Scenri to try again.';
    case 'failed':
    case 'unsupported':
      return mac
        ? 'Could not change the firewall. Open System Settings, Network, Firewall, Options, and set node to allow incoming connections.'
        : 'Could not change the firewall. Open Windows Security, Firewall and network protection, Allow an app through firewall, and tick Node.js for Private and Public.';
    default:
      return null;
  }
}

/** What to try when the firewall is not the reason, most likely first. */
export function helpLines(verdict: FirewallVerdict | null, s: PhoneStatus): string[] {
  const lines = ['Your phone has to be on the same Wi-Fi as this computer. Guest networks keep devices apart.'];
  // a firewall this computer could read is named above the help, with its fix
  if (verdict !== 'blocked' && verdict !== 'blocks-all' && verdict !== 'ok') {
    lines.push('If this computer asks whether node may accept incoming connections, allow it.');
  }
  lines.push("If your phone's browser asks to find devices on your local network, allow it.");
  if (s.others.length) lines.push(`Or try ${s.others.join(' or ')}.`);
  return lines;
}
