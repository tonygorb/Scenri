import { describe, it, expect } from 'vitest';
import { releaseBody } from '../src/release/body.js';
import { RELEASES } from '../src/release/notes.data.js';
import type { ReleaseEntry } from '../src/release/notes.data.js';

/** The renderer as scripts/release-body.ts wrote it before pictures, kept to prove nothing else moved. */
function before(entry: ReleaseEntry): string {
  const lines: string[] = [];
  if (entry.title) lines.push(entry.title, '');
  if (entry.sections.length === 0) {
    lines.push('Maintenance release. Nothing here changes how Scenri works for you.', '');
  }
  for (const s of entry.sections) lines.push(`### ${s.heading}`, '', s.body, '');
  return lines.join('\n').trimEnd();
}

const nowhere = { slug: null, tag: 'v1.2.0', has: () => false };
const github = { slug: 'tonygorb/scenri', tag: 'v1.2.0', has: () => true };

const titled: ReleaseEntry = {
  version: '1.2.0',
  date: '2026-09-26',
  title: 'A new top bar.',
  sections: [
    { heading: 'Top bar', body: 'The five places sit in the middle of the bar.' },
    { heading: 'Fixes', body: 'Enter presses the focused control.' },
  ],
};
const untitled: ReleaseEntry = {
  version: '1.2.0',
  date: '2026-09-26',
  sections: [{ heading: 'Fixes', body: 'Enter presses the focused control.' }],
};
const maintenance: ReleaseEntry = { version: '1.2.0', date: '2026-09-26', sections: [] };

const pictured = (alt = 'The top bar with Create underlined.'): ReleaseEntry => ({
  ...titled,
  sections: [{ ...titled.sections[0], image: { file: '1.2.0-top-bar.webp', alt } }, titled.sections[1]],
});
const PICTURE_URL =
  'https://raw.githubusercontent.com/tonygorb/scenri/v1.2.0/apps/studio/src/assets/whatsnew/1.2.0-top-bar.webp';

describe('releaseBody: the words, exactly as before', () => {
  it('a headline update: the title, then each section', () => {
    expect(releaseBody(titled, nowhere)).toBe(
      [
        'A new top bar.',
        '',
        '### Top bar',
        '',
        'The five places sit in the middle of the bar.',
        '',
        '### Fixes',
        '',
        'Enter presses the focused control.',
      ].join('\n'),
    );
  });

  it('a small update: the sections alone', () => {
    expect(releaseBody(untitled, nowhere)).toBe('### Fixes\n\nEnter presses the focused control.');
  });

  it('a maintenance release: one sentence', () => {
    expect(releaseBody(maintenance, nowhere)).toBe(
      'Maintenance release. Nothing here changes how Scenri works for you.',
    );
  });

  it('every real record without pictures renders as it always did', () => {
    for (const entry of RELEASES) {
      expect(releaseBody(entry, nowhere), entry.version).toBe(before(entry));
      if (!entry.sections.some((s) => s.image)) {
        expect(releaseBody(entry, { ...github, tag: `v${entry.version}` }), entry.version).toBe(before(entry));
      }
    }
  });
});

describe('releaseBody: pictures', () => {
  it('puts a picture from the released tree between its heading and its words', () => {
    const asked: string[] = [];
    const body = releaseBody(pictured(), {
      ...github,
      has: (file) => {
        asked.push(file);
        return true;
      },
    });
    expect(body).toBe(
      [
        'A new top bar.',
        '',
        '### Top bar',
        '',
        `![The top bar with Create underlined.](${PICTURE_URL})`,
        '',
        'The five places sit in the middle of the bar.',
        '',
        '### Fixes',
        '',
        'Enter presses the focused control.',
      ].join('\n'),
    );
    expect(asked).toEqual(['1.2.0-top-bar.webp']);
  });

  it('shows no picture without a repository to point at', () => {
    for (const slug of [undefined, null, '']) {
      expect(releaseBody(pictured(), { ...github, slug })).toBe(before(pictured()));
    }
  });

  it('shows no picture whose file is not in the tree', () => {
    expect(releaseBody(pictured(), { ...github, has: () => false })).toBe(before(pictured()));
  });

  it('keeps alt text on one line and inside its brackets', () => {
    const body = releaseBody(pictured('The [new] top bar\nwith Create\r\nunderlined.'), github);
    expect(body).toContain(`![The new top bar with Create underlined.](${PICTURE_URL})`);
    expect(body.split('\n').filter((l) => l.startsWith('!['))).toHaveLength(1);
  });

  it('never lets a backslash escape the closing bracket', () => {
    const body = releaseBody(pictured('The top bar with Create underlined\\'), github);
    expect(body).toContain(`![The top bar with Create underlined](${PICTURE_URL})`);
  });
});
