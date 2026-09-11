import { type Aside, type Question, type Turn, asideTurns } from '../../conversation/question.js';
import { PROMPT, readingWhat } from './presenterCopy.js';
import {
  EXTRA_VIEWS,
  HAND_APPROVED,
  type DraftDecision,
  type DraftLike,
  type DraftResult,
  type StudioView,
  VIEW_LABEL,
  VIEW_NAME,
  allApproved,
  coverageLine,
  identityLocked,
  viewsOf,
} from './presenterStudioRules.js';

/**
 * The conversation once a draft exists, read off the draft.
 *
 * Everything here is a rendering of what the server holds: the pictures it
 * drew, the sentences sent to redraw them, the decisions taken, in the order
 * they happened. These are the genuine conversation events, the ones no
 * table can reconstruct, and the server's log is their one home. Nothing is
 * stored on the client for them.
 */
export interface RecordUi {
  /** "Save as is" was chosen once; the extras question is not asked again. */
  extrasDeclined: boolean;
  /** A draw request that never reached the engine, said once with a Retry. */
  failed?: string | null;
  /** The name is being rewritten in place. */
  editingName: boolean;
}

export interface RecordArgs {
  draft: DraftLike;
  canGenerate: boolean;
  ui: RecordUi;
  /** The setup exchanges that belong after the photographs were read: the details answered about them. */
  afterCoverage: Turn[];
  asides: Aside[];
  openId: string | null;
  placed: Set<Aside>;
}

/** A draw that was stopped is said quietly and offered again; one that failed says why, with a Retry. */
export function stoppedOrFailed(view: StudioView, error: string): Question {
  const name = view === 'portrait' ? 'face' : VIEW_NAME[view];
  return error === 'cancelled'
    ? {
        id: 'retry',
        kind: 'confirm',
        quiet: true,
        prompt: `Stopped drawing the ${name}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Draw it again' }],
      }
    : {
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: `The ${name} could not be drawn: ${error}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Retry' }],
      };
}

/** Where the analyzer filed them, said once at the save; the presenter page is where it changes. */
export function filedLine(d: DraftLike): string {
  const cats = (d.analysis?.suitableCategories ?? []).filter(Boolean);
  if (!cats.length) return '';
  const list = cats.length === 1 ? cats[0] : `${cats.slice(0, -1).join(', ')} and ${cats[cats.length - 1]}`;
  return ` Filed under ${list}; that can change on their page.`;
}

