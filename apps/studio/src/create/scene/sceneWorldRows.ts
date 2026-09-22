/**
 * What each world is asked after it is chosen.
 *
 * The questions after the world belong to the world: a colour-field sweep is
 * made of lacquer or paper, not wet sand, and a shoreline's light is caustics
 * or low sun on the water, not a neon tube. So every world carries its own
 * four surfaces, four things its light can do and four ideas that could make
 * it unforgettable, each one a picture of that same world with that one thing
 * changed, the same plain bottle standing in it for scale.
 *
 * The general rows in sceneRows.ts are what a typed sentence is asked when no
 * world was tapped. Passing a row here keeps what the world already has: its
 * surface, its own light, and for the signature, an idea the reading invents
 * for the place.
 */

/**
 * Said with every signature. Measured 2026-09-22: "caught mid-change" came
 * back as a melting candle standing on the set, a second object that would
 * upstage any product and whose reflection was wrong, and roots grew across
 * the very ledge a product would stand on. The idea belongs to the place.
 */
export const IN_THE_PLACE =
  'part of the place itself, never a separate object that competes with the subject, and leaving the subject a clear place to stand';

/**
 * Said once, by `compileDirection`, at the end of a direction that carries an
 * idea. It used to be written into all 39 idea options, which put it between
 * the idea and anything the person typed after it: "one oversized stone
 * sphere, part of the place itself, ... a clear place to stand, in a deep
 * teal" reads as a teal place to stand. Their words belong beside their idea,
 * and the guard belongs last.
 */

export type WorldRow = 'surface' | 'light' | 'signature';

export interface WorldOption {
  id: string;
  label: string;
  /** What choosing it tells the reader. */
  words: string;
  card: string;
}

interface Choice {
  key: string;
  label: string;
  words: string;
}

type Table = Record<WorldRow, readonly Choice[]>;

