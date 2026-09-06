import { describe, it, expect } from 'vitest';
import { desktopRow } from '../src/app/desktopRules.js';
import type { DesktopStatus } from '../src/api.js';

const status = (over: Partial<DesktopStatus> = {}): DesktopStatus => ({
  supported: true,
  platform: 'darwin',
  installed: false,
  path: null,
  declined: false,
  installKind: 'managed',
  ...over,
});

describe('desktopRow', () => {
  it('shows nothing to press until the server has answered', () => {
    expect(desktopRow(null, null)).toEqual({ body: 'Checking this machine.', action: null });
  });

  it('offers Add to desktop when nothing is installed, whatever an earlier Not now said', () => {
    expect(desktopRow(status(), null)).toEqual({ body: 'Open Scenri without a terminal.', action: 'add' });
    expect(desktopRow(status({ declined: true }), null).action).toBe('add');
  });

  it('offers Recreate once the icon is there', () => {
    expect(desktopRow(status({ installed: true, path: '/Users/t/Desktop/Scenri.app' }), null)).toEqual({
      body: 'Scenri is on your desktop.',
      action: 'recreate',
    });
  });

  it('is a sentence and no button from source or on an unsupported system', () => {
    expect(desktopRow(status({ installKind: 'dev' }), null)).toEqual({
      body: 'Running from source; nothing to put on a desktop.',
      action: null,
    });
    expect(desktopRow(status({ supported: false, platform: 'linux' }), null)).toEqual({
      body: 'Desktop shortcuts are not available on this system yet.',
      action: null,
    });
  });

  it('shows the server sentence and a Try again after a refusal', () => {
    expect(desktopRow(status(), 'Something else named Scenri is already on your desktop.')).toEqual({
      body: 'Something else named Scenri is already on your desktop.',
      action: 'retry',
    });
  });
});
