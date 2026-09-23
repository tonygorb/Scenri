/**
 * What a sentence about a place already decides.
 *
 * A person who types "white cyclorama, hard flash, top-down product
 * photography" has said the place, the light and the camera; asking them any
 * of it again is the survey this studio is not. A person who types "luxury
 * product photography in warm stone" has said the world and what it is made
 * of, and nothing about its light or what would make it unforgettable: those
 * are the questions worth a tap.
 *
 * The creative decisions, each known or not, read off whole words. Deliberately
 * stricter than the rows' own cues, which are tuned for a two-word phrase
 * ("golden hour", "overhead"): in a sentence, "warm stone" is a material and
 * not a light, and "soft linen" is a fabric and not a daylight.
 *
 * No model, no planner. The reader (the analyzer) still turns the whole
 * sentence into the scene; this only decides which questions are still open.
 */
export type Dimension = 'world' | 'surface' | 'light' | 'signature' | 'stage' | 'camera';
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
];

/** What a world is made of. Naming one says the world too: "warm stone" is somewhere. */
const SURFACE = [
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
  'clay',
  'terracotta',
  'ice',
  'aluminium',
  'aluminum',
  'stainless',
  'leather',
  'felt',
  'slate',
  'onyx',
  'salt',
];

/**
 * The one thing that makes a place unforgettable: something moving, something
 * changing, something growing, water and reflection, a graphic device, an
 * impossible scale. Every curated scene has one; a sentence without one is
 * asked for it.
 */
const SIGNATURE = [
  'splash',
  'splashing',
  'mid air',
  'frozen',
  'falling',
  'petals',
  'confetti',
  'smoke',
  'mist',
  'fog',
  'steam',
  'dust',
  'drifting',
  'bubbles',
  'melting',
  'molten',
  'dripping',
  'wax',
  'resin',
  'pouring',
  'overgrown',
  'blooms',
  'flowers',
  'vines',
  'reflection',
  'reflections',
  'reflecting',
  'rain',
  'puddle',
  'ripples',
  'surreal',
  'giant',
  'oversized',
  'levitating',
  'impossible',
  'dreamlike',
  'cut shadow',
  'gobo',
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

const LEXICON: Record<Dimension, string[]> = {
  world: [...WORLD, ...SURFACE],
  surface: SURFACE,
  light: LIGHT,
  signature: SIGNATURE,
  stage: STAGE,
  camera: CAMERA,
};

/** Lowercase, hyphens and punctuation as spaces, padded, so every match is a whole word. */
const said = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9é]+/g, ' ')
    .trim()} `;
const has = (s: string, phrase: string) => s.includes(` ${phrase.replace(/[^a-z0-9é]+/g, ' ')} `);

export function intentOf(text: string): Intent {
  const s = said(text);
  const any = (words: string[]) => words.some((w) => has(s, w));
  return {
    world: any(LEXICON.world),
    surface: any(SURFACE),
    light: any(LIGHT),
    signature: any(SIGNATURE),
    stage: any(STAGE),
    camera: any(CAMERA),
  };
}

/** The dimensions a sentence decides, for a test or the transcript to name. */
export const known = (i: Intent): Dimension[] => (Object.keys(LEXICON) as Dimension[]).filter((d) => i[d]);

/**
 * The questions still worth asking after a sentence, in the order they are asked.
 *
 * World first, because a scene has to be somewhere; then what it is made of up
 * close and how its light behaves, two at most of those; and always the one
 * thing that makes it unforgettable when the sentence gave none, because that
 * is what separates a scene from a place. A sentence that already decides
 * three things is asked only the world, if it left that out, and the
 * signature. Never how the subject sits or where the camera is: those belong
 * to the shot, and a sentence that says them keeps them.
 */
export function followUps(i: Intent): ('world' | 'surface' | 'light' | 'signature')[] {
  const open = (['world', 'surface', 'light'] as const).filter((d) => !i[d]);
  const asked = known(i).length >= 3 ? open.filter((d) => d === 'world') : open.slice(0, 2);
  return i.signature ? asked : [...asked, 'signature'];
}
