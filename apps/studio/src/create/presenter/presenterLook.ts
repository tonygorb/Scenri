import type { Swatch, SwatchRow } from '../../conversation/question.js';
import { colourWords, grownHair } from './colourWords.js';
import { type Given, LOOK_ORDER, type LookStep, PASSED } from './presenterQuestions.js';

/**
 * The look, as things to tap rather than words to find. Each row is one
 * question and one tap answers it, in the order `LOOK_ORDER` sets: who they
 * are, then their face, then their hair, then their body.
 *
 * Two forms, and which one a row takes follows what is being chosen. A colour
 * is a swatch of the colour it stands for, because nothing reads a colour
 * faster than the colour. Everything else is a photograph, because a shape is
 * read faster than the word for it. A colour of your own is allowed on the
 * colour rows and is read back as the nearest name we have a word for, since a
 * hex code means nothing to a model.
 */
export const HAIR_COLOURS: Swatch[] = [
  { id: 'black', label: 'Black', color: '#15120f' },
  { id: 'dark brown', label: 'Dark brown', color: '#3b2418' },
  { id: 'brown', label: 'Brown', color: '#6b4630' },
  { id: 'auburn', label: 'Auburn', color: '#8c3b26' },
  { id: 'ginger', label: 'Ginger', color: '#c2622a' },
  { id: 'blonde', label: 'Blonde', color: '#d8ac63' },
  { id: 'platinum blonde', label: 'Platinum', color: '#e9e1d0' },
  { id: 'grey', label: 'Grey', color: '#9b9b99' },
  { id: 'white', label: 'White', color: '#f0efed' },
];

/**
 * The drawn rows. Each option names one card in `assets/traits`, and the cards
 * of a row are cut from a single sheet drawn in one pass, so the whole row
 * shares a camera, a light and a figure and differs only in the thing it is
 * asking about. The card is named here, beside the option, and nowhere else.
 */
export const HAIR_LENGTHS: Swatch[] = [
  { id: 'buzzed', label: 'Buzzed', card: 'length-1' },
  { id: 'cropped', label: 'Cropped', card: 'length-2' },
  { id: 'short', label: 'Short', card: 'length-3' },
  { id: 'chin-length', label: 'Chin', card: 'length-4' },
  { id: 'shoulder-length', label: 'Shoulder', card: 'length-5' },
  { id: 'long', label: 'Long', card: 'length-6' },
];

export const SKIN_TONES: Swatch[] = [
  { id: 'porcelain', label: 'Porcelain', color: '#f4e0d4' },
  { id: 'fair', label: 'Fair', color: '#edcdb6' },
  { id: 'light olive', label: 'Light olive', color: '#ddb894' },
  { id: 'olive', label: 'Olive', color: '#c2935f' },
  { id: 'tan', label: 'Tan', color: '#a9713f' },
  { id: 'brown', label: 'Brown', color: '#7c4f2c' },
  { id: 'deep brown', label: 'Deep brown', color: '#57351d' },
  { id: 'deep', label: 'Deep', color: '#3a2114' },
];

/**
 * Five builds, one scale, read light to heavy.
 *
 * Nine was a list of synonyms across two different questions: slight, lean and
 * average say how much of a person there is, while athletic, muscular, curvy,
 * broad and stocky say what shape it takes, and a row that mixes the two asks
 * something nobody can answer in one tap. Muscle and shape are words, not
 * sizes, so they belong in "Describe the build" rather than in the row. Five
 * is also what the drawings can carry: these are the five cells of the sheet
 * that differ most from one another.
 */
export const BUILDS: Swatch[] = [
  { id: 'slight', label: 'Slight', card: 'build-1' },
  { id: 'lean', label: 'Lean', card: 'build-2' },
  { id: 'average', label: 'Average', card: 'build-3' },
  { id: 'solid', label: 'Solid', card: 'build-4' },
  { id: 'full', label: 'Full', card: 'build-5' },
];

/**
 * Where they are from, as steering rather than as a declaration.
 *
 * Regions, not nationalities: one card per country would flatten a country
 * into one face, and the broader term is what an engine actually steers on.
 * The row is skippable like every other and the composer takes anything the
 * thirteen do not cover, because no list of origins is ever the world.
 *
 * Measured 2026-09-12: asked for `deep` skin alone, the roll returned a
 * mid-brown woman with straight hair; asked for `Nigerian` beside `deep`, it
 * returned deep skin and coily hair. Heritage steers more than one attribute
 * at once, which is why it is a row and not a footnote.
 */
