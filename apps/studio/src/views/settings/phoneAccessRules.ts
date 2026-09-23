import type { FirewallVerdict, PhoneStatus } from '../../apiTypes.js';

/** How long the QR code shows before "Not opening?" opens by itself. */
export const STUCK_AFTER_MS = 30_000;
/** A phone that opened Scenri this recently, before the code was shown, still counts. */
const RECENT_MS = 5 * 60_000;

export type RowAction = 'show' | 'check' | null;

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
  return { sentence: 'Use Scenri on a phone, tablet or another computer on the same Wi-Fi.', action: 'show' };
}

/**
 * The one link everything carries: the QR code, Copy link. The terminal
 * prints the same value from the same server field.
 */
export const phoneLink = (s: PhoneStatus): string | null => s.url;

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
 * What to try, most likely first. The firewall line names this computer's
 * actual problem when the server could read it; otherwise the general line.
 */
export function helpLines(verdict: FirewallVerdict | null, s: PhoneStatus): string[] {
  const lines: string[] = [];
  if (verdict === 'blocked' && s.platform === 'darwin') {
    lines.push(
      "Your Mac's firewall is blocking Scenri. Open System Settings, Network, Firewall, Options, and set node to allow incoming connections.",
    );
  } else if (verdict === 'blocked' && s.platform === 'win32') {
    lines.push(
      'Windows Firewall is blocking Scenri. Open Windows Security, Firewall and network protection, Allow an app through firewall, and tick Node.js for Private and Public.',
    );
  } else if (verdict === 'public-network') {
    lines.push(
      'Windows treats this Wi-Fi as public, where Scenri is not allowed. Open Settings, Network and internet, Wi-Fi, choose this network, and set it to Private.',
    );
  }
  lines.push('Your phone has to be on the same Wi-Fi as this computer. Guest networks keep devices apart.');
  if (verdict !== 'blocked' && verdict !== 'public-network' && verdict !== 'ok') {
    lines.push('If this computer asks whether node may accept incoming connections, allow it.');
  }
  lines.push("If your phone's browser asks to find devices on your local network, allow it.");
  if (s.others.length) lines.push(`Or try ${s.others.join(' or ')}.`);
  return lines;
}
