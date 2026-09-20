import {
  type Aside,
  answersNothing,
  asideTurns,
  type NothingKind,
  type Question,
  type Turn,
} from '../../conversation/question.js';
import type { SceneReading } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';
import { optionOf, ROWS, swatchRow } from './sceneRows.js';
import {
  answeredIn,
  type Answers,
  deserializeSetup,
  isRow,
  nextQuestion,
  PASSED,
  type Qid,
  type SetupState,
  serializeSetup,
} from './sceneSetup.js';
import { current, deserialize, pictureNumber, readingLines, serialize, type StudioState } from './sceneStudioRules.js';

/**
 * The scene studio's conversation, read off its state: the transcript and the
 * composer, both pure, both computed on every render and stored nowhere.
 *
 * The setup half is the presenter's shape (a line, its answer, a pencil that
 * reopens it in place). The record half is the scene's own: every version the
 * place has had, each as the words and the picture drawn from them, and one
 * question at the end, the read-back before a draw or the decision after one.
 */

export interface FlowArgs {
  setup: SetupState;
  studio: StudioState;
  canDraw: boolean;
  uploading: number;
  /** A saved scene opened to change it: no setup, the record from the start. */
  edit: { name: string } | null;
  /** The name is being rewritten in its own bubble. */
  editingName: boolean;
  /** One line Scenri says about the pictures or the connection, before the open question. */
  note?: string | null;
  /** The place was given again since it was last read, and is waiting to be read. */
  stale?: boolean;
  /**
   * Pictures this person already has, newest first: the shots they made here.
   *
   * Offered at the picture question so the fastest reference is the one
   * already in the library. What is read out of one is the world in it; the
   * product and the person in it are the analyzer's visitors, never copied.
   */
  have?: string[];
}

/** What the words of a reading say, as one quotable block. */
export function readingQuote(r: SceneReading): string {
  return readingLines(r)
    .map((l) => (l.label === COPY.placeLabel ? l.text : `${l.label}: ${l.text.replace(/[.\s]+$/, '')}.`))
    .join(' ');
}

/* ------------------------------------------------------------- questions */

export function questionFor(
  id: Qid,
  setup: SetupState,
  reopened: boolean,
  uploading: number,
  have: string[] = [],
): Question {
  const a = setup.answers;
  const base = reopened ? { reopened: true } : {};
  if (id === 'source')
    return {
      id,
      kind: 'choice',
      prompt: COPY.source,
      options: [
        { id: 'photos', label: COPY.addPictures },
        { id: 'guided', label: COPY.guideMe },
      ],
      given: a.source?.door === 'words' ? undefined : a.source?.door,
      note: a.source?.door === 'words' ? a.source.text : undefined,
      ...base,
    };
  if (id === 'photos')
    return {
      id,
      kind: 'photos',
      prompt: COPY.photos,
      hashes: a.photos?.hashes ?? [],
      max: 4,
      busy: uploading > 0,
      submit: COPY.readThem,
      back: COPY.guideInstead,
      drop: COPY.photosDrop,
      ...base,
      ...(have.length
        ? {
            suggest: {
              label: COPY.haveLabel,
              hint: COPY.haveHint,
              items: have.map((hash, i) => ({ hash, alt: COPY.haveAlt(i + 1) })),
            },
          }
        : {}),
    };
  const g = a[id];
  return {
    id,
    kind: 'swatches',
    prompt: ROWS[id].prompt,
    row: swatchRow(id),
    skip: COPY.skip,
    given: g?.pick === PASSED ? undefined : g?.pick,
    skipped: g?.pick === PASSED,
    note: g?.words,
    ...base,
  };
}

const askedLine = (id: Qid): string =>
  id === 'source' ? COPY.source : id === 'photos' ? COPY.photos : ROWS[id].prompt;

