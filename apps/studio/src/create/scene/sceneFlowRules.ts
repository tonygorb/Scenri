import {
  type Aside,
  answersNothing,
  asideTurns,
  type NothingKind,
  type Question,
  type Turn,
} from '../../conversation/question.js';
import type { SceneExampleRole, SceneReading } from '../../apiTypes.js';
import { EXAMPLE_LABEL, type ExampleTile } from '../../sceneExampleRules.js';
import { COPY } from './sceneCopy.js';
import { optionOf, rowNoun, ROWS, type SceneRow, swatchRow } from './sceneRows.js';
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
  saidSomething,
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
   * Scenes this person already made, newest first, each a store hash and its name.
   *
   * Offered at the picture question so the fastest place-reference is one of
   * theirs. Product shots never belong here: a scene is a place, and a feed
   * of hundreds of cans is not a library of places.
   */
  have?: { hash: string; alt: string }[];
  /** After Use: the place in use, as the saved scene and its run have it. */
  set?: SetArgs;
}

/** The examples drawn after Use, as the conversation tells them. */
export interface SetArgs {
  tiles: ExampleTile[];
  running: boolean;
  /** The run has been asked about at least once: before that, nothing drawing is not known. */
  read: boolean;
  /** Who stands in them. */
  who: 'product' | 'presenter';
  /** Nothing in Scenri's library can stand in this place yet. */
  noSubject: boolean;
  /** What Add more would still draw. */
  missing: SceneExampleRole[];
  /** What the last press says: Open scene, or Use in a shot when the studio was opened from one. */
  finish: string;
}

const PREVIEW_HASH = /^asset:([a-f0-9]{32})$/;

/**
 * The brand's own scenes that have a picture, newest first.
 *
 * The document appends, so the last row is the newest. A scene without a
 * preview is a place in words only and cannot be tapped as a photograph.
 */
export function placesTheyMade(
  rows: readonly { name?: unknown; preview?: unknown }[],
): { hash: string; alt: string }[] {
  const out: { hash: string; alt: string }[] = [];
  for (const s of [...rows].reverse()) {
    const m = PREVIEW_HASH.exec(String(s.preview ?? ''));
    if (!m) continue;
    out.push({ hash: m[1], alt: String(s.name ?? '').trim() || 'A scene you made' });
  }
  return out;
}

/** What the words of a reading say, as one quotable block. */
export function readingQuote(r: SceneReading): string {
  return readingLines(r)
    .map((l) => (l.label === COPY.placeLabel ? l.text : `${l.label}: ${l.text.replace(/[.\s]+$/, '')}.`))
    .join(' ');
}

/** A stop or a lost job says its own sentence; a failure is quoted inside one. */
const SAYS_ITSELF = new Set([COPY.stopped, COPY.stoppedRead, COPY.stoppedDraw, COPY.stoppedChange, COPY.lost]);
const retryPrompt = (error: string) =>
  SAYS_ITSELF.has(error) ? error : COPY.failedFirst(error.replace(/[.\s]+$/, ''));

/* ------------------------------------------------------------- questions */

export function questionFor(
  id: Qid,
  setup: SetupState,
  reopened: boolean,
  uploading: number,
  have: { hash: string; alt: string }[] = [],
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
              items: have,
              more: COPY.haveMore(have.length),
              fewer: COPY.haveFewer,
              search: COPY.haveSearch,
            },
          }
        : {}),
    };
  const g = a[id];
  // Skipping the light row already means "keep the world's own light":
  // compileDirection falls back to the chosen world's `light` the moment this
  // row is passed. The prompt itself says so, so a world picked for its light
  // is not followed by a blank "what light?" as if nothing were known.
  const worldLight = id === 'light' ? optionOf('world', a.world?.pick)?.light : undefined;
  // After a world, passing the surface keeps what that world is made of.
  const worldSurface = id === 'surface' && !!optionOf('world', a.world?.pick);
  const given = g?.pick === PASSED ? undefined : g?.pick;
  const skipped = g?.pick === PASSED;
  const note = g?.words;
  const afterWords = a.source?.door === 'words';
  return {
    id,
    kind: 'swatches',
    prompt: promptFor(id, a),
    row: swatchRow(id),
    // Only the worlds are a set to compare at once. The rest stay a strip: a
    // row of variants, one swipe at a time.
    layout: id === 'world' ? 'grid' : undefined,
    hint: id === 'world' && !afterWords ? COPY.worldHint : undefined,
    skip: worldLight
      ? COPY.keepWorldLight
      : worldSurface
        ? COPY.keepWorldSurface
        : afterWords
          ? COPY.leaveToReading
          : COPY.skip,
    describe: COPY.describeInstead,
    given,
    skipped,
    note,
    ...base,
  };
}

