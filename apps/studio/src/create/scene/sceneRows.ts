import type { SwatchRow } from '../../conversation/question.js';

/**
 * The things a place is asked, in the order they are asked.
 *
 * A world is a starting direction, not the final scene. Light, material and
 * mood live inside each world's words; the light row then asks whether to keep
 * that light or replace it. What the person types on top personalises it.
 *
 * Nothing about the subject is asked, and no row asks where the camera is.
 * Both would be written into the place's words, and every shot in the scene is
 * told those words: "on a plinth" would stand every product and every
 * presenter on a plinth, and a camera would hold every shot to one view. How
 * the subject sits and where the camera stands belong to each shot; the
 * scene's example set shows the place in use from several angles
 * (sceneExamples.ts), and its ways of shooting it keep the ones worth reusing
 * (sceneSetups.ts).
 *
 * Each option carries the words it hands the reader (`words`), the card id for
 * its drawn picture (`card`), and the words a person might type instead of
 * tapping it (`cues`), so a sentence at the first question answers the rows it
 * covers and only the rest are asked.
 */
export type SceneRow = 'world' | 'light';

export const ROW_ORDER: readonly SceneRow[] = ['world', 'light'];

export interface RowOption {
  id: string;
  label: string;
  /** What choosing it tells the reader, as it would be written in the place's own sentence. */
  words: string;
  card?: string;
  /** What a person types when they mean this, lowercase, matched as whole words. */
  cues?: readonly string[];
  /**
   * A world's own light, used when the light question is passed over.
   *
   * Each world card is photographed in one particular light, so a world that
   * is asked for and then given no light should read the way its card looks
   * rather than as a place with nothing said about how it is lit.
   */
  light?: string;
}

interface RowSpec {
  prompt: string;
  options: RowOption[];
}

const card = (row: SceneRow, n: number) => `scene-${row}-${n}`;

export const ROWS: Record<SceneRow, RowSpec> = {
  world: {
    prompt: 'What world?',
    options: [
      {
        id: 'water',
        label: 'Rock and water',
        words: 'a shoreline of wet dark rock and shallow turquoise water',
        light: 'in hard midday sun',
        card: card('world', 1),
        cues: ['water', 'sea', 'ocean', 'shore', 'shoreline', 'beach', 'wet', 'pool', 'underwater'],
      },
      {
        id: 'stone',
        label: 'Sunlit stone',
        words: 'a niche of warm limestone and rough plaster',
        light: 'in hard afternoon sun',
        card: card('world', 2),
        cues: ['stone', 'limestone', 'wall', 'niche', 'arch', 'terracotta', 'mediterranean', 'sunlit'],
      },
      {
        id: 'colour',
        label: 'Colour field',
        words: 'a seamless studio sweep in one saturated colour',
        light: 'in flat hard poster light',
        card: card('world', 3),
        cues: ['studio', 'sweep', 'seamless', 'backdrop', 'colour', 'color', 'paper', 'poster', 'graphic', 'flat'],
      },
      {
        id: 'citrus',
        label: 'Fruit and sky',
        words: 'a mound of cut citrus under an open blue sky',
        light: 'in bright direct sun',
        card: card('world', 4),
        cues: ['fruit', 'citrus', 'orange', 'lemon', 'sky', 'outdoors', 'outdoor', 'summer', 'juice'],
      },
      {
        id: 'volcanic',
        label: 'Volcanic haze',
        words: 'dark volcanic rock in a deep orange haze',
        light: 'with one hard low light raking across it',
        card: card('world', 5),
        cues: ['volcanic', 'lava', 'rock', 'ash', 'dust', 'haze', 'smoke', 'desert', 'mars'],
      },
      {
        id: 'dark',
        label: 'Dark mirror',
        words: 'a near-black polished surface like a still pool',
        light: 'in low-key light, with one bright edge',
        card: card('world', 6),
        cues: ['mirror', 'reflection', 'polished', 'still pool'],
      },
      {
        id: 'plaster',
        label: 'Soft plaster',
        words: 'a bare plaster room with one tall soft window',
        light: 'in soft overcast daylight',
        card: card('world', 7),
        cues: [
          'plaster',
          'concrete',
          'microcement',
          'minimal',
          'interior',
          'room',
          'window',
          'raw',
          'architectural',
          'overcast',
        ],
      },
      {
        id: 'linen',
        label: 'Linen fold',
        words: 'a length of raw undyed linen folded in soft loose drapes',
        light: 'in soft window light',
        card: card('world', 8),
        cues: ['linen', 'fabric', 'textile', 'cloth', 'drape', 'fold', 'woven', 'cotton', 'soft fabric'],
      },
    ],
  },
  light: {
    prompt: 'What light?',
    options: [
      {
        id: 'soft',
        label: 'Soft daylight',
        words: 'in soft daylight, even and almost shadowless',
        card: card('light', 1),
        cues: ['soft', 'daylight', 'window', 'overcast', 'diffused', 'cloudy', 'north light'],
      },
      {
        id: 'golden',
        label: 'Golden hour',
        words: 'in low golden-hour sun, long warm shadows',
        card: card('light', 2),
        cues: ['golden', 'golden hour', 'sunset', 'sunrise', 'dusk', 'warm'],
      },
      {
        id: 'hard',
        label: 'Hard sun',
        words: 'in hard direct sun, crisp black-edged shadows',
        card: card('light', 3),
        cues: ['hard sun', 'harsh', 'midday', 'noon', 'crisp shadow', 'direct sun'],
      },
      {
        id: 'neon',
        label: 'Night and neon',
        words: 'at night, lit by coloured neon',
        card: card('light', 4),
        cues: ['neon', 'night', 'dark', 'moody', 'nocturnal', 'after dark'],
      },
      {
        id: 'flash',
        label: 'Studio flash',
        words: 'in direct studio flash, flat and bright with one hard shadow',
        card: card('light', 5),
        cues: ['flash', 'strobe', 'on camera flash', 'paparazzi', 'punchy'],
      },
      {
        id: 'lowkey',
        label: 'Low-key',
        words: 'in low-key light, one bright edge and the rest falling into darkness',
        card: card('light', 6),
        cues: ['low key', 'lowkey', 'dramatic', 'shadowy', 'chiaroscuro', 'rim light'],
      },
      {
        id: 'window',
        label: 'Window light',
        words: 'in soft window light from one side, one open shadow',
        card: card('light', 7),
        cues: ['window light', 'side light', 'from a window', 'sidelit', 'window'],
      },
      {
        id: 'blue',
        label: 'Blue hour',
        words: 'in blue hour, cool twilight just after the sun is gone',
        card: card('light', 8),
        cues: ['blue hour', 'twilight', 'blue hour light', 'after sunset', 'cool dusk'],
      },
    ],
  },
};

