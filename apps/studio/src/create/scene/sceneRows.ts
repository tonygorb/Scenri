import type { SwatchRow } from '../../conversation/question.js';

/**
 * The two things a place is asked, in the order they are asked.
 *
 * It was five: the kind of place, its light, the feeling, what it is made of,
 * and whether anyone stands in it. Five rows of attributes is a taxonomy, and
 * a card that says "Warm" or "Wood" makes the decision harder rather than
 * easier: nobody pictures a shot from an adjective. So the rows are a whole
 * world, which is a result, and then where the camera stands, which is the one
 * thing nothing else in the app asks at creation time and the thing that
 * decides whether every shot from a scene looks the same.
 *
 * Light, material and mood have not gone: they are inside each world's words,
 * where they were always going to end up in the sentence the reader is handed.
 * Anything a world does not cover is said in the line, which is open the whole
 * time.
 *
 * Each option carries the words it hands the reader (`words`), the card id for
 * its drawn picture (`card`), and the words a person might type instead of
 * tapping it (`cues`), so a sentence at the first question answers the rows it
 * covers and only the rest are asked.
 */
export type SceneRow = 'world' | 'light' | 'shot';

export const ROW_ORDER: readonly SceneRow[] = ['world', 'light', 'shot'];

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
        cues: ['stone', 'limestone', 'plaster', 'wall', 'niche', 'arch', 'terracotta', 'mediterranean', 'sunlit'],
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
    ],
  },
  shot: {
    prompt: 'And where is the camera?',
    options: [
      {
        id: 'eye',
        label: 'Eye level',
        words: 'seen at eye level, straight on, at a normal distance',
        card: card('shot', 1),
        cues: ['eye level', 'straight on', 'front on', 'head on', 'normal'],
      },
      {
        id: 'top',
        label: 'Top down',
        words: 'seen from directly overhead, looking straight down',
        card: card('shot', 2),
        cues: ['top down', 'overhead', 'above', 'birds eye', 'flat lay', 'flatlay', 'down on'],
      },
      {
        id: 'ground',
        label: 'Ground level',
        words: 'seen from ground level, the camera low and the subject towering over it',
        card: card('shot', 3),
        cues: ['ground level', 'low angle', 'from below', 'looking up', 'worms eye'],
      },
      {
        id: 'wide',
        label: 'Wide',
        words: 'seen wide, the subject small in the frame and the place around it doing the talking',
        card: card('shot', 4),
        cues: ['wide', 'far', 'distant', 'establishing', 'room to breathe', 'negative space'],
      },
      {
        id: 'close',
        label: 'Close',
        words: 'seen very close, the subject filling the frame',
        card: card('shot', 5),
        cues: ['close', 'closeup', 'close-up', 'close up', 'macro', 'detail', 'tight'],
      },
    ],
  },
};

/**
 * The rows whose pictures are drawn.
 *
 * Both of them, and they are drawn the way the selection-art skill says: one
 * neutral unbranded bottle in every card, so six worlds are comparable to each
 * other rather than six pretty pictures, and five cameras around one unchanged
 * world so the only thing that differs is where the camera stands.
 */
export const DRAWN: ReadonlySet<SceneRow> = new Set<SceneRow>(['world', 'light', 'shot']);

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
export const rowNoun = (row: SceneRow): string => (row === 'world' ? 'place' : row === 'light' ? 'light' : 'camera');

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