const WORLDS: Record<string, Table> = {
  water: {
    surface: [
      {
        key: 'basalt',
        label: 'Wet basalt',
        words: 'a ledge of wet black basalt, glossy where the sea has just left it',
      },
      { key: 'sand', label: 'White sand', words: 'rippled white sand under a few centimetres of clear water' },
      { key: 'pebbles', label: 'Sea pebbles', words: 'a bed of smooth sea-worn pebbles, wet and gleaming' },
      {
        key: 'awash',
        label: 'Rock awash',
        words: 'a flat rock just awash, a thin sheet of clear water sliding over it',
      },
    ],
    light: [
      { key: 'caustics', label: 'Water caustics', words: 'a live net of water caustics sliding across every surface' },
      { key: 'sunset', label: 'Low sun on water', words: 'low sun skimming the water, long glittering reflections' },
      { key: 'silver', label: 'Silver overcast', words: 'soft silver overcast light, the sea flat and pale' },
      { key: 'backlit', label: 'Backlit spray', words: 'the sun behind the surf, the spray lit up like glass' },
    ],
    signature: [
      {
        key: 'wave',
        label: 'Frozen wave',
        words: 'a wave frozen mid-break behind the rock, its crest in glassy detail',
      },
      { key: 'foam', label: 'Foam lace', words: 'a lace of sea foam drawn across the wet rock' },
      { key: 'kelp', label: 'Kelp ribbons', words: 'glossy olive-gold ribbons of kelp draped over the rocks' },
      { key: 'pool', label: 'Mirror pool', words: 'a still rock pool mirroring the sky' },
    ],
  },
  stone: {
    surface: [
      {
        key: 'travertine',
        label: 'Travertine',
        words: 'honed cream travertine up close, its pores and soft veins readable',
      },
      {
        key: 'limestone',
        label: 'Rough limestone',
        words: 'a rough-cut block of warm limestone, chisel marks in its face',
      },
      { key: 'terracotta', label: 'Terracotta tile', words: 'sun-baked terracotta floor tiles, worn at the edges' },
      {
        key: 'marble',
        label: 'Weathered marble',
        words: 'weathered pale marble, its polish worn soft by years of sun',
      },
    ],
    light: [
      {
        key: 'shadow',
        label: 'One long shadow',
        words: 'one high hard light throwing a single long, precise shadow across the stone',
      },
      { key: 'olive', label: 'Olive-leaf dapple', words: 'sun broken into moving dapples through olive leaves' },
      {
        key: 'golden',
        label: 'Low golden sun',
        words: 'low golden sun raking almost flat across the stone, long warm shadows',
      },
      {
        key: 'shade',
        label: 'Cool shade',
        words: 'the niche in open shade, cool bounced light and a bright sunlit world beyond',
      },
    ],
    signature: [
      { key: 'vines', label: 'Vines taking over', words: 'a vine growing down the stone, claiming its edges' },
      {
        key: 'basin',
        label: 'Water in the stone',
        words: 'water trickling into a basin carved in the stone, glinting',
      },
      { key: 'dust', label: 'Dust in the sun', words: 'fine dust hanging in one bright shaft of sun' },
      {
        key: 'sphere',
        label: 'A giant stone sphere',
        words: 'one oversized stone sphere resting in the space, impossible in scale',
      },
    ],
  },
  colour: {
    surface: [
      {
        key: 'lacquer',
        label: 'Glossy lacquer',
        words: 'a glossy lacquered floor the same colour as the sweep, mirroring it',
      },
      { key: 'paper', label: 'Matte paper', words: 'matte coloured paper, its fibres and one soft crease readable' },
      {
        key: 'acrylic',
        label: 'Frosted acrylic',
        words: 'a sheet of frosted acrylic glowing softly with the colour behind it',
      },
      { key: 'velvet', label: 'Flocked velvet', words: 'flocked velvet in the same colour, soaking up the light' },
    ],
    light: [
      { key: 'gobo', label: 'Cut spotlight', words: 'a hard spotlight cut into one graphic shape across the colour' },
      {
        key: 'split',
        label: 'Two-colour gels',
        words: 'two coloured gels splitting the light, one warm and one cool edge',
      },
      {
        key: 'wrap',
        label: 'Soft studio wrap',
        words: 'soft wrapping studio light, a gentle gradient across the sweep',
      },
      { key: 'rim', label: 'Neon rim', words: 'one neon rim tracing the edges, the rest of the colour dimmed' },
    ],
    signature: [
      {
        key: 'shapes',
        label: 'Floating shapes',
        words: 'a few simple geometric shapes floating in the colour, frozen in place',
      },
      {
        key: 'planes',
        label: 'Cut-paper planes',
        words: 'sharp-angled planes of cut paper converging in the colour',
      },
      { key: 'block', label: 'Colour-block shadow', words: 'a hard shadow cut into a block of a second colour' },
      {
        key: 'giant',
        label: 'Surreal scale',
        words: 'one oversized sphere or arch in the colour, impossible in scale',
      },
    ],
  },
  citrus: {
    surface: [
      { key: 'halves', label: 'Cut citrus', words: 'a bed of halved citrus, the flesh glistening with juice' },
      { key: 'tile', label: 'Glazed tile', words: 'sun-bleached glazed tiles in white and cobalt' },
      { key: 'ice', label: 'Crushed ice', words: 'crushed ice melting over the fruit' },
      { key: 'cloth', label: 'Crisp linen', words: 'a crisp white linen cloth spread under the fruit' },
    ],
    light: [
      {
        key: 'glow',
        label: 'Sun through fruit',
        words: 'the sun behind the fruit, the flesh glowing like stained glass',
      },
      { key: 'leaves', label: 'Leaf shade', words: 'sun broken into dapples through citrus leaves' },
      { key: 'golden', label: 'Late golden sun', words: 'late golden sun, the sky deepening, long warm shadows' },
      { key: 'flash', label: 'Hard flash', words: 'hard direct flash against the blue sky, crisp and saturated' },
    ],
    signature: [
      {
        key: 'blossom',
        label: 'Blossom and leaves',
        words: 'citrus blossom and glossy leaves threaded through the fruit',
      },
      { key: 'melting', label: 'Ice melting', words: 'ice melting over the fruit, beads of water running down' },
      { key: 'peel', label: 'Peel spirals', words: 'long spirals of peel curling across the mound' },
      {
        key: 'giant',
        label: 'Giant fruit',
        words: 'one citrus fruit at an impossible, monumental scale on the horizon',
      },
    ],
  },
  volcanic: {
    surface: [
      { key: 'crust', label: 'Lava crust', words: 'a crust of cooled black lava, ropey and cracked' },
      { key: 'sand', label: 'Black sand', words: 'fine black volcanic sand, wind-rippled' },
      { key: 'pumice', label: 'Pumice', words: 'porous grey pumice, sharp and light' },
      { key: 'obsidian', label: 'Obsidian', words: 'a slab of glassy black obsidian with conchoidal edges' },
    ],
    light: [
      { key: 'fissures', label: 'Glow from below', words: 'incandescent orange fissures lighting the rock from below' },
      { key: 'raking', label: 'Sun through haze', words: 'a hard low sun raking through the orange haze' },
      { key: 'ember', label: 'Ember glow', words: 'a deep ember glow, everything else falling into dark' },
      { key: 'moon', label: 'Blue moonlight', words: 'cold blue moonlight on the black rock, the haze gone silver' },
    ],
    signature: [
      {
        key: 'lava',
        label: 'Lava still moving',
        words: 'lava still glowing in the cracks of the crust, cooling as it goes',
      },
      { key: 'ash', label: 'Ash in the air', words: 'fine ash drifting through the haze' },
      { key: 'steam', label: 'Steam vents', words: 'white steam rising from vents in the rock' },
      {
        key: 'floating',
        label: 'Floating rocks',
        words: 'a few rocks hanging weightless in the haze, impossible and still',
      },
    ],
  },
  dark: {
    surface: [
      { key: 'mirror', label: 'Black mirror', words: 'black mirror glass, every reflection crisp' },
      { key: 'steel', label: 'Brushed steel', words: 'brushed stainless steel with a fine directional grain' },
      { key: 'marble', label: 'Black marble', words: 'polished black marble with thin white veins' },
      { key: 'water', label: 'Black water', words: 'still black water, one faint ripple' },
    ],
    light: [
      { key: 'gobo', label: 'Cut spotlight', words: 'a hard spotlight cut into one graphic shape across the dark' },
      { key: 'pool', label: 'Pool of light', words: 'one pool of light from above, the rest falling to true black' },
      { key: 'neon', label: 'Neon edge', words: 'one line of coloured neon reflected in the black surface' },
      { key: 'rim', label: 'Thin rim', words: 'a thin bright rim of light along every edge, nothing else lit' },
    ],
    signature: [
      {
        key: 'wax',
        label: 'Wax cascading',
        words: 'dark wax cascading down a wall into the mirror, glossy and still setting',
      },
      { key: 'ripples', label: 'Ripples', words: 'slow concentric ripples crossing the black surface' },
      { key: 'smoke', label: 'Smoke curl', words: 'one curl of smoke drifting through the light' },
      {
        key: 'sphere',
        label: 'Floating sphere',
        words: 'a perfect sphere floating above the mirror, impossible and still',
      },
    ],
  },
  plaster: {
    surface: [
      { key: 'limewash', label: 'Limewash floor', words: 'a limewashed plaster floor, soft and chalky' },
      { key: 'oak', label: 'Pale oak', words: 'pale oak boards, their grain soft in the light' },
      { key: 'terrazzo', label: 'Terrazzo', words: 'pale terrazzo with small flecks of stone' },
      { key: 'silk', label: 'Silk drape', words: 'a length of silk pooling on the floor in soft folds' },
    ],
    light: [
      {
        key: 'shadow',
        label: 'Window shadow',
        words: 'hard sun through the tall window, its shape laid long across the room',
      },
      { key: 'leaves', label: 'Leaf shadows', words: 'soft moving leaf shadows thrown across the plaster' },
      { key: 'golden', label: 'Low golden sun', words: 'low golden sun raking across the plaster, long warm shadows' },
      { key: 'dusk', label: 'Blue dusk', words: 'cool blue dusk in the window, the room dim and quiet' },
    ],
    signature: [
      { key: 'curtain', label: 'Curtain in the wind', words: 'a sheer curtain lifted into the room by the wind' },
      {
        key: 'plants',
        label: 'Plants growing in',
        words: 'green plants growing up the plaster walls, claiming the corners',
      },
      { key: 'arch', label: 'Arch shadow', words: 'the hard shadow of an arch cut across the wall' },
      { key: 'stair', label: 'Surreal stair', words: 'a plaster stair rising into the wall and going nowhere' },
    ],
  },
  linen: {
    surface: [
      { key: 'linen', label: 'Raw linen', words: 'raw undyed linen, its slub weave readable' },
      { key: 'satin', label: 'Silk satin', words: 'heavy silk satin in deep folds, its sheen catching the light' },
      { key: 'boucle', label: 'Wool bouclé', words: 'nubbly wool bouclé, soft and textured' },
      { key: 'paper', label: 'Crumpled paper', words: 'large sheets of crumpled paper folded like cloth' },
    ],
    light: [
      { key: 'leaves', label: 'Leaf dapple', words: 'sun broken into soft dapples through leaves' },
      { key: 'slice', label: 'Slice of sun', words: 'one hard slice of sun across the folds' },
      { key: 'golden', label: 'Low golden sun', words: 'low golden sun raking across the folds, deep warm shadows' },
      { key: 'through', label: 'Light through cloth', words: 'light glowing through the cloth from behind' },
    ],
    signature: [
      { key: 'wind', label: 'Lifted by wind', words: 'the cloth lifted by a gust and frozen mid-billow' },
      { key: 'dried', label: 'Dried flowers', words: 'a few dried flowers and grasses caught in the folds' },
      { key: 'thread', label: 'One red thread', words: 'a single red thread running through the folds' },
      { key: 'landscape', label: 'Folds as dunes', words: 'the folds made vast, like a landscape of dunes' },
    ],
  },
};

/** The world's own rows, or none for a world this table does not know. */
export function worldOptions(world: string | undefined, row: WorldRow): WorldOption[] | null {
  const table = world ? WORLDS[world] : undefined;
  if (!table) return null;
  return table[row].map((c, i) => ({
    id: `${world}-${c.key}`,
    label: c.label,
    words: c.words,
    card: `scene-${world}-${row}-${i + 1}`,
  }));
}

/** Every world-scoped option of a row, for reading an answer back without knowing its world. */
export function allWorldOptions(row: WorldRow): WorldOption[] {
  return Object.keys(WORLDS).flatMap((w) => worldOptions(w, row) ?? []);
}

/** The worlds this table covers. */
export const WORLD_IDS: readonly string[] = Object.keys(WORLDS);

/**
 * The worlds whose twelve cards are drawn, each with its `data-card` rules in
 * conversation.css. A world joins this list only when all twelve exist; until
 * then its rows are asked as chips.
 */
export const DRAWN_WORLDS: readonly string[] = [];
