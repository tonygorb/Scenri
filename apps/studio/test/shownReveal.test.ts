import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Shown } from '../src/layout/ReferenceGallery.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
const mount = (props: Parameters<typeof Shown>[0]) => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Shown, props)));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// Every catalog picture reveals the way the feed does: held invisible on its
// card until it has decoded, then faded in; and one this session has already
// decoded paints at once, so a wall revisited does not flash.
describe('a picture that exists', () => {
  it('waits on its ground with the placeholder, then is ready once it loads', () => {
    const el = mount({ src: '/pic-a.webp', wait: true });
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.hasAttribute('data-ready')).toBe(false);
    expect(el.querySelector('.sc-placeholder')).not.toBeNull();
    act(() => img.dispatchEvent(new Event('load')));
    expect(img.hasAttribute('data-ready')).toBe(true);
    expect(el.querySelector('.sc-placeholder')).toBeNull();
  });

  it('paints at once, eagerly, when this session has already decoded it', () => {
    const first = mount({ src: '/pic-b.webp' });
    act(() => (first.querySelector('img') as HTMLImageElement).dispatchEvent(new Event('load')));
    act(() => root?.unmount());
    const again = mount({ src: '/pic-b.webp', wait: true });
    const img = again.querySelector('img') as HTMLImageElement;
    expect(img.hasAttribute('data-ready')).toBe(true);
    expect(img.getAttribute('loading')).toBe('eager');
    expect(again.querySelector('.sc-placeholder')).toBeNull();
  });

  it('says it is missing with the blank box, and tries a new picture again', () => {
    const el = mount({ src: '/gone.webp', blank: 'sc-lookcard-blank' });
    act(() => (el.querySelector('img') as HTMLImageElement).dispatchEvent(new Event('error')));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.sc-lookcard-blank')).not.toBeNull();
    act(() => root?.render(createElement(Shown, { src: '/arrived.webp', blank: 'sc-lookcard-blank' })));
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/arrived.webp');
  });
});
