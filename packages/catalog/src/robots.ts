/**
 * robots.txt, honoured.
 *
 * This is the difference between a bounded reader and a crawler, and the
 * setup screen already promises a person that Scenri "only reads public
 * pages". A store that asks us not to read something is not an obstacle to
 * work around.
 *
 * Only the parts that change what we fetch are implemented: user-agent
 * groups, Allow, Disallow, Crawl-delay. Longest matching rule wins, Allow
 * beats Disallow at equal length, and anything unparseable or missing fails
 * open - a site with no robots.txt has not refused anything.
 *
 * Worth knowing, from gymshark.com: it disallows `/collections/*​/products*`
 * and `/search`, and allows `/products/*`. The product pages we want are
 * exactly the ones it offers.
 */
import { httpText, USER_AGENT } from './http/fetch.js';
import { originOf } from './url.js';
import type { AdapterContext } from './types.js';

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface Robots {
  rules: Rule[];
  crawlDelayMs: number;
}

export const ALLOW_ALL: Robots = { rules: [], crawlDelayMs: 0 };

/**
 * A robots pattern is a path prefix with two wildcards: `*` for any run of
 * characters and `$` for end-of-path. Everything else is literal.
 */
function toRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped;
  return new RegExp(`^${anchored}`);
}

export function parseRobots(text: string, agent = USER_AGENT): Robots {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  // Group headers accumulate: consecutive User-agent lines share one body.
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  let expectingAgents = false;

  for (const line of lines) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [], delay: 0 };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    expectingAgents = false;
    if (field === 'disallow' && value) current.rules.push({ allow: false, pattern: value });
    else if (field === 'allow' && value) current.rules.push({ allow: true, pattern: value });
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) current.delay = n;
    }
  }

  const token = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelayMs: Math.max(0, ...chosen.map((g) => g.delay)) * 1000,
  };
}

/** Whether robots.txt permits reading this URL. Unknown paths are allowed. */
export function isAllowed(robots: Robots, url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return true;
  }
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!toRegExp(rule.pattern).test(path)) continue;
    const length = rule.pattern.replace(/[*$]/g, '').length;
    // Longest match wins; Allow breaks a tie, which is what every major
    // crawler does and what a site author writing an exception expects.
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}

/** Read a site's robots.txt. A site without one has refused nothing. */
export async function fetchRobots(ctx: AdapterContext): Promise<Robots> {
  try {
    const { ok, text } = await httpText(`${originOf(ctx.baseUrl)}/robots.txt`, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 0,
      accept: 'text/plain',
      maxBytes: 512_000,
    });
    if (!ok || !text) return ALLOW_ALL;
    return parseRobots(text);
  } catch {
    return ALLOW_ALL;
  }
}