function answerLine(id: Qid, a: Answers): { text: string; photos?: string[] } {
  if (id === 'source') {
    if (a.source?.door === 'words') return { text: a.source.text ?? '' };
    return { text: a.source?.door === 'photos' ? COPY.addPictures : COPY.guideMe };
  }
  if (id === 'photos') {
    const n = a.photos?.hashes.length ?? 0;
    return { text: `${n} ${n === 1 ? 'picture' : 'pictures'}`, photos: a.photos?.hashes };
  }
  const g = a[id];
  const picked = g?.pick === PASSED ? COPY.skip : optionOf(id, g?.pick)?.label;
  const words = g?.words?.trim();
  return { text: picked && words ? `${picked}, ${words}` : (words ?? picked ?? '') };
}

/* ------------------------------------------------------------ transcript */

const byAt = (x: Aside, y: Aside) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);

/** The id of the question the record ends on, for the version standing. */
export const recordQid = (studio: StudioState): string | null => {
  const v = current(studio);
  if (!v) return null;
  return `${v.hash ? 'decide' : 'agree'}-${studio.current}`;
};

export function turnsFor(args: FlowArgs): Turn[] {
  const { setup, studio, edit } = args;
  const a = setup.answers;
  const T: Turn[] = [];
  const placed = new Set<Aside>();
  const attach = (q: string) => {
    for (const x of setup.asides.filter((y) => y.q === q && !placed.has(y)).sort(byAt)) {
      placed.add(x);
      T.push(...asideTurns(x));
    }
  };

  // the setup: each answered question as its line and its answer, a pencil on the answer
  if (edit) T.push({ kind: 'scenri', id: 'edit-open', text: COPY.editOpen(edit.name) });
  else T.push({ kind: 'you', id: 'intent', text: COPY.intent });
  const openSetup = edit ? null : nextQuestion(a);
  if (!edit)
    for (const id of answeredIn(a)) {
      T.push({ kind: 'scenri', id: `asked-${id}`, text: askedLine(id), quiet: true });
      attach(id);
      if (setup.editing === id) {
        T.push({ kind: 'question', question: questionFor(id, setup, true, args.uploading, args.have ?? []) });
        continue;
      }
      const line = answerLine(id, a);
      T.push({ kind: 'you', id, text: line.text, photos: line.photos, editable: !studio.job });
    }

  // the record: every version, as what was asked for and what came of it
  const firstPicture = studio.versions.findIndex((v) => !!v.hash);
  studio.versions.forEach((v, i) => {
    if (v.how === 'read' && i > 0) T.push({ kind: 'scenri', id: `reread-${i}`, text: COPY.readAgain });
    if (v.how === 'change') T.push({ kind: 'you', id: `ask-${i}`, text: v.ask ?? '' });
    if (v.hash) {
      if (v.how === 'draw') T.push({ kind: 'you', id: `draw-${i}`, text: COPY.draw });
      if (v.how === 'again') T.push({ kind: 'you', id: `again-${i}`, text: COPY.tryAgain });
      // a saved scene opened to edit was named when it was made, not while this drew
      if (i === firstPicture && !edit) nameExchange(T, args);
      T.push({
        kind: 'scenri',
        id: `pic-${i}`,
        text: v.how === 'change' ? COPY.changed : v.how === 'again' ? COPY.again : COPY.here,
        thumb: v.hash,
        label: COPY.version(pictureNumber(studio, i)),
        view: 'scene',
        current: i === studio.current,
        restore: i === studio.current ? undefined : { view: 'scene', hash: v.hash },
      });
    }
    if (i === studio.current)
      for (const [k, c] of v.coverage.entries()) T.push({ kind: 'scenri', id: `cover-${i}-${k}`, text: c });
    attach(`agree-${i}`);
    attach(`decide-${i}`);
  });

  // the work in flight: what was pressed, said at once, before anything lands
  const job = studio.job;
  if (job?.kind === 'again')
    T.push({ kind: 'you', id: `pending-${job.id}`, text: firstPicture < 0 ? COPY.draw : COPY.tryAgain });
  if (job?.kind === 'change') T.push({ kind: 'you', id: `pending-${job.id}`, text: job.ask ?? '' });
  if (job?.kind === 'again' && firstPicture < 0 && !edit) nameExchange(T, args);

  // the one question the conversation ends on
  let open: Question | null = null;
  if (openSetup) open = questionFor(openSetup, setup, false, args.uploading, args.have ?? []);
  else if (job) {
    if (job.kind === 'again' && firstPicture < 0 && !studio.named && !args.editingName) {
      const suggested = (job.pending ?? current(studio)?.reading)?.name ?? studio.name;
      open = {
        id: 'name',
        kind: 'text',
        prompt: COPY.name,
        starters: suggested ? [{ label: suggested, text: suggested }] : undefined,
      };
    }
  } else {
    const v = current(studio);
    // given again and not read yet: the read is on its way, or it failed and asks
    if (args.stale && !edit) {
      if (studio.error)
        open = {
          id: 'retry',
          kind: 'confirm',
          tone: 'alert',
          prompt: COPY.failedFirst(studio.error.replace(/[.\s]+$/, '')),
          options: [{ id: 'retry', label: COPY.retry }],
        };
    } else if (!v && studio.error)
      open = {
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: COPY.failedFirst(studio.error.replace(/[.\s]+$/, '')),
        options: [{ id: 'retry', label: COPY.retry }],
      };
    else if (v) {
      if (studio.error)
        T.push({ kind: 'scenri', id: `error-${studio.versions.length}`, text: studio.error, tone: 'alert' });
      const quote = readingQuote(v.reading);
      if (!v.hash) {
        const photos = !edit && a.source?.door === 'photos';
        open = {
          id: `agree-${studio.current}`,
          kind: 'confirm',
          prompt: !args.canDraw
            ? COPY.agreeBlind
            : v.how === 'change'
              ? COPY.agreeChanged
              : photos
                ? COPY.agreePhotos
                : COPY.agree,
          quote,
          quoteLabel: COPY.readingHead,
          options: args.canDraw
            ? [{ id: 'draw', label: COPY.draw }]
            : [{ id: 'use', label: edit ? COPY.saveChanges : COPY.saveWords }],
        };
      } else {
        open = {
          id: `decide-${studio.current}`,
          kind: 'confirm',
          prompt: (edit ? COPY.decideEdit : COPY.decide)(studio.name.trim() || v.reading.name),
          quote,
          quoteLabel: COPY.readingHead,
          options: [
            { id: 'use', label: edit ? COPY.saveChanges : COPY.use },
            ...(args.canDraw ? [{ id: 'again', label: COPY.tryAgain }] : []),
          ],
          describe: COPY.changeSomething,
        };
      }
    }
  }

  // what was said at the open question, or at nothing, stands just before it
  for (const x of setup.asides.filter((y) => !placed.has(y)).sort(byAt)) T.push(...asideTurns(x));
  if (args.note) T.push({ kind: 'scenri', id: `note-${args.note.length}-${args.note.slice(0, 12)}`, text: args.note });
  if (open) T.push({ kind: 'question', question: open });
  return T;
}

