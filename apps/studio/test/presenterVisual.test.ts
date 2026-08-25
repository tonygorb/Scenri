import { describe, it, expect } from 'vitest';
import { characterAvatar, presenterAvatar } from '../src/presenterVisual.js';

const H = 'a'.repeat(32);
const H2 = 'b'.repeat(32);

describe('presenterAvatar', () => {
  it('uses the purpose-built avatar with no crop correction', () => {
    expect(presenterAvatar({ avatarUrl: '/api/presenter-avatars/x.jpg', previewUrl: '/p.jpg' })).toEqual({
      src: '/api/presenter-avatars/x.jpg',
    });
  });

  it('falls back to the card, flagged for the top crop', () => {
    expect(presenterAvatar({ avatarUrl: null, previewUrl: '/p.jpg' })).toEqual({ src: '/p.jpg', crop: 'top' });
  });

  it('falls back to the first shot, still flagged', () => {
    expect(presenterAvatar({ avatarUrl: null, previewUrl: null, shots: ['/s1.png', '/s2.png'] })).toEqual({
      src: '/s1.png',
      crop: 'top',
    });
  });

  it('a presenter with nothing renders nothing rather than a broken image', () => {
    expect(presenterAvatar({ avatarUrl: null, previewUrl: null })).toEqual({ src: null });
  });
});

describe('characterAvatar', () => {
  it('prefers the roster avatar ref, uncropped', () => {
    expect(characterAvatar({ avatar: `asset:${H}`, preview: `asset:${H2}` })).toEqual({
      src: `/api/images/${H}`,
    });
  });

  it('walks preview, then shots, then the source photos, each flagged', () => {
    expect(characterAvatar({ preview: `asset:${H}` })).toEqual({ src: `/api/images/${H}`, crop: 'top' });
    expect(characterAvatar({ shots: [{ file: `asset:${H}` }] })).toEqual({ src: `/api/images/${H}`, crop: 'top' });
    expect(characterAvatar({ sourceRefs: [{ file: `asset:${H}` }] })).toEqual({
      src: `/api/images/${H}`,
      crop: 'top',
    });
  });

  it('ignores refs that are not asset-addressed', () => {
    expect(characterAvatar({ avatar: 'https://x.example/logo.png' })).toEqual({ src: null });
  });
});
