/**
 * What a sentence about a place already decides.
 *
 * A person who types "white cyclorama, hard flash, top-down product
 * photography" has said the place, the light and the camera; asking them any
 * of it again is the survey this studio is not. A person who types "luxury
 * product photography in warm stone" has said the world and nothing about how
 * it is lit or how the subject lives in it, and those are the two questions
 * worth one tap each.
 *
 * Four creative decisions, each known or not, read off whole words. Deliberately
 * stricter than the rows' own cues, which are tuned for a two-word phrase
 * ("golden hour", "overhead"): in a sentence, "warm stone" is a material and
 * not a light, and "soft linen" is a fabric and not a daylight.
 *
 * No model, no planner. The reader (the analyzer) still turns the whole
 * sentence into the scene; this only decides which questions are still open.
 */
export type Dimension = 'world' | 'light' | 'stage' | 'camera';
export type Intent = Record<Dimension, boolean>;

const WORLD = [
  // places
  'studio',
  'cyclorama',
  'cyc',
  'seamless',
  'sweep',
  'backdrop',
  'set',
  'room',
  'interior',
  'exterior',
  'beach',
  'shore',
  'shoreline',
  'coast',
  'sea',
  'ocean',
  'lake',
  'river',
  'water',
  'pool',
  'forest',
  'woods',
  'woodland',
  'jungle',
  'garden',
  'park',
  'field',
  'meadow',
  'desert',
  'dune',
  'dunes',
  'mountain',
  'mountains',
  'cliff',
  'cave',
  'canyon',
  'street',
  'city',
  'urban',
  'rooftop',
  'loft',
  'warehouse',
  'gallery',
  'museum',
  'hotel',
  'lobby',
  'kitchen',
  'bathroom',
  'bedroom',
  'living room',
  'cafe',
  'café',
  'bar',
  'restaurant',
  'shop',
  'store',
  'boutique',
  'market',
  'library',
  'courtyard',
  'terrace',
  'balcony',
  'corridor',
  'hallway',
  'tunnel',
  'bridge',
  'station',
  'greenhouse',
  'spa',
  'chapel',
  'ruin',
  'ruins',
  'architecture',
  'landscape',
  'outdoors',
  'indoors',
  'sky',
  // what a world is made of
  'stone',
  'rock',
  'rocks',
  'marble',
  'travertine',
  'limestone',
  'granite',
  'basalt',
  'concrete',
  'plaster',
  'terrazzo',
  'tile',
  'tiles',
  'wood',
  'wooden',
  'oak',
  'walnut',
  'linen',
  'fabric',
  'velvet',
  'silk',
  'satin',
  'glass',
  'metal',
  'steel',
  'chrome',
  'brass',
  'mirror',
  'sand',
  'moss',
  'ferns',
  'foliage',
  'flowers',
  'paper',
  'colour field',
  'color field',
  'colour block',
  'color block',
  'pastel',
  'brutalist',
  'minimal',
  'wall',
  'walls',
];

const LIGHT = [
  'light',
  'lit',
  'lighting',
  'flash',
  'strobe',
  'strobes',
  'sun',
  'sunny',
  'sunlight',
  'sunlit',
  'sunshine',
  'daylight',
  'golden hour',
  'sunset',
  'sunrise',
  'dusk',
  'dawn',
  'twilight',
  'blue hour',
  'night',
  'neon',
  'moonlight',
  'moonlit',
  'candle',
  'candlelight',
  'candlelit',
  'lamp',
  'lamplight',
  'spotlight',
  'spotlit',
  'softbox',
  'overcast',
  'shadow',
  'shadows',
  'shadowless',
  'backlit',
  'backlight',
  'rim light',
  'glow',
  'glowing',
  'noon',
  'midday',
  'low key',
  'high key',
  'chiaroscuro',
  'hard sun',
  'window light',
];

const STAGE = [
  'plinth',
  'pedestal',
  'podium',
  'platform',
  'block',
  'cube',
  'table',
  'tabletop',
  'counter',
  'countertop',
  'shelf',
  'ledge',
  'tray',
  'on the floor',
  'on the ground',
  'in hand',
  'in hands',
  'hand',
  'hands',
  'held',
  'holding',
  'resting',
  'rests',
  'floating',
  'floats',
  'suspended',
  'hanging',
  'leaning',
  'propped',
  'nestled',
  'nested',
  'half buried',
  'emerging',
  'balanced',
  'stacked',
  'scattered',
];

const CAMERA = [
  'top down',
  'overhead',
  'flat lay',
  'flatlay',
  'birds eye',
  'bird s eye',
  'aerial',
  'from above',
  'from below',
  'low angle',
  'high angle',
  'eye level',
  'worms eye',
  'close up',
  'closeup',
  'macro',
  'wide angle',
  'wide shot',
  'wide',
  'telephoto',
  '35mm',
  '50mm',
  '85mm',
  'lens',
  'shot from',
  'framed',
  'framing',
  'straight on',
  'profile',
];

const LEXICON: Record<Dimension, string[]> = { world: WORLD, light: LIGHT, stage: STAGE, camera: CAMERA };

/** Lowercase, hyphens and punctuation as spaces, padded, so every match is a whole word. */
const said = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9é]+/g, ' ')
    .trim()} `;
const has = (s: string, phrase: string) => s.includes(` ${phrase.replace(/[^a-z0-9é]+/g, ' ')} `);

export function intentOf(text: string): Intent {
  const s = said(text);
  return {
    world: WORLD.some((w) => has(s, w)),
    light: LIGHT.some((w) => has(s, w)),
    stage: STAGE.some((w) => has(s, w)),
    camera: CAMERA.some((w) => has(s, w)),
  };
}

/** The dimensions a sentence decides, for a test or the transcript to name. */
export const known = (i: Intent): Dimension[] => (Object.keys(LEXICON) as Dimension[]).filter((d) => i[d]);

/**
 * The questions still worth asking after a sentence, in the order they are asked.
 *
 * World first, because a scene has to be somewhere; then how it is lit; then
 * how the subject lives in it. Never the camera: that belongs to the shot (and
 * to the scene's ways of shooting it), and a sentence that says it keeps it.
 * At most two, because two taps is a follow-up and three is a form. None at all
 * once three of the four decisions are made, unless the one missing is the
 * world itself.
 */
export function followUps(i: Intent): ('world' | 'light' | 'stage')[] {
  if (known(i).length >= 3) return i.world ? [] : ['world'];
  return (['world', 'light', 'stage'] as const).filter((d) => !i[d]).slice(0, 2);
}