/**
 * The rows whose pictures are drawn.
 *
 * Worlds and lights: one thing changing across each row. Worlds are compared
 * as a set; lights are a strip of the same place under one changing decision.
 */
export const DRAWN: ReadonlySet<SceneRow> = new Set<SceneRow>(['world', 'light']);

/** A row as the conversation's swatch block takes it. */
export function swatchRow(row: SceneRow): SwatchRow {
  return {
    id: row,
    label: ROWS[row].prompt,
    options: ROWS[row].options.map((o) => ({
      id: o.id,
      label: o.label,
      ...(DRAWN.has(row) && o.card ? { card: o.card } : {}),
    })),
  };
}

/** What a row is about, for the line that invites words instead of a tap. */
export const rowNoun = (row: SceneRow): string => (row === 'world' ? 'place' : row === 'light' ? 'light' : 'setup');

export const optionOf = (row: SceneRow, id: string | undefined): RowOption | undefined =>
  id ? ROWS[row].options.find((o) => o.id === id) : undefined;

/**
 * What a typed phrase already answers.
 *
 * Somebody who types "overhead, in a studio" has answered both questions, and
 * asking them again is the friction this flow is being rebuilt to remove. A
 * cue matches on a word boundary, longest cue first, so "close up" beats
 * "close" and "orange" never matches inside "storage".
 */
export function fillFrom(text: string): Partial<Record<SceneRow, string>> {
  const said = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const out: Partial<Record<SceneRow, string>> = {};
  for (const row of ROW_ORDER) {
    let best: { id: string; len: number } | null = null;
    for (const o of ROWS[row].options) {
      for (const cue of o.cues ?? []) {
        const c = ` ${cue.replace(/[^a-z0-9]+/g, ' ')} `;
        if (!said.includes(c)) continue;
        if (!best || cue.length > best.len) best = { id: o.id, len: cue.length };
      }
    }
    if (best) out[row] = best.id;
  }
  return out;
}
