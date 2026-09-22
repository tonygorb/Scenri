import type { SwatchRow } from '../../conversation/question.js';
import { allWorldOptions, DRAWN_WORLDS, IN_THE_PLACE, worldOptions } from './sceneWorldRows.js';

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
export type SceneRow = 'world' | 'surface' | 'light' | 'signature';

export const ROW_ORDER: readonly SceneRow[] = ['world', 'surface', 'light', 'signature'];

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
  surface: {
    prompt: 'What is it made of, up close?',
    options: [
      {
        id: 'travertine',
        label: 'Travertine',
        words: 'honed cream travertine up close, its pores and soft veins readable',
        cues: ['travertine'],
      },
      {
        id: 'steel',
        label: 'Brushed steel',
        words: 'brushed stainless steel with a fine directional grain',
        cues: ['steel', 'stainless', 'brushed metal', 'aluminium', 'aluminum'],
      },
      {
        id: 'clay',
        label: 'Cracked clay',
        words: 'sun-dried terracotta clay cracked into deep fissures',
        cues: ['clay', 'terracotta', 'cracked earth'],
      },
      {
        id: 'silk',
        label: 'Silk folds',
        words: 'heavy silk gathered into deep sculptural folds',
        cues: ['silk', 'satin'],
      },
      {
        id: 'sand',
        label: 'Wet sand',
        words: 'rippled wet sand, glossy where the water has just drawn back',
        cues: ['sand', 'wet sand'],
      },
      {
        id: 'moss',
        label: 'Moss and roots',
        words: 'damp moss over exposed roots, dense and living',
        cues: ['moss', 'mossy', 'roots'],
      },
      {
        id: 'ice',
        label: 'Ice',
        words: 'clear ice with trapped bubbles and a cold blue depth',
        cues: ['ice', 'icy', 'glacial'],
      },
      {
        id: 'concrete',
        label: 'Raw concrete',
        words: 'raw board-formed concrete with timber grain printed into it',
        cues: ['board-formed', 'cement'],
      },
    ],
  },
  light: {
    prompt: 'What does the light do?',
    options: [
      {
        id: 'shadow',
        label: 'One long shadow',
        words: 'one high hard light throwing a single long, precise shadow across the place',
        cues: ['long shadow', 'skylight', 'shaft of light', 'single shadow'],
      },
      {
        id: 'dapple',
        label: 'Dappled leaves',
        words: 'sun broken into soft moving dapples through leaves',
        cues: ['dappled', 'dapple', 'through leaves', 'leaf shadows', 'canopy'],
      },
      {
        id: 'caustics',
        label: 'Water caustics',
        words: 'a live net of water caustics sliding across every surface',
        cues: ['caustics', 'caustic', 'rippling light', 'underwater light'],
      },
      {
        id: 'gobo',
        label: 'Cut spotlight',
        words: 'a hard spotlight cut into one graphic shape across the set',
        cues: ['gobo', 'spotlight', 'cut light', 'shaped light'],
      },
      {
        id: 'window',
        label: 'Soft window',
        words: 'soft daylight from one large window, falling open and shadowless on the far side',
        card: card('light', 7),
        cues: [
          'window light',
          'side light',
          'from a window',
          'sidelit',
          'window',
          'soft',
          'daylight',
          'overcast',
          'diffused',
        ],
      },
      {
        id: 'golden',
        label: 'Low golden sun',
        words: 'low golden sun raking almost flat across it, long warm shadows',
        card: card('light', 2),
        cues: ['golden', 'golden hour', 'sunset', 'sunrise', 'dusk', 'warm'],
      },
      {
        id: 'neon',
        label: 'Neon glow',
        words: 'coloured neon streaking its light across glossy surfaces at night',
        card: card('light', 4),
        cues: ['neon', 'night', 'nocturnal', 'after dark'],
      },
      {
        id: 'lowkey',
        label: 'Pool of light',
        words: 'one pool of light with a bright edge, the rest falling to true black',
        card: card('light', 6),
        cues: ['low key', 'lowkey', 'dramatic', 'shadowy', 'chiaroscuro', 'rim light'],
      },
    ],
  },
  signature: {
    prompt: 'What makes it unforgettable?',
    options: [
      {
        /*
         * Measured 2026-09-22: "something in motion" drew a burst of powder in
         * mid-air right where a product stands, with no cause, and read as
         * pasted in. An event is a shot's (the curated Action Freeze and Citrus
         * Burst are the product itself mid-motion); what a place can hold is
         * its air being alive.
         */
        id: 'air',
        label: 'Mist, snow or wind',
        words: `the air of the place alive, such as mist lying low, snow drifting down or wind moving through fabric or grass: one, chosen for this place, ${IN_THE_PLACE}`,
        cues: ['mist', 'misty', 'fog', 'foggy', 'snow', 'snowing', 'wind', 'windswept', 'haze'],
      },
      {
        id: 'change',
        label: 'Caught mid-change',
        words: `the place's own material caught mid-change, such as wax cascading down a wall, sugar pulled glassy across the surface or ice melting at its edge: one, chosen for this place, ${IN_THE_PLACE}`,
        cues: ['melting', 'molten', 'dripping', 'wax', 'resin', 'mid-change'],
      },
      {
        id: 'graphic',
        label: 'Graphic light and shadow',
        words: `one bold graphic device of light and shadow shaping the set, such as a cut shadow or a hard slice of colour, ${IN_THE_PLACE}`,
        cues: ['graphic', 'geometric', 'cut shadow', 'colour block', 'color block'],
      },
      {
        id: 'nature',
        label: 'Nature taking over',
        words: `nature growing through the set, such as moss, blooms or roots claiming its edges: one, chosen for this place, ${IN_THE_PLACE}`,
        cues: ['overgrown', 'blooms', 'flowers', 'vines', 'growing'],
      },
      {
        id: 'water',
        label: 'Glass and water',
        words: `water and reflection in the place, such as a still reflecting pool or rain-beaded glass: one, chosen for this place, ${IN_THE_PLACE}`,
        cues: ['reflection', 'reflecting', 'rain', 'puddle', 'rain glass'],
      },
      {
        id: 'scale',
        label: 'Surreal scale',
        words: `one surreal touch of scale, an oversized natural or architectural form that makes the place feel impossible, ${IN_THE_PLACE}`,
        cues: ['surreal', 'giant', 'oversized', 'impossible', 'dreamlike'],
      },
    ],
  },
};

