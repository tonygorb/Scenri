/**
 * Deterministic prose for prompts, names and briefs.
 *
 * Prompts land near 3.3 KB (the real library's mean) from sentence templates
 * over a fixed word bank, so the UI bench's search words ("terracotta",
 * "linen", "north light") hit a known fraction of shots on every seed.
 */
const MATERIALS = [
  'terracotta',
  'washed linen',
  'brushed steel',
  'waxed oak',
  'travertine',
  'matte ceramic',
  'raw concrete',
  'smoked glass',
  'boucle wool',
  'sanded plaster',
  'hammered brass',
  'crème canvas',
  'blackened walnut',
  'frosted acrylic',
  'woven rattan',
];
const LIGHT = [
  'north light',
  'raking golden-hour sun',
  'a single hard flash',
  'diffused overcast daylight',
  'warm tungsten lamplight',
  'cool window light',
  'a soft top light',
  'low winter sun',
  'a bounced strobe',
  'candle glow',
];
const CAMERA = [
  'a 50mm lens at eye level',
  'a 35mm lens from slightly above',
  'an 85mm portrait lens',
  'a low wide angle',
  'a tight macro',
  'a long telephoto compression',
  'a tripod-locked frontal view',
  'a handheld three-quarter view',
];
const MOOD = [
  'quiet and editorial',
  'bright and commercial',
  'moody and cinematic',
  'clean and clinical',
  'warm and domestic',
  'sharp and graphic',
  'soft and intimate',
  'bold and saturated',
];
const OBJECTS = [
  'a low wool rug',
  'a stack of books',
  'a folded towel',
  'a glass carafe',
  'a bowl of citrus',
  'a linen curtain',
  'a stone pedestal',
  'a mirror in a timber frame',
  'a potted olive tree',
  'a trailing cable',
  'a brass tray',
  'a paper lantern',
];
const VERBS = ['rests', 'stands', 'leans', 'sits', 'hovers', 'floats', 'is placed', 'is arranged'];

const SENTENCES = [
  (r) => `${cap(r.pick(MATERIALS))} frames the foreground while ${r.pick(LIGHT)} spreads across the surface.`,
  (r) => `The subject ${r.pick(VERBS)} beside ${r.pick(OBJECTS)} on ${r.pick(MATERIALS)}, shot with ${r.pick(CAMERA)}.`,
  (r) => `The background layers ${r.pick(OBJECTS)}, ${r.pick(OBJECTS)} and ${r.pick(OBJECTS)} under ${r.pick(LIGHT)}.`,
  (r) => `The mood is ${r.pick(MOOD)}; shadows stay ${r.pick(['soft', 'crisp', 'long', 'faint'])} and tones stay true.`,
  (r) => `Every surface reads as ${r.pick(MATERIALS)} with fine grain, no gloss, no lettering anywhere.`,
  () => 'Keep the product exactly as photographed: its colourway, its proportions, its label, its finish.',
  (r) => `Composition holds ${r.pick(['a third', 'a quarter', 'half'])} of the frame empty for ${r.pick(MOOD)} space.`,
  (r) => `Colour is led by ${r.pick(MATERIALS)} and ${r.pick(MATERIALS)}, balanced against ${r.pick(LIGHT)}.`,
];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function prompt(r, { sceneName, target = 3300 } = {}) {
  const parts = [];
  if (sceneName) parts.push(`[${sceneName}]`);
  let len = parts.join(' ').length;
  while (len < target) {
    const s = r.pick(SENTENCES)(r);
    parts.push(s);
    len += s.length + 1;
  }
  return parts.join(' ');
}

const INSTRUCTIONS = [
  'make the light warmer',
  'tighter crop on the product',
  'remove the cable',
  'colder and cleaner',
  'add a second bowl of citrus',
  'softer shadows please',
  'move the lamp to the left',
  'more contrast, deeper blacks',
  'swap the rug for terracotta tiles',
  'pull back to show the whole room',
];
export const editInstruction = (r) => r.pick(INSTRUCTIONS);