export const HERITAGES: Swatch[] = [
  { id: 'East Asian', label: 'East Asian' },
  { id: 'South Asian', label: 'South Asian' },
  { id: 'Southeast Asian', label: 'Southeast Asian' },
  { id: 'Middle Eastern', label: 'Middle Eastern' },
  { id: 'Mediterranean', label: 'Mediterranean' },
  { id: 'North African', label: 'North African' },
  { id: 'West African', label: 'West African' },
  { id: 'East African', label: 'East African' },
  { id: 'Northern European', label: 'Northern European' },
  { id: 'Eastern European', label: 'Eastern European' },
  { id: 'Latin American', label: 'Latin American' },
  { id: 'Caribbean', label: 'Caribbean' },
  { id: 'mixed heritage', label: 'Mixed' },
];

/**
 * Eyes, by colour.
 *
 * A swatch, the same control the hair and the skin already use, rather than a
 * row of drawn faces. An iris is a colour and the app has a way of asking for
 * one: seven faces that differ in four pixels each is a worse answer to the
 * same question, and the picker beside it lets somebody have an eye colour the
 * row does not name.
 */
export const EYE_COLOURS: Swatch[] = [
  { id: 'dark brown', label: 'Dark brown', color: '#3b2a1d' },
  { id: 'brown', label: 'Brown', color: '#6b4423' },
  { id: 'hazel', label: 'Hazel', color: '#8a7340' },
  { id: 'amber', label: 'Amber', color: '#b07d1a' },
  { id: 'green', label: 'Green', color: '#5b7a4b' },
  { id: 'blue', label: 'Blue', color: '#4a7ba7' },
  { id: 'grey', label: 'Grey', color: '#8b949c' },
];

/**
 * Facial hair, including its absence as a real answer.
 *
 * Clean-shaven is chosen, never assumed: left unsaid the roll decides, and it
 * decided a beard on two of the five men in the measurement run. A row that
 * only offered beards would make "no beard" the one thing you cannot ask for.
 */
export const FACIAL_HAIR: Swatch[] = [
  { id: 'clean-shaven', label: 'Clean shaven', card: 'facial-1' },
  { id: 'light stubble', label: 'Stubble', card: 'facial-2' },
  { id: 'a moustache', label: 'Moustache', card: 'facial-3' },
  { id: 'a goatee', label: 'Goatee', card: 'facial-4' },
  { id: 'a short beard', label: 'Short beard', card: 'facial-5' },
  { id: 'a full beard', label: 'Full beard', card: 'facial-6' },
];

/**
 * How tall, in three.
 *
 * Height cannot be read off a figure standing alone, so the plates draw the
 * three together on one ground at one scale. It is a body row: measured
 * 2026-09-12, it never once read at head-and-shoulders framing, and it moves
 * the front view along with the build.
 */
export const HEIGHTS: Swatch[] = [
  { id: 'very short', label: 'Very short', card: 'height-1' },
  { id: 'short', label: 'Short', card: 'height-2' },
  { id: 'average height', label: 'Average', card: 'height-3' },
  { id: 'tall', label: 'Tall', card: 'height-4' },
  { id: 'very tall', label: 'Very tall', card: 'height-5' },
];

/**
 * How a height is said.
 *
 * The ids are already the words, because a height has no shorter name than
 * itself: "tall" is what a person says and what an engine is given. The table
 * stays as the one place a reading could differ from the id if it ever has to.
 */
const HEIGHT_WORDS: Record<string, string> = {};

export const WHO_OPTIONS = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'androgynous', label: 'Androgynous' },
];

export const AGE_OPTIONS = ['20s', '30s', '40s', '50s', '60+'].map((a) => ({ id: a, label: a }));

/**
 * The rows of the look, in the order they are read down the picker.
 *
 * Grouped the way a person describes somebody rather than the way a schema
 * lists fields: who they are, then their face, then their hair, then their
 * body. The order here is the order on screen and nothing else: the sentence
 * below builds its own clause order, because what reads best down a column and
 * what reads best in a line are not the same thing.
 *
 * `prompt` is no longer a screen of its own. Eleven rows are answered together
 * on one, so these are what a row is called when it is pointed back at: a
 * refusal, a read-back, a question re-asked in words.
 */
export const LOOK_ROWS: Record<LookStep, { row: SwatchRow; prompt: string }> = {
  who: { row: { id: 'who', label: 'Who', options: WHO_OPTIONS }, prompt: 'Who are they?' },
  age: { row: { id: 'age', label: 'Age', options: AGE_OPTIONS }, prompt: 'Roughly how old?' },
  heritage: { row: { id: 'heritage', label: 'Heritage', options: HERITAGES }, prompt: 'Where are they from?' },
  skin: { row: { id: 'skin', label: 'Skin', options: SKIN_TONES }, prompt: 'And their skin?' },
  eyes: { row: { id: 'eyes', label: 'Eyes', options: EYE_COLOURS }, prompt: 'What colour are their eyes?' },
  facial: { row: { id: 'facial', label: 'Facial hair', options: FACIAL_HAIR }, prompt: 'Any facial hair?' },
  hair: { row: { id: 'hair', label: 'Hair', options: HAIR_COLOURS }, prompt: 'What colour is their hair?' },
  length: { row: { id: 'length', label: 'Length', options: HAIR_LENGTHS }, prompt: 'And the length?' },
  build: { row: { id: 'build', label: 'Build', options: BUILDS }, prompt: 'And their build?' },
  height: { row: { id: 'height', label: 'Height', options: HEIGHTS }, prompt: 'And how tall?' },
};