/**
 * The cards that are drawn: a world row's eight, the four light cards kept
 * from the first set, and each world's own once its pictures exist
 * (sceneWorldRows.ts). A row shows pictures only when every option it offers
 * has one: a row of pictures with blanks in it reads as broken, and a row of
 * words reads as a choice.
 */
export const ART: ReadonlySet<string> = new Set<string>([
  ...ROWS.world.options.map((o) => o.card as string),
  ...ROWS.light.options.filter((o) => o.card).map((o) => o.card as string),
  ...DRAWN_WORLDS.flatMap((w) =>
    (['surface', 'light', 'signature'] as const).flatMap((r) => (worldOptions(w, r) ?? []).map((o) => o.card)),
  ),
]);

/**
 * What a row offers now. The world is asked from the eight; every row after
 * it offers what belongs to the world that was tapped, and the general list
 * only when no world was (a typed sentence, a world passed or written).
 */
export function optionsFor(row: SceneRow, world: string | undefined): RowOption[] {
  if (row === 'world') return ROWS.world.options;
  return worldOptions(world, row) ?? ROWS[row].options;
}

/** A row as the conversation's swatch block takes it, for the world that was tapped. */
export function swatchRow(row: SceneRow, world?: string): SwatchRow {
  const options = optionsFor(row, world);
  const pictured = options.every((o) => !!o.card && ART.has(o.card));
  return {
    id: row,
    label: ROWS[row].prompt,
    options: options.map((o) => ({ id: o.id, label: o.label, ...(pictured ? { card: o.card } : {}) })),
  };
}

/** What a row is about, for the line that invites words instead of a tap. */
/** What the line calls a row's answer: "describe the surface in your own words". */
const NOUN: Record<SceneRow, string> = { world: 'place', surface: 'surface', light: 'light', signature: 'idea' };
export const rowNoun = (row: SceneRow): string => NOUN[row];

/** An option by its id, wherever it was offered: the general row or a world's own. */
export const optionOf = (row: SceneRow, id: string | undefined): RowOption | undefined => {
  if (!id) return undefined;
  const general = ROWS[row].options.find((o) => o.id === id);
  if (general || row === 'world') return general;
  return allWorldOptions(row).find((o) => o.id === id);
};

/** The idea the reading invents when the signature is passed: every scene gets one. */
export const SUGGESTED_IDEA = `one signature idea that makes this place unforgettable, invented for it and never generic, ${IN_THE_PLACE}`;

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
