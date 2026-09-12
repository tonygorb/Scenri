import type { Swatch, SwatchRow } from '../../conversation/question.js';
import { colourWords, grownHair } from './colourWords.js';
import { type Given, LOOK_ORDER, type LookStep, PASSED } from './presenterQuestions.js';

/**
 * The look, as things to tap rather than words to find: who, an age, hair by
 * colour and by length, skin by tone, a build. Each row is one question and
 * one tap answers it. Colours are swatches of the colour they stand for; a
 * length and a build are drawn, because a shape is read faster than the word
 * for it. A colour of your own is allowed on the colour rows and is read back
 * as the nearest name we have a word for, since a hex code means nothing to a
 * model.
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
 * The drawn rows. Each option is one cell of a sheet drawn once for the whole
 * row (`assets/look`), so every plate in a row shares a hand. The cell is
 * named here, beside the option, and nowhere else.
 */
export const HAIR_LENGTHS: Swatch[] = [
  { id: 'buzzed', label: 'Buzzed', art: { sheet: 'hair', x: 0, y: 0 } },
  { id: 'cropped', label: 'Cropped', art: { sheet: 'hair', x: 1, y: 0 } },
  { id: 'short', label: 'Short', art: { sheet: 'hair', x: 2, y: 0 } },
  { id: 'chin-length', label: 'Chin', art: { sheet: 'hair', x: 0, y: 1 } },
  { id: 'shoulder-length', label: 'Shoulder', art: { sheet: 'hair', x: 1, y: 1 } },
  { id: 'long', label: 'Long', art: { sheet: 'hair', x: 2, y: 1 } },
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
  { id: 'slight', label: 'Slight', art: { sheet: 'build', x: 0, y: 0 } },
  { id: 'lean', label: 'Lean', art: { sheet: 'build', x: 2, y: 0 } },
  { id: 'average', label: 'Average', art: { sheet: 'build', x: 0, y: 1 } },
  { id: 'solid', label: 'Solid', art: { sheet: 'build', x: 0, y: 2 } },
  { id: 'full', label: 'Full', art: { sheet: 'build', x: 1, y: 2 } },
];

export const WHO_OPTIONS = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'androgynous', label: 'Androgynous' },
];

export const AGE_OPTIONS = ['20s', '30s', '40s', '50s', '60+'].map((a) => ({ id: a, label: a }));

/** The rows of the look, in the order they are asked, each with its question. */
export const LOOK_ROWS: Record<LookStep, { row: SwatchRow; prompt: string }> = {
  who: { row: { id: 'who', label: 'Who', options: WHO_OPTIONS }, prompt: 'Who are they?' },
  age: { row: { id: 'age', label: 'Age', options: AGE_OPTIONS }, prompt: 'Roughly how old?' },
  hair: { row: { id: 'hair', label: 'Hair', options: HAIR_COLOURS }, prompt: 'What colour is their hair?' },
  length: { row: { id: 'length', label: 'Length', options: HAIR_LENGTHS }, prompt: 'And the length?' },
  skin: { row: { id: 'skin', label: 'Skin', options: SKIN_TONES }, prompt: 'And their skin?' },
  build: { row: { id: 'build', label: 'Build', options: BUILDS }, prompt: 'And their build?' },
};

export const LOOK_STEPS = LOOK_ORDER.map((id) => LOOK_ROWS[id]);

/** The steps whose answer is a colour, and so carry the colour control. */
export const LOOK_COLOUR = new Set<LookStep>(['hair', 'skin']);

/** What the composer asks for while a step is being answered in words. */
export const LOOK_SAYS_PLACEHOLDER: Partial<Record<LookStep, string>> = {
  hair: 'Their hair colour, in words or a swatch',
  length: 'Their cut, in your words',
  skin: 'Their skin, in words or a swatch',
  build: 'Their build, in your words',
};

/** The figure the drawn rows show: a man's hair on a man's head; anyone else stands with the fuller of the two. */
export const castFor = (who: string | undefined): string => (who === 'man' ? 'man' : 'woman');

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
export const colourRow = (step: string | null | undefined): Swatch[] => (step === 'skin' ? SKIN_TONES : HAIR_COLOURS);

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
    if (p) return p.startsWith('#') ? colourName(p, among, row) : p.toLowerCase();
    return v?.words?.trim().toLowerCase() ?? '';
  };
  /** Their words, when something was tapped for them to be about. */
  const qual = (v: Given | undefined) => (pickOf(v) ? (v?.words?.trim() ?? '') : '');
  const join = (phrase: string, ...words: string[]) => [phrase, ...words.filter(Boolean)].join(' ');
  // The three the row offers, and then whatever else was typed into it. A
  // switch with a default dropped every other answer on the floor: somebody
  // who said "a non-binary person" watched it land in the conversation and
  // be drawn as "a person".
  const KNOWN: Record<string, string> = {
    androgynous: 'an androgynous person',
    man: 'a man',
    woman: 'a woman',
  };
  const said = base(look.who, []);
  const who = KNOWN[said] ?? (said ? (/^(a|an|the)\s/i.test(said) ? said : `a ${said}`) : 'a person');
  const parts: string[] = [who];
  const age = base(look.age, []);
  // The row offers decades, so "in their 40s" is the shape; a number of their
  // own is a number, and "in their 90" is not how anybody says it.
  const aged = age === '60+' ? 'in their 60s or older' : /^\d{1,3}$/.test(age) ? `aged ${age}` : `in their ${age}`;
  if (age) parts.push(join(aged, qual(look.age)));
  const hair = [base(look.length, HAIR_LENGTHS), base(look.hair, HAIR_COLOURS, 'hair')].filter(Boolean).join(' ');
  const has: string[] = [];
  if (hair) has.push(join(`${hair} hair`, qual(look.length), qual(look.hair)));
  const skin = base(look.skin, SKIN_TONES, 'skin');
  if (skin) has.push(join(`${skin} skin`, qual(look.skin)));
  const build = base(look.build, []);
  if (build) has.push(join(`${/^[aeiou]/.test(build) ? 'an' : 'a'} ${build} build`, qual(look.build)));
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