export const LOOK_STEPS = LOOK_ORDER.map((id) => LOOK_ROWS[id]);

/** The steps whose answer is a colour, and so carry the colour control. */
export const LOOK_COLOUR = new Set<LookStep>(['hair', 'skin', 'eyes']);

/** What the composer asks for while a row is being answered in words. */
export const LOOK_SAYS_PLACEHOLDER: Partial<Record<LookStep, string>> = {
  who: 'Who they are, in your words',
  age: 'Their age, in words or a number',
  heritage: 'Where they are from, in your words',
  hair: 'Their hair colour, in words or a swatch',
  length: 'Their cut, in your words',
  facial: 'Their facial hair, in your words',
  eyes: 'Their eye colour, in words or a swatch',
  skin: 'Their skin, in words or a swatch',
  build: 'Their build, in your words',
  height: 'How tall they are, in your words',
};

/**
 * Which figure a row of cards is drawn on: three, not two.
 *
 * The sprite sheets above have a man and a woman and send everybody else to
 * the woman, which is a decision about who exists made by a fallback. A card
 * row is drawn per cast and has no such excuse, so an androgynous person is
 * drawn as one. Anyone who skipped the question or typed their own words is
 * drawn that way too: it is the reading that assumes least.
 */
export const cardCast = (who: string | undefined): string =>
  who === 'man' ? 'man' : who === 'woman' ? 'woman' : 'androgynous';

/**
 * The rows whose cards are drawn once per cast.
 *
 * Hair is the whole of it: a woman's shoulder-length hair and a man's are not
 * the same picture, and a row that pretends otherwise is the row Tony kept
 * pointing at. A detail worn on a face is not: glasses are glasses.
 */
export const CAST_ROWS = new Set<LookStep>(['length', 'height', 'build']);

/**
 * How far a colour may sit from a swatch and still take its name, as a squared
 * distance in RGB. Neighbouring swatches on a row are about forty apart, so a
 * radius of thirty snaps a colour that plainly is that swatch and lets go of
 * everything else. It used to be ninety-five, which swallowed most of the
 * wheel: a lavender came back as "fair" and a navy as "deep".
 */
const NEAR = 900;

/**
 * The name for a colour that was picked rather than tapped.
 *
 * Close to one of the row's own swatches, it takes that swatch's word, because
 * the row is the vocabulary this step already speaks. Further away it is said
 * in plain colour words, and on a head a colour hair does not grow in was dyed
 * there, which is what the engine has to be told.
 */
export function colourName(hex: string, among: Swatch[], row?: string): string {
  const near = nearestSwatch(hex, among, true);
  if (near.far < NEAR) return near.id;
  const said = colourWords(hex).name;
  return row === 'hair' && !grownHair(hex) ? `dyed ${said}` : said;
}

/** The name we have for a colour of someone's own: the nearest one on its row. */
export function nearestSwatch(hex: string, among: Swatch[]): string;
export function nearestSwatch(hex: string, among: Swatch[], withDistance: true): { id: string; far: number };
export function nearestSwatch(hex: string, among: Swatch[], withDistance?: true): string | { id: string; far: number } {
  const rgb = (h: string) => {
    const v = h.replace('#', '');
    const n = v.length === 3 ? v.split('').map((c) => c + c) : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)];
    return n.map((p) => Number.parseInt(p, 16) || 0);
  };
  const [r, g, b] = rgb(hex);
  let best = among[0];
  let far = Number.POSITIVE_INFINITY;
  for (const one of among) {
    if (!one.color) continue;
    const [x, y, z] = rgb(one.color);
    const d = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (d < far) {
      far = d;
      best = one;
    }
  }
  return withDistance ? { id: best.id, far } : best.id;
}

/** The swatches a colour step is named against. */
export const colourRow = (step: string | null | undefined): Swatch[] =>
  step === 'skin' ? SKIN_TONES : step === 'eyes' ? EYE_COLOURS : HAIR_COLOURS;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What was said at the rows, as a person: the sentence the engine is given.
 *
 * A row can carry a chip, their own words, or both. The chip is the base and
 * the words qualify it, and the qualifier goes **after** the phrase its row
 * owns rather than inside it: every row but the first sits in front of a noun
 * ("a lean build"), so putting the words in the middle would say "a lean, with
 * narrower shoulders build". A row with words and no chip has nothing to
 * qualify, so the words are the base, which is what a described row has always
 * done.
 */
