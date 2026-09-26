/**
 * The authored release record, rendered as markdown for a GitHub release page.
 *
 * One record, two audiences: What's New reads it in the app, this renders it
 * for the release page, so nobody writes the same sentence twice. A headline
 * update's pictures come along, read from the released tag's own tree, so the
 * page shows exactly the screens that shipped.
 */
import { PICTURE_DIR, type ReleaseEntry } from './notes.data.js';

export interface ReleaseBodyAt {
  /** `owner/repo` on GitHub. Without one there is nowhere to point a picture, and none is shown. */
  slug?: string | null;
  /** The release tag, `v<version>`: pictures are read from the tree that was released. */
  tag: string;
  /** Whether a picture's file is really in that tree. A missing one is left out, never linked broken. */
  has: (file: string) => boolean;
}

export function releaseBody(entry: ReleaseEntry, at: ReleaseBodyAt): string {
  const lines: string[] = [];
  if (entry.title) lines.push(entry.title, '');
  if (entry.sections.length === 0) {
    lines.push('Maintenance release. Nothing here changes how Scenri works for you.', '');
  }
  for (const s of entry.sections) {
    lines.push(`### ${s.heading}`, '');
    if (s.image && at.slug && at.has(s.image.file)) {
      const url = `https://raw.githubusercontent.com/${at.slug}/${at.tag}/${PICTURE_DIR}/${encodeURIComponent(s.image.file)}`;
      lines.push(`![${altText(s.image.alt)}](${url})`, '');
    }
    lines.push(s.body, '');
  }
  return lines.join('\n').trimEnd();
}

/** Alt text that cannot close the image's brackets or break its line. */
function altText(alt: string): string {
  return alt
    .replace(/[[\]\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
