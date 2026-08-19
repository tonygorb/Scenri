/**
 * What a failure MEANS, as opposed to what it says.
 *
 * Engines throw for engineers: `OpenRouter request failed: HTTP 401 —
 * {"error":{"message":"Missing Authentication header","code":401}}` is a
 * perfectly good log line and a terrible thing to show someone who was trying
 * to photograph a lamp. It names a protocol, quotes a JSON envelope, and never
 * once says the only thing that matters — the key is missing, and here is where
 * you put one.
 *
 * So the raw text stays exactly as thrown (it is the record, and a bug report
 * needs it verbatim), and this reads it once on the way to the screen: what
 * happened, what to do, and which single control does it.
 *
 * Everything here is client-side. Nothing rewrites what the server stored.
 */

export type FailureKind =
  | 'auth'
  | 'credit'
  | 'budget'
  | 'rate'
  | 'policy'
  | 'model'
  | 'format'
  | 'references'
  | 'setup'
  | 'timeout'
  | 'network'
  | 'server'
  | 'empty'
  | 'restarted'
  | 'cancelled'
  | 'unknown';

/** Where the one control that resolves this failure lives. */
export type FailureRemedy = { label: string; opens: 'engines' | 'budget' | 'setup' };

export interface Failure {
  kind: FailureKind;
  /** One sentence, sentence case. Never a colon, never a stack frame. */
  title: string;
  /** What to do about it. Absent when there is nothing honest to say. */
  fix?: string;
  /** The engine's own words, verbatim, for the details disclosure. */
  raw: string;
  /** The single control that resolves it, when one exists. */
  remedy?: FailureRemedy;
  /**
   * Whether running the same brief again could plausibly work. Offering Try
   * again on a missing API key is the interface lying: the second run fails
   * for exactly the reason the first one did.
   */
  retryable: boolean;
}

/**
 * Stands in for the engine's name when we don't have one. Lower case because
 * it always appears mid-sentence after a capital, never at the front.
 */
const SOME_ENGINE = 'the engine';

/**
 * The table. Ordered — first match wins — so the specific patterns come before
 * the general ones they would otherwise be swallowed by. Every `re` here is
 * matched against a string this repo actually throws; none are speculative.
 */
interface Rule {
  re: RegExp;
  kind: FailureKind;
  title: (engine: string) => string;
  fix?: string;
  remedy?: FailureRemedy;
  retryable: boolean;
}

const RULES: Rule[] = [
  // ---- the key ----
  {
    re: /HTTP 401\b|missing authentication|no auth credentials|invalid api key|unauthorized/i,
    kind: 'auth',
    title: (e) => `${cap(e)} did not accept your API key.`,
    fix: 'Add or replace the key, then run this again.',
    remedy: { label: 'Add key', opens: 'engines' },
    retryable: false,
  },
  {
    re: /HTTP 403\b|forbidden/i,
    kind: 'auth',
    title: (e) => `${cap(e)} refused this key.`,
    fix: 'It may not cover the model this shot asked for.',
    remedy: { label: 'Check key', opens: 'engines' },
    retryable: false,
  },

  // ---- money ----
  // scenri's own guard, before the provider's: this one is a setting you own.
  {
    re: /spend cap for .*would exceed it|spend cap for/i,
    kind: 'budget',
    title: (e) => `This would go past your monthly cap for ${e}.`,
    fix: 'Raise the cap, or wait for the month to roll over.',
    remedy: { label: 'Open budget', opens: 'budget' },
    retryable: false,
  },
  {
    re: /HTTP 402\b|insufficient (credit|funds|balance)|out of credit|billing|payment required/i,
    kind: 'credit',
    title: (e) => `${cap(e)} is out of credit.`,
    fix: 'Top up with the provider, then run this again.',
    remedy: { label: 'Open engines', opens: 'engines' },
    retryable: false,
  },

  // ---- pace ----
  {
    re: /HTTP 429\b|rate.?limit|too many requests/i,
    kind: 'rate',
    title: (e) => `${cap(e)} is rate limiting this key.`,
    fix: 'Give it a minute, then try again.',
    retryable: true,
  },

  // ---- the brief itself ----
  {
    re: /moderation|content policy|safety system|flagged|violat(es|ion)|blocked by/i,
    kind: 'policy',
    title: (e) => `${cap(e)} declined this brief.`,
    fix: 'Reword what you asked for and run it again.',
    retryable: false,
  },

  // ---- capability: before the generic 404, which `no endpoints` would hit ----
  {
    re: /cannot carry enough reference images/i,
    kind: 'references',
    // The server already wrote this one for a human, naming the exact
    // ingredients that would have gone unseen. Repeating it in our own worse
    // words would lose the names, which are the useful half.
    title: () => '',
    remedy: { label: 'Choose engine', opens: 'engines' },
    retryable: false,
  },
  {
    re: /cannot produce the requested aspect ratio|engine returned \d+x\d+ for a \d+x\d+ request/i,
    kind: 'format',
    title: (e) => `${cap(e)} cannot make this shape.`,
    fix: 'Pick another format, or an engine that can.',
    remedy: { label: 'Choose engine', opens: 'engines' },
    retryable: false,
  },
  {
    re: /HTTP 404\b|model not found|no endpoints found|no allowed providers/i,
    kind: 'model',
    title: (e) => `${cap(e)} has no model for this shot.`,
    fix: 'Pick another engine in Settings.',
    remedy: { label: 'Choose engine', opens: 'engines' },
    retryable: false,
  },

  // ---- the machine ----
  {
    re: /failed to spawn codex|codex.*enoent|command not found/i,
    kind: 'setup',
    title: () => 'Codex is not installed on this machine.',
    fix: 'Run setup once and this works from then on.',
    remedy: { label: 'Set up Codex', opens: 'setup' },
    retryable: false,
  },
  {
    re: /\brun aborted\b/i,
    kind: 'cancelled',
    title: () => 'You stopped this shot.',
    fix: 'The brief is kept. Run it again whenever.',
    retryable: true,
  },
  {
    re: /timed out|\btimeout\b|ETIMEDOUT/i,
    kind: 'timeout',
    title: (e) => `${cap(e)} took too long to answer.`,
    fix: 'Try again. A long brief sometimes needs a second run.',
    retryable: true,
  },
  {
    re: /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network error/i,
    kind: 'network',
    title: (e) => `Could not reach ${e}.`,
    fix: 'Check your connection, then try again.',
    retryable: true,
  },
  {
    re: /interrupted\W+server restarted/i,
    kind: 'restarted',
    title: () => 'scenri restarted while this was rendering.',
    fix: 'The shot was lost, not the brief. Run it again.',
    retryable: true,
  },
  {
    re: /HTTP 5\d\d\b|internal server error|bad gateway|service unavailable|overloaded|upstream/i,
    kind: 'server',
    title: (e) => `${cap(e)} had a problem on its end.`,
    fix: 'Nothing wrong with your brief. Try again shortly.',
    retryable: true,
  },

  // ---- came back empty-handed ----
  {
    re: /produced no images|returned no image|no images returned|finished but produced no/i,
    kind: 'empty',
    title: (e) => `${cap(e)} finished without making a picture.`,
    fix: 'Run it again. This usually clears on a second try.',
    retryable: true,
  },
];

