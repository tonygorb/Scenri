/**
 * Release notes come from the GitHub release release-please already writes —
 * one changelog source powers the CHANGELOG, the release page, and this. Any
 * failure returns null and the UI links out instead of rendering.
 */
export interface ReleaseNotes {
  name: string;
  body: string;
  url: string;
  publishedAt: string | null;
}

const TIMEOUT_MS = 5000;

export async function fetchReleaseNotes(deps: {
  slug: string; // "owner/repo"
  version: string; // plain semver; the tag is v<version> (release-please, no component prefix)
  fetchImpl?: typeof fetch;
}): Promise<ReleaseNotes | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    if (typeof timer === 'object') timer.unref?.();
    let res: Response;
    try {
      res = await doFetch(`https://api.github.com/repos/${deps.slug}/releases/tags/v${deps.version}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/vnd.github+json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const r = (await res.json()) as { name?: string; body?: string; html_url?: string; published_at?: string };
    return {
      name: r.name ?? `v${deps.version}`,
      body: r.body ?? '',
      url: r.html_url ?? `https://github.com/${deps.slug}/releases/tag/v${deps.version}`,
      publishedAt: r.published_at ?? null,
    };
  } catch {
    return null;
  }
}