/**
 * A row's question as it was put: after a world with its own light, the light
 * row says so; after a typed sentence, a follow-up says what the sentence
 * already gave. The same words when it is asked and when it is looked back on.
 */
function promptFor(id: SceneRow, a: Answers): string {
  const worldLight = id === 'light' ? optionOf('world', a.world?.pick)?.light : undefined;
  if (worldLight) return COPY.worldLightPrompt(worldLight);
  if (a.source?.door === 'words') {
    if (id === 'world') return COPY.followWorld;
    if (id === 'light') return COPY.followLight;
  }
  return ROWS[id].prompt;
}

const askedLine = (id: Qid, a: Answers): string =>
  id === 'source' ? COPY.source : id === 'photos' ? COPY.photos : promptFor(id, a);

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
  // A light passed after a world was "Keep it", not a blank skip: the
  // transcript has to say the same word the button did.
  const keptWorldLight = id === 'light' && g?.pick === PASSED && optionOf('world', a.world?.pick)?.light;
  const keptWorldSurface = id === 'surface' && g?.pick === PASSED && !!optionOf('world', a.world?.pick);
  const passedAs = keptWorldLight
    ? COPY.keepWorldLight
    : keptWorldSurface
      ? COPY.keepWorldSurface
      : a.source?.door === 'words'
        ? COPY.leaveToReading
        : COPY.skip;
  const picked = g?.pick === PASSED ? passedAs : optionOf(id, g?.pick)?.label;
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
      T.push({ kind: 'scenri', id: `asked-${id}`, text: askedLine(id, a), quiet: true });
      attach(id);
      if (setup.editing === id) {
        T.push({ kind: 'question', question: questionFor(id, setup, true, args.uploading, args.have ?? []) });
        continue;
      }
      const line = answerLine(id, a);
      T.push({ kind: 'you', id, text: line.text, photos: line.photos, editable: !studio.job && !studio.saved });
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
        // once used, the place is decided: an earlier picture is history, not a choice
        restore: i === studio.current || studio.saved ? undefined : { view: 'scene', hash: v.hash },
      });
    }
    if (i === studio.current)
      for (const [k, c] of v.coverage.entries()) T.push({ kind: 'scenri', id: `cover-${i}-${k}`, text: c });
    attach(`agree-${i}`);
    attach(`decide-${i}`);
  });

  // the work in flight: what was pressed, said at once, before anything lands
  const job = studio.job;
  // The wait itself is the Working line (`doingLine`), not a second sentence
  // that says the same thing. The compiled taps stay off screen until the
  // finished read-back arrives once.
  if (job?.kind === 'again')
    T.push({ kind: 'you', id: `pending-${job.id}`, text: firstPicture < 0 ? COPY.draw : COPY.tryAgain });
  if (job?.kind === 'change') T.push({ kind: 'you', id: `pending-${job.id}`, text: job.ask ?? '' });
  if (job?.kind === 'again' && firstPicture < 0 && !edit) nameExchange(T, args);

  // after Use: the place in use, one picture at a time
  if (studio.saved) setTurns(T, args);

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
  } else if (studio.saved) open = setQuestion(args);
  else {
    const v = current(studio);
    // given again and not read yet: the read is on its way, or it failed and asks
    if (args.stale && !edit) {
      if (studio.error)
        open = {
          id: 'retry',
          kind: 'confirm',
          tone: 'alert',
          prompt: retryPrompt(studio.error),
          options: [{ id: 'retry', label: COPY.retry }],
        };
    } else if (!v && studio.error)
      open = {
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: retryPrompt(studio.error),
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

/**
 * What Use leads to: the answer, then the place in use. Each example is a
 * picture turn with Try again beside it; one still drawing is the Working
 * line, not a sentence; one that failed says so.
 */
function setTurns(T: Turn[], args: FlowArgs) {
  const { studio, edit, set, canDraw } = args;
  T.push({ kind: 'you', id: 'use', text: edit ? COPY.saveChanges : canDraw ? COPY.use : COPY.saveWords });
  if (!set) return;
  const any = set.tiles.length > 0 || set.running;
  T.push({
    kind: 'scenri',
    id: 'saved',
    text: any ? COPY.inUse(set.who) : set.read && set.noSubject && canDraw ? COPY.noLibrary : COPY.saved,
  });
  // the answer to the three more stands where it was given: after the two
  // drawn by themselves, before any of the three
  const answer = studio.moreAsked ? COPY.addThem : studio.moreDeclined ? COPY.notNow : null;
  let answered = false;
  const sayAnswer = () => {
    if (!answer || answered) return;
    answered = true;
    T.push({ kind: 'you', id: 'more', text: answer });
  };
  for (const t of set.tiles) {
    if (t.role !== 'hero' && t.role !== 'close') sayAnswer();
    if (t.state === 'shown' && t.hash)
      T.push({
        kind: 'scenri',
        id: `ex-${t.role}-${t.hash}`,
        text: COPY.exampleHere[t.role],
        thumb: t.hash,
        label: EXAMPLE_LABEL[t.role],
        view: t.role,
        ...(set.running || studio.job ? {} : { retry: t.role }),
      });
    else if (t.state === 'failed')
      T.push({
        kind: 'scenri',
        id: `ex-failed-${t.role}`,
        text: COPY.exampleFailed(EXAMPLE_LABEL[t.role], t.error ?? COPY.failed),
        tone: 'alert',
      });
  }
  sayAnswer();
}

/** The question the set ends on: three more, or done. None while anything draws. */
function setQuestion(args: FlowArgs): Question | null {
  const { set, studio } = args;
  const name = studio.name.trim() || current(studio)?.reading.name || 'The scene';
  if (!set) return null;
  if (set.running || !set.read) return null;
  const hero = set.tiles.some((t) => t.role === 'hero' && t.state === 'shown');
  if (args.canDraw && hero && set.missing.length && !studio.moreDeclined && !studio.moreAsked)
    return {
      id: 'set-more',
      kind: 'confirm',
      prompt: COPY.more(set.missing.map((r) => EXAMPLE_LABEL[r])),
      options: [
        { id: 'more', label: COPY.addThem },
        { id: 'not-now', label: COPY.notNow },
      ],
    };
  const failed = set.tiles.filter((t) => t.state === 'failed');
  return {
    id: 'set-done',
    kind: 'confirm',
    prompt: failed.length ? COPY.readyMissing(name) : COPY.ready(name),
    options: [
      ...(failed.length && args.canDraw ? [{ id: 'retry-failed', label: COPY.tryAgain }] : []),
      { id: 'done', label: set.finish },
    ],
  };
}

/** The name, once given: asked while the first picture draws, kept as its own exchange. */
function nameExchange(T: Turn[], args: FlowArgs) {
  if (!args.studio.named && !args.editingName) return;
  T.push({ kind: 'scenri', id: 'asked-name', text: COPY.name, quiet: true });
  // once used, the name is the saved scene's: it is changed on the scene's page
  const editable = !args.studio.saved;
  T.push({ kind: 'you', id: 'name', text: args.studio.name, editable, editing: args.editingName || undefined });
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
  // once used, the place is decided; the pictures after it are asked for by tapping
  if (studio.saved) return off('', !!studio.job || !!args.set?.running);
  // an answer open again from its pencil takes the sentence
  const reopened = setup.editing;
  if (reopened === 'source') return say({ kind: 'source' }, COPY.sourcePlaceholder, true);
  if (reopened && isRow(reopened)) return say({ kind: 'row', id: reopened }, COPY.rowPlaceholder(rowNoun(reopened)));
  if (reopened === 'photos') return off(COPY.photosOff);
  // Every row passed and nothing said. The questions are over, so the line is
  // the only way on and it says so: without this the composer went off with
  // nothing on the floor, and Start over was the only move left.
  if (!open && !studio.job && setup.answers.source && !saidSomething(setup.answers))
    return say({ kind: 'source' }, COPY.nothingSaidPlaceholder, true);
  if (!open) return studio.job ? off('', true) : off('');
  if (open.id === 'source') return say({ kind: 'source' }, COPY.sourcePlaceholder, true);
  if (open.id === 'photos') return { ...off(COPY.photosOff), attach: true };
  if (isRow(open.id)) return say({ kind: 'row', id: open.id }, COPY.rowPlaceholder(rowNoun(open.id)));
  if (open.id === 'name') return say({ kind: 'name' }, COPY.namePlaceholder);
  // Stop left the conversation open: they can tap Try again, or say the place
  // again in the line. Off here was the dead end.
  if (open.id === 'retry') return say({ kind: 'source' }, COPY.nothingSaidPlaceholder, true);
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
  if (at === 'source') {
    const k = answersNothing(text, describesPlace);
    // "Vague" is the presenter's rule, where one or two words cannot describe a
    // whole person. A place is not like that: "moon", "cathedral", "sauna" and
    // "dunes" are complete seeds, and the reader expands them the way it
    // expands a paragraph. Refusing them told somebody typing a real prompt
    // that their prompt was not a place, which is the one thing this door
    // exists to accept. Greetings, questions, noise and requests to go
    // somewhere are still refused, by the tests above this one.
    return k === 'vague' ? null : k;
  }
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