export function lookSentence(look: Partial<Record<LookStep, Given>>): string {
  /** The chip, if there is one that says anything: the way past says nothing. */
  const pickOf = (v: Given | undefined) => (v?.pick && v.pick !== PASSED ? v.pick : '');
  const base = (v: Given | undefined, among: Swatch[], row?: string) => {
    const p = pickOf(v);
    if (p) return p.startsWith('#') ? colourName(p, among, row) : p;
    return v?.words?.trim() ?? '';
  };
  /** Their words, when something was tapped for them to be about. */
  const qual = (v: Given | undefined) => (pickOf(v) ? (v?.words?.trim() ?? '') : '');
  const join = (phrase: string, ...words: string[]) => [phrase, ...words.filter(Boolean)].join(' ');
  const lower = (v: Given | undefined, among: Swatch[], row?: string) => base(v, among, row).toLowerCase();

  // The three the row offers, and then whatever else was typed into it. A
  // switch with a default dropped every other answer on the floor: somebody
  // who said "a non-binary person" watched it land in the conversation and
  // be drawn as "a person".
  const NOUN: Record<string, string> = {
    androgynous: 'androgynous person',
    man: 'man',
    woman: 'woman',
  };
  // Heritage sits in front of the noun, so the article has to be decided after
  // the two are joined: it is "a woman" but "an East Asian woman", and the
  // article is a fact about the next word rather than about the person.
  const said = lower(look.who, []);
  const noun = NOUN[said] ?? said;
  const from = base(look.heritage, []);
  const head = [from, noun].filter(Boolean).join(' ');
  const who = !head
    ? 'a person'
    : /^(a|an|the)\s/i.test(head)
      ? head
      : `${/^[aeiou]/i.test(head) ? 'an' : 'a'} ${head}`;
  const parts: string[] = [who];

  const age = lower(look.age, []);
  // The row offers decades, so "in their 40s" is the shape; a number of their
  // own is a number, and "in their 90" is not how anybody says it.
  const aged = age === '60+' ? 'in their 60s or older' : /^\d{1,3}$/.test(age) ? `aged ${age}` : `in their ${age}`;
  if (age) parts.push(join(aged, qual(look.age)));

  const has: string[] = [];
  // Hair is one noun phrase built from two rows: how long it is and what
  // colour it is.
  const length = lower(look.length, HAIR_LENGTHS);
  const colour = lower(look.hair, HAIR_COLOURS, 'hair');
  const hair = [length, colour].filter(Boolean).join(' ');
  if (hair) has.push(join(`${hair} hair`, qual(look.length), qual(look.hair)));

  const facial = lower(look.facial, FACIAL_HAIR);
  if (facial) has.push(join(facial, qual(look.facial)));
  const eyes = lower(look.eyes, EYE_COLOURS);
  if (eyes) has.push(join(`${eyes} eyes`, qual(look.eyes)));
  const skin = lower(look.skin, SKIN_TONES, 'skin');
  if (skin) has.push(join(`${skin} skin`, qual(look.skin)));

  // The body is one clause, because a height and a build are read together:
  // "tall with a lean build". Either alone still stands on its own.
  const height = lower(look.height, HEIGHTS);
  const build = lower(look.build, BUILDS);
  const tall = height ? join(HEIGHT_WORDS[height] ?? height, qual(look.height)) : '';
  const built = build ? join(`${/^[aeiou]/.test(build) ? 'an' : 'a'} ${build} build`, qual(look.build)) : '';
  const body = [tall, built && (tall ? `with ${built}` : built)].filter(Boolean).join(' ');
  if (body) has.push(body);

  if (has.length) parts.push(`with ${has.join(', ')}`);
  // The subject is the one row that is not a phrase in front of a noun, so
  // its words ride at the end, as a clause about the whole person.
  return join(parts.join(' '), qual(look.who));
}

/**
 * What was said at one row, as the answer in the transcript: what was tapped,
 * and their own words about it after a comma.
 */
export function answerLabel(row: SwatchRow, given: Given): string {
  const pick = given.pick;
  const chosen =
    pick === PASSED
      ? 'Either way'
      : pick?.startsWith('#')
        ? cap(colourName(pick, row.options, row.id))
        : pick
          ? (row.options.find((o) => o.id === pick)?.label ?? cap(pick))
          : '';
  const said = given.words?.trim() ?? '';
  // said in words rather than tapped: the words are the answer
  if (!chosen) return cap(said);
  return said ? `${chosen}, ${said}` : chosen;
}

/** The whole look, read back as one line. */
export function lookLine(look: Partial<Record<LookStep, Given>>): string {
  return cap(lookSentence(look));
}