/** The name, once given: asked while the first picture draws, kept as its own exchange. */
function nameExchange(T: Turn[], args: FlowArgs) {
  if (!args.studio.named && !args.editingName) return;
  T.push({ kind: 'scenri', id: 'asked-name', text: COPY.name, quiet: true });
  T.push({ kind: 'you', id: 'name', text: args.studio.name, editable: true, editing: args.editingName || undefined });
}

/* -------------------------------------------------------------- composer */

/** Who a sentence typed now is for. */
export type Target =
  | { kind: 'source' }
  | { kind: 'row'; id: Qid }
  | { kind: 'name' }
  | { kind: 'add' }
  | { kind: 'change' }
  | { kind: 'off'; why: string };

export interface ComposerFor {
  target: Target;
  placeholder: string;
  label: string;
  action: string;
  working: boolean;
  /** The + beside the pill hands over pictures of the place. */
  attach: boolean;
}

export function composerFor(args: FlowArgs, open: Question | null): ComposerFor {
  const { setup, studio } = args;
  const off = (why: string, working = false): ComposerFor => ({
    target: { kind: 'off', why },
    placeholder: '',
    label: COPY.lineLabel,
    action: COPY.send,
    working,
    attach: false,
  });
  // an answer open again from its pencil takes the sentence
  const reopened = setup.editing;
  if (reopened === 'source') return say({ kind: 'source' }, COPY.sourcePlaceholder, true);
  if (reopened && isRow(reopened)) return say({ kind: 'row', id: reopened }, COPY.rowPlaceholder);
  if (reopened === 'photos') return off(COPY.photosOff);
  if (!open) return studio.job ? off('', true) : off('');
  if (open.id === 'source') return say({ kind: 'source' }, COPY.sourcePlaceholder, true);
  if (open.id === 'photos') return { ...off(COPY.photosOff), attach: true };
  if (isRow(open.id)) return say({ kind: 'row', id: open.id }, COPY.rowPlaceholder);
  if (open.id === 'name') return say({ kind: 'name' }, COPY.namePlaceholder);
  if (open.id.startsWith('agree-'))
    return args.canDraw
      ? say(
          { kind: 'add' },
          !args.edit && setup.answers.source?.door === 'photos' ? COPY.keepPlaceholder : COPY.addPlaceholder,
        )
      : off('');
  if (open.id.startsWith('decide-')) return { ...say({ kind: 'change' }, COPY.changePlaceholder), action: COPY.change };
  return off('');
}