/** Sentence-start form of an engine name we may have substituted a lower-case default for. */
function cap(s: string): string {
  return s === SOME_ENGINE ? 'The engine' : s;
}

/**
 * Read a raw engine error into something worth putting on a screen.
 *
 * `engine` is a display name (`EngineInfo.displayName`), not an id: "OpenRouter
 * did not accept your API key" is a sentence, "openrouter did not accept your
 * API key" is a log line with a capital letter missing.
 */
export function describeFailure(raw: string | null | undefined, engine?: string | null): Failure {
  const text = (raw ?? '').trim();
  // BYOK engines carry the suffix in their display name. It is a billing fact,
  // not part of what the thing is called, and it reads as noise mid-sentence.
  const name = (engine ?? '').replace(/\s*\(BYOK\)\s*$/i, '').trim() || SOME_ENGINE;

  if (!text) {
    return { kind: 'unknown', title: 'This shot did not finish.', raw: '', retryable: true };
  }

  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    // The references rule has no words of its own: the server's sentence IS
    // the title, because it names the ingredients that would have gone unshown.
    const title = rule.title(name) || sentence(text);
    return {
      kind: rule.kind,
      title,
      fix: rule.fix,
      raw: text,
      remedy: rule.remedy,
      retryable: rule.retryable,
    };
  }

  return { kind: 'unknown', title: 'This shot did not finish.', raw: text, retryable: true };
}

/**
 * A cancel is not a failure — you did it on purpose — but it lands in the same
 * places and needs the same shape, so it is described here rather than being a
 * second grammar the tile and the stage both have to know about.
 */
export function describeCancelled(): Failure {
  return {
    kind: 'cancelled',
    title: 'You stopped this shot.',
    fix: 'The brief is kept. Run it again whenever.',
    raw: '',
    retryable: true,
  };
}

/**
 * The same reading, for the ~15 toast sites that were pushing
 * `String(e.message ?? e)` as their detail — which is how a dropped request
 * ends up narrating an HTTP status to someone who clicked Archive.
 *
 * `what` is the caller's own headline ("Could not archive this shot"): it says
 * which action failed, which the engine text never does. It stays the title and
 * the humanised reading becomes the detail, so the two say different things.
 */
export function failureToast(
  e: unknown,
  what: string,
  engine?: string | null,
): { kind: 'error'; title: string; detail?: string } {
  const raw =
    e instanceof Error ? e.message : typeof e === 'string' ? e : String((e as { message?: unknown })?.message ?? e);
  const f = describeFailure(raw, engine);
  // An unrecognised error has nothing better to offer than its own words, and
  // "This shot did not finish" under "Could not archive this shot" is two
  // sentences that between them say nothing.
  const detail = f.kind === 'unknown' ? f.raw || undefined : [f.title, f.fix].filter(Boolean).join(' ');
  return { kind: 'error', title: what, detail };
}

/** First letter up, one trailing full stop. For text we are quoting rather than writing. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const head = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(head) ? head : `${head}.`;
}