export const FAILURES = [
  'OpenRouter did not accept your API key',
  'generation timed out after 10 minutes',
  'the engine returned no image for this shot',
];

export const BRAND_NAMES = [
  'Norrland Home',
  'Cinder and Ash',
  'Halcyon Skincare',
  'Marlow Audio',
  'Terra Ceramics',
  'Vale Outdoors',
  'Sable Eyewear',
  'Juniper Kitchen',
  'Lumen Lighting',
  'Orchard Grove',
  'Atlas Luggage',
  'Fable Books',
  'Meridian Watches',
  'Hearth Candles',
  'Ridge Footwear',
  'Solace Bedding',
  'Tidal Swim',
  'Ember Coffee',
  'Quill Stationery',
  'Harbor Denim',
  'Moss Botanicals',
  'Pale Blue Studio',
  'Kiln Tableware',
  'Aster Fragrance',
  'Wren Jewellery',
  'Basalt Fitness',
  'Copperline Tools',
  'Dune Sunglasses',
  'Fern Nursery',
  'Glint Cosmetics',
  'Loom Textiles',
  'Nova Cycles',
  'Onyx Timepieces',
  'Prism Toys',
  'Reef Surf',
  'Slate Office',
  'Tundra Apparel',
  'Umber Paints',
  'Vantage Optics',
  'Willow Wellness',
];

export const SET_NAMES = [
  'Spring campaign',
  'Packshots',
  'Press kit',
  'Lookbook',
  'Social crops',
  'Homepage heroes',
  'Holiday edit',
  'Retail displays',
  'Email banners',
  'Launch day',
  'Editorial',
  'Catalog refresh',
];

export const PRODUCT_NAMES = [
  'Cold brew can',
  'Linen throw',
  'Ceramic mug',
  'Trail runner',
  'Aura speaker',
  'Weekender bag',
  'Field jacket',
  'Serum bottle',
  'Desk lamp',
  'Wool beanie',
  'Glass carafe',
  'Leather wallet',
];
export const PRODUCT_CATEGORIES = ['beverage', 'home', 'apparel', 'beauty', 'electronics', 'accessories'];

export const PERSON_NAMES = ['Astrid', 'Bree', 'Julien', 'Nadia', 'Kofi', 'Mei', 'Rafael', 'Sana', 'Theo', 'Ines'];
export const HAIR = ['cropped silver', 'dark waves', 'copper curls', 'black braids', 'blonde bob', 'shaved close'];
export const AGES = ['mid-20s', 'early 30s', 'late 30s', 'mid-40s', 'early 50s'];

export const SCENE_NAMES = [
  'Plaster Loft',
  'Terrace Dusk',
  'Seamless Grey',
  'Kitchen Island',
  'Gallery Wall',
  'Rooftop Noon',
  'Workshop Bench',
  'Bathroom Marble',
  'Garden Table',
  'Window Seat',
];
export const VERTICALS = ['Beverage', 'Home', 'Fashion', 'Beauty', 'Tech', 'Food & drink'];
export const COLLECTIONS = ['Studio', 'Lifestyle', 'Social', 'Editorial'];

export const PALETTES = [
  {
    primary: ['#D96C3B', 'Terracotta'],
    secondary: ['#1F2933', 'Ink'],
    accent: [
      ['#C9A96E', 'Gold'],
      ['#EFE7DC', 'Bone'],
    ],
  },
  {
    primary: ['#2F4858', 'Deep sea'],
    secondary: ['#F6F1EB', 'Chalk'],
    accent: [
      ['#F0A202', 'Saffron'],
      ['#86BBD8', 'Sky'],
    ],
  },
  {
    primary: ['#3B3A36', 'Charcoal'],
    secondary: ['#E4DED3', 'Sand'],
    accent: [
      ['#9C6644', 'Clay'],
      ['#7F9172', 'Sage'],
    ],
  },
  {
    primary: ['#0B3D2E', 'Forest'],
    secondary: ['#F4F4F2', 'Fog'],
    accent: [
      ['#D4A373', 'Wheat'],
      ['#BC4749', 'Berry'],
    ],
  },
];