function say(target: Target, placeholder: string, attach = false): ComposerFor {
  return { target, placeholder, label: placeholder, action: COPY.send, working: false, attach };
}

/* ------------------------------------------------------ what was said */

/** Words that are about a place: enough of them, or one of the nouns a place is made of. */
const PLACEY =
  /\b(studio|room|lobby|hall|beach|forest|desert|street|city|kitchen|bathroom|bedroom|office|garden|park|field|mountain|shore|sea|ocean|lake|river|cave|rooftop|roof|terrace|warehouse|loft|gallery|museum|church|hotel|restaurant|caf[eé]|bar|shop|store|market|set|stage|backdrop|wall|floor|marble|concrete|wood|stone|light|dusk|dawn|night|sun|neon|fog|rain|snow|sand|water|glass|metal|plaster|fabric|interior|outdoors?|indoors?|landscape|pool|library|station|tunnel|bridge|corridor|courtyard|balcony|window|sky|cyclorama|cyc|seamless|brutalist|minimal)\b/i;

export const describesPlace = (t: string): boolean =>
  PLACEY.test(t) || (t.trim().split(/\s+/).length >= 5 && !/\?\s*$/.test(t));

/** The reply a sentence that answered nothing earns, by what it was, at the first question or at a row. */
export function asideReply(kind: NothingKind, at: 'source' | 'row'): string {
  switch (kind) {
    case 'greeting':
    case 'ack':
      return at === 'source' ? COPY.greet : COPY.greetRow;
    case 'question':
    case 'help':
      return COPY.askHelp;
    case 'nav':
      return COPY.startOverIsUp;
    case 'go':
      return at === 'source' ? COPY.goFirst : COPY.greetRow;
    default:
      return COPY.notAPlace;
  }
}

/**
 * Whether a sentence typed at the first question, or at a row, answers it.
 *
 * At the first question it has to be about a place. At a row, a short answer
 * to a short question is an answer ("raw brick", "blue hour"), so only what is
 * recognisably not one is turned back: a greeting, a question, a push to go on.
 */
export function judge(text: string, at: 'source' | 'row'): NothingKind | null {
  if (at === 'source') return answersNothing(text, describesPlace);
  const k = answersNothing(text, () => false);
  return k === 'vague' || k === 'intent' || k === 'likeness' ? null : k;
}

/* --------------------------------------------------------------- session */

const SESSION = 2;

/** The conversation as a reload finds it: the setup and the versions, in one string. */
export function packSession(setup: SetupState, studio: StudioState): string {
  return JSON.stringify({ v: SESSION, setup: serializeSetup(setup), studio: serialize(studio) });
}

/** Read back, each half checked by its own codec; anything malformed is a new conversation. */
export function unpackSession(raw: string | null): { setup: SetupState | null; studio: StudioState | null } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o?.v !== SESSION) return null;
    return {
      setup: deserializeSetup(o.setup),
      studio: deserialize(typeof o.studio === 'string' ? o.studio : null),
    };
  } catch {
    return null;
  }
}
