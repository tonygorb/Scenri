import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyText } from '../src/clipboard.js';

const secure = (value: boolean) => Object.defineProperty(window, 'isSecureContext', { value, configurable: true });

afterEach(() => {
  vi.restoreAllMocks();
  secure(true);
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('copyText', () => {
  it('uses the clipboard where the page may', async () => {
    secure(true);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('http://192.168.1.42:4747/?t=K7P2QX')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('http://192.168.1.42:4747/?t=K7P2QX');
  });

  // a phone on the Wi-Fi opens plain http, where navigator.clipboard is undefined
  it('falls back to select and copy over plain http, inside the given host', async () => {
    secure(false);
    let copied = '';
    let parent: Node | null = null;
    document.execCommand = vi.fn(() => {
      const field = document.activeElement as HTMLTextAreaElement;
      copied = field.value.slice(field.selectionStart, field.selectionEnd);
      parent = field.parentNode;
      return true;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(await copyText('http://192.168.1.42:4747/?t=K7P2QX', host)).toBe(true);
    expect(copied).toBe('http://192.168.1.42:4747/?t=K7P2QX');
    expect(parent).toBe(host);
    // the stand-in field leaves no trace
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('says so when neither way works', async () => {
    secure(false);
    document.execCommand = vi.fn(() => false);
    expect(await copyText('x')).toBe(false);
  });
});