/** The moment the record last moved: what was said before it belongs to the record, not to the open question. */
export function recordEdge(d: DraftLike | null): string {
  if (!d) return '';
  const ats = [...(d.asks ?? []), ...(d.results ?? []), ...(d.decisions ?? [])].map((x) => x.at);
  return ats.length ? ats.reduce((m, at) => (at > m ? at : m)) : '';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function recordTurns({ draft: d, canGenerate, ui, afterCoverage, asides, openId, placed }: RecordArgs): Turn[] {
  const T: Turn[] = [];
  const say = (id: string, text: string, tone?: 'alert' | 'warn') => T.push({ kind: 'scenri', id, text, tone });
  const ask = (question: Question) => T.push({ kind: 'question', question });
  const name = d.name?.trim() ?? '';
  const who = name || 'them';
  const named = () => {
    if (!name) return;
    T.push({ kind: 'scenri', id: 'asked-name', text: PROMPT.name, quiet: true });
    T.push({ kind: 'you', id: 'name', text: name, editable: true, editing: ui.editingName || undefined });
  };
  const askName = (prompt: string) => ask({ id: 'name', kind: 'text', prompt });

  if (d.stage === 'analyzing') {
    say('reading', `Reading ${readingWhat(d.source)}.`);
    if (name) named();
    else askName(PROMPT.nameWhileReading);
    return T;
  }

  const coverage = coverageLine(d, canGenerate);
  if (coverage) say('coverage', coverage.text, coverage.tone);
  // the details the photographs were asked about, in their place after the read
  T.push(...afterCoverage);

  if (!canGenerate && d.source === 'photos') {
    if (name) named();
    if (!name) {
      askName(PROMPT.name);
      return T;
    }
    ask({
      id: 'blind',
      kind: 'confirm',
      prompt: 'No engine here can draw the other views. Save them from the photos as they are?',
      options: [
        { id: 'save', label: 'Save with photos' },
        { id: 'setup', label: 'Set up' },
      ],
    });
    return T;
  }

  const p = d.views.portrait;
  const active = d.activeView as StudioView | null;

  // Every sentence sent to redraw a view is an exchange of its own, in the
  // order it was sent, and stays whatever is sent after it. The last one is
  // still open while its view draws, waits on a decision or failed; the lines
  // below close it. The rest closed when their view landed.
  const asks = d.asks ?? [];
  const last = asks[asks.length - 1];
  const lastSlot = last ? d.views[last.view] : null;
  const lastOpen =
    !!last &&
    !!lastSlot &&
    ((lastSlot.status === 'generating' && d.activeView === last.view) ||
      (lastSlot.status === 'candidate' && lastSlot.adjustment === last.text) ||
      !!lastSlot.error);
  const askedFor = (v: StudioView) => (v === 'portrait' && !identityLocked(d) ? PROMPT.identity(who) : PROMPT.change);
  // Only a picture that was drawn is a line. Putting one back moves the mark
  // from one card to another; it says nothing new, so the log does not grow.
  const results = (d.results ?? []).filter((r) => r.how !== 'restored');
  const decisions = d.decisions ?? [];
  const idle = !d.activeView && d.stage === 'idle';
  // every picture drawn for a view is numbered in the order it first landed;
  // a restored one keeps its number, and the one on the view right now is
  // marked as such on its latest line
  const numbers = new Map<string, number>();
  const perView = new Map<string, number>();
  const latest = new Map<string, DraftResult>();
  for (const r of results) {
    const key = `${r.view}:${r.hash}`;
    latest.set(key, r);
    if (numbers.has(key)) continue;
    const n = (perView.get(r.view) ?? 0) + 1;
    perView.set(r.view, n);
    numbers.set(key, n);
  }
  const numberOf = (r: DraftResult) => numbers.get(`${r.view}:${r.hash}`) ?? 1;
  const shot = (r: DraftResult, id: string): Turn => {
    const n = numberOf(r);
    const onView = d.views[r.view].hash === r.hash;
    // the mark is only worth saying where a view has more than one picture
    const several = (perView.get(r.view) ?? 0) > 1;
    return {
      kind: 'scenri',
      id,
      text: `Here is ${VIEW_NAME[r.view]} ${n}.`,
      thumb: r.hash,
      label: `${VIEW_LABEL[r.view]} ${n}`,
      current: several && onView && latest.get(`${r.view}:${r.hash}`) === r,
      restore: idle && !onView ? { view: r.view, hash: r.hash } : undefined,
    };
  };
  // a drawn picture answers the ask before it on its view, once
  const taken = new Set<DraftResult>();
  const outcomes = new Map(
    asks.map((a) => {
      const r = results.find(
        (x) => !taken.has(x) && x.how === 'drawn' && x.view === a.view && x.ask === a.text && x.at >= a.at,
      );
      if (r) taken.add(r);
      return [a, r] as const;
    }),
  );
  // The first time each view was accepted. Its question was a landing, not a
  // revision, and the record has to replay the words that were actually shown.
  const firstUse = new Map<StudioView, DraftDecision>();
  for (const x of decisions) if (x.what === 'use' && !firstUse.has(x.view)) firstUse.set(x.view, x);
  const revisionPrompt = (v: StudioView) =>
    v === 'portrait'
      ? `Here is ${who} with the change. Use this, or keep the previous one. Using it redraws the views built on the face.`
      : `Redrew the ${VIEW_NAME[v]}. Use it, or keep the previous one.`;
  const decided = (x: DraftDecision): Turn[] => {
    const landing = x === firstUse.get(x.view);
    const identity = x.view === 'portrait' && landing;
    const label =
      x.what === 'again'
        ? 'Try again'
        : x.what === 'keep'
          ? 'Keep previous'
          : identity
            ? 'Use this person'
            : x.view === 'portrait'
              ? 'Use this'
              : 'Use it';
    return [
      {
        kind: 'scenri',
        id: `asked-decided-${x.at}`,
        text: identity ? PROMPT.identity(who) : landing ? PROMPT.landed(VIEW_NAME[x.view]) : revisionPrompt(x.view),
        quiet: true,
      },
      { kind: 'you', id: `decided-${x.at}`, text: label, editable: false },
    ];
  };
  const pastAsks = () => {
    const closed = lastOpen ? asks.slice(0, -1) : asks;
    // what was said at the open question stays with it only while nothing has been recorded since;
    // once the record moved on, it is part of the record and does not follow the question around
    const edge = recordEdge(d);
    const chatter = asides.filter((a) => !placed.has(a) && (a.q !== openId || a.at <= edge));
    for (const a of chatter) placed.add(a);
    const firstExtra = results.find((r) => (EXTRA_VIEWS as readonly string[]).includes(r.view));
    const record: { at: string; turns: Turn[] }[] = [
      ...closed.map((a) => {
        const r = outcomes.get(a);
        return {
          at: a.at,
          turns: [
            { kind: 'scenri' as const, id: `asked-ask-${a.at}`, text: askedFor(a.view), quiet: true },
            { kind: 'you' as const, id: `ask-${a.at}`, text: a.text, editable: false },
            ...(r ? [shot(r, `redrew-${a.at}`)] : []),
          ],
        };
      }),
      ...results
        .filter((r) => !taken.has(r))
        .map((r) => ({
          at: r.at,
          turns: [shot(r, `result-${r.at}`)],
        })),
      ...decisions.map((x) => ({ at: x.at, turns: decided(x) })),
      ...chatter.map((a) => ({ at: a.at, turns: asideTurns(a) })),
      // the extras decision sits between the core set and what it added
      ...(identityLocked(d) && (d.extras || ui.extrasDeclined)
        ? [
            {
              at: firstExtra ? firstExtra.at.slice(0, -1) : '~',
              turns: [
                { kind: 'scenri' as const, id: 'asked-extras', text: PROMPT.extras, quiet: true },
                { kind: 'you' as const, id: 'extras', text: d.extras ? 'Add them' : 'Save as is', editable: false },
              ],
            },
          ]
        : []),
    ];
    record.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    for (const r of record) T.push(...r.turns);
  };
  const openAsk = () => {
    if (lastOpen && last) {
      T.push({ kind: 'scenri', id: `asked-ask-${last.at}`, text: askedFor(last.view), quiet: true });
      T.push({ kind: 'you', id: `ask-${last.at}`, text: last.text, editable: false });
    }
  };

  if (!identityLocked(d)) {
    const drawingFace = p.status === 'generating' || (active === 'portrait' && p.status !== 'candidate');
    if (drawingFace && !asks.length) {
      // The first draw: the name is asked under the line that says it is
      // drawing, and the answer stays there.
      say('drawing-face', 'Drawing their face.');
      if (name) named();
      else askName(PROMPT.nameWhileDrawing);
      return T;
    }
    named();
    pastAsks();
    if (drawingFace) {
      openAsk();
      say('drawing-face', lastOpen ? 'Adjusting the face. Everything else stays.' : 'Drawing their face.');
      if (!name) askName(PROMPT.nameWhileDrawing);
      return T;
    }
    if (ui.failed) {
      ask({
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: `That did not go through: ${ui.failed}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Retry' }],
      });
      return T;
    }
    if (p.error) {
      openAsk();
      ask(stoppedOrFailed('portrait', p.error));
      return T;
    }
    if (p.status === 'candidate') {
      openAsk();
      ask({
        id: 'identity',
        kind: 'confirm',
        prompt: lastOpen ? 'Adjusted. Use this person, or try again.' : PROMPT.identity(who),
        options: [
          { id: 'use', label: 'Use this person' },
          { id: 'again', label: 'Try again' },
          { id: 'change', label: 'Change something' },
        ],
      });
      return T;
    }
    return T;
  }

  named();
  pastAsks();

  const views = Object.keys(d.views) as StudioView[];
  // The last view a person decides, and the first the draft decides for them:
  // the seam between establishing who this is and building the coverage.
  const inPlay = viewsOf(d);
  const lastGate = [...inPlay].reverse().find((v) => HAND_APPROVED.has(v));
  const firstFree = inPlay.find((v) => !HAND_APPROVED.has(v));
  const candidate = views.find((v) => d.views[v].status === 'candidate');
  const failed = views.find((v) => !!d.views[v].error);

  if (ui.failed && !active) {
    ask({
      id: 'retry',
      kind: 'confirm',
      tone: 'alert',
      prompt: `That did not go through: ${ui.failed}. Nothing finished was touched.`,
      options: [{ id: 'retry', label: 'Retry' }],
    });
    return T;
  }

  if (active) {
    openAsk();
    say(
      `drawing-${active}`,
      lastOpen && last?.view === active
        ? `Redrawing the ${VIEW_NAME[active]}.`
        : active === lastGate && !d.views[active].hash
          ? `Drawing the ${VIEW_NAME[active]} from this face.`
          : active === firstFree && !d.views[active].hash && lastGate
            ? `Building the rest of the set from the ${VIEW_NAME[lastGate]}.`
            : `Drawing the ${VIEW_NAME[active]}.`,
    );
    // a person whose face came from a photograph has had no draw to be named during
    if (!name) askName(PROMPT.nameWhileDrawing);
    return T;
  }

  if (candidate) {
    openAsk();
    // A gated view standing for the first time has no earlier picture behind
    // it, so offering to keep the previous one would be offering nothing.
    const revising = !!d.views[candidate].prior;
    ask({
      id: candidate === 'portrait' ? 'revision' : 'view-revision',
      kind: 'confirm',
      prompt: !revising
        ? PROMPT.landed(VIEW_NAME[candidate])
        : candidate === 'portrait'
          ? `Here is ${who} with the change. Use this, or keep the previous one. Using it redraws the views built on the face.`
          : `Redrew the ${VIEW_NAME[candidate]}. Use it, or keep the previous one.`,
      options: [
        { id: 'use', label: candidate === 'portrait' ? 'Use this' : 'Use it' },
        ...(revising ? [{ id: 'keep', label: 'Keep previous' }] : []),
        { id: 'again', label: 'Try again' },
      ],
    });
    return T;
  }

  if (failed) {
    openAsk();
    ask(stoppedOrFailed(failed, d.views[failed].error ?? ''));
    return T;
  }

  if (!allApproved(d)) {
    // between two draws of the set there is still no name and still nothing else to ask
    if (!name) askName(PROMPT.nameWhileDrawing);
    return T;
  }

  if (!d.extras && !ui.extrasDeclined) {
    say('set-ready', 'The set is ready. Select a view and say what is wrong to redraw it.');
    ask({
      id: 'extras',
      kind: 'confirm',
      prompt: PROMPT.extras,
      options: [
        { id: 'add', label: 'Add them' },
        { id: 'save', label: 'Save as is' },
      ],
    });
    return T;
  }

  if (!name) {
    askName(PROMPT.name);
    return T;
  }

  ask({
    id: 'save',
    kind: 'confirm',
    prompt: `${cap(who)} is ready.${filedLine(d)}`,
    options: [{ id: 'save', label: 'Save presenter' }],
  });
  return T;
}
