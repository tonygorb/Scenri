/**
 * The distinctive details a presenter can carry, and what each one is asked.
 *
 * Seven categories, one table, no component per trait. A category is here only
 * if it is all four of: something that persists whenever the person appears,
 * something a model can actually be steered on, something a row of options
 * makes faster to answer than a sentence, and something words alone struggle
 * to pin down. That is why there is no "accessories" row (too broad, and a
 * necklace belongs to a shot, not to a person) and no dental or skin-pattern
 * row (rare enough that describing it beats a row of cards).
 *
 * The shape of every trait is the same, which is the point: choose, or say it
 * in your own words, or attach the exact thing. What differs is the options,
 * and whether the trait needs to know where it is.
 */

export type TraitId = 'glasses' | 'tattoo' | 'scar' | 'piercing' | 'freckles' | 'makeup' | 'prosthetic';

export interface TraitOption {
  /** The words that reach the engine. The label is what a person reads. */
  id: string;
  label: string;
  /**
   * The picture on the card, one of its row's own: every option in a row was
   * drawn in one pass on the same face or the same forearm, so the only thing
   * that changes across a row is the thing being chosen. A card without one
   * falls back to its words.
   */
  card?: string;
}

export interface Trait {
  id: TraitId;
  /** On the chip in the selector. */
  label: string;
  /** The question its own follow-up asks. */
  ask: string;
  /** A line under it, when the ask needs one. */
  hint?: string;
  /** The ready answers, in the order they are shown. */
  options: TraitOption[];
  /** The words the composer asks for when none of them fit. */
  saying: string;
  /** What a person is told to attach, when attaching helps. */
  refHint: string;
  /**
   * Where it is. Only for the traits whose answer is incomplete without it: a
   * tattoo nobody placed is not a tattoo, and a prosthetic limb has a side.
   * The rest either carry their place in the option itself (a septum piercing
   * is on a septum) or do not have one (freckles are where freckles are).
   */
  where?: { ask: string; options: TraitOption[] };
}

/** The order the follow-ups are asked in: the face first, then the body. */
export const TRAITS: Trait[] = [
  {
    id: 'glasses',
    label: 'Glasses',
    ask: 'What glasses do they wear?',
    options: [
      { id: 'thin black rectangular metal frames', label: 'Thin black', card: 'glasses-1' },
      { id: 'round thin gold metal frames', label: 'Round metal', card: 'glasses-2' },
      { id: 'clear transparent acetate frames', label: 'Clear acetate', card: 'glasses-3' },
      { id: 'bold thick black rectangular acetate frames', label: 'Bold rectangular', card: 'glasses-4' },
      { id: 'tortoiseshell acetate frames', label: 'Tortoiseshell', card: 'glasses-5' },
      { id: 'rimless frames with thin temples', label: 'Rimless', card: 'glasses-6' },
    ],
    saying: 'Describe the glasses',
    refHint: 'A clear front or three-quarter view of the frames.',
  },
  {
    id: 'freckles',
    label: 'Freckles or marks',
    ask: 'What marks their skin?',
    options: [
      { id: 'light freckles across the nose and cheeks', label: 'Light freckles', card: 'freckles-1' },
      { id: 'dense freckles across the whole face', label: 'Dense freckles', card: 'freckles-2' },
      { id: 'freckles across the face and shoulders', label: 'Face and shoulders', card: 'freckles-3' },
      { id: 'a small birthmark on one cheek', label: 'Birthmark', card: 'freckles-4' },
      { id: 'a beauty mark above the lip', label: 'Beauty mark', card: 'freckles-5' },
    ],
    saying: 'Describe it',
    refHint: 'A clear, close photograph of it.',
  },
  {
    id: 'makeup',
    label: 'Makeup',
    ask: 'What makeup do they wear?',
    options: [
      { id: 'natural, barely-there makeup', label: 'Natural', card: 'makeup-1' },
      { id: 'black winged eyeliner', label: 'Winged liner', card: 'makeup-2' },
      { id: 'a soft smoky eye', label: 'Smoky eye', card: 'makeup-3' },
      { id: 'a bold red lip', label: 'Bold red lip', card: 'makeup-4' },
      { id: 'soft glamorous makeup with a warm shimmer', label: 'Soft glam', card: 'makeup-5' },
      { id: 'strong defined brows and a nude lip', label: 'Strong brows', card: 'makeup-6' },
    ],
    saying: 'Describe the makeup',
    refHint: 'A clear face photograph showing the look.',
  },
  {
    id: 'scar',
    label: 'Scar',
    ask: 'What scar do they have?',
    options: [
      { id: 'a thin pale scar through one eyebrow', label: 'Through an eyebrow', card: 'scar-1' },
      { id: 'a small pale scar on one cheek', label: 'On a cheek', card: 'scar-2' },
      { id: 'a small scar on the chin', label: 'On the chin', card: 'scar-3' },
      { id: 'a fine scar along the jaw', label: 'Along the jaw', card: 'scar-4' },
      { id: 'a small scar beside one eye', label: 'Beside an eye', card: 'scar-5' },
      { id: 'a faded scar across the bridge of the nose', label: 'Across the nose', card: 'scar-6' },
    ],
    saying: 'Describe the scar',
    refHint: 'A clear, close photograph of it.',
  },
  {
    id: 'piercing',
    label: 'Piercing',
    ask: 'What piercing do they wear?',
    options: [
      { id: 'a small silver nose stud', label: 'Nose stud', card: 'piercing-1' },
      { id: 'a silver septum ring', label: 'Septum ring', card: 'piercing-2' },
      { id: 'a small silver hoop through one eyebrow', label: 'Eyebrow hoop', card: 'piercing-3' },
      { id: 'several small silver hoops in one ear', label: 'Ear hoops', card: 'piercing-4' },
      { id: 'a small silver lip ring', label: 'Lip ring', card: 'piercing-5' },
      { id: 'a row of small silver studs up one ear', label: 'Ear studs', card: 'piercing-6' },
    ],
    saying: 'Describe the piercing',
    refHint: 'A clear photograph of the jewellery.',
  },
  {
    id: 'tattoo',
    label: 'Tattoo',
    ask: 'What is their tattoo?',
    options: [
      { id: 'a fine-line botanical tattoo', label: 'Fine line', card: 'tattoo-1' },
      { id: 'a small geometric line tattoo', label: 'Geometric', card: 'tattoo-2' },
      { id: 'a floral tattoo in soft grey shading', label: 'Floral', card: 'tattoo-3' },
      { id: 'a bold traditional tattoo in heavy black and red', label: 'Traditional', card: 'tattoo-4' },
      { id: 'a solid blackwork tattoo', label: 'Blackwork', card: 'tattoo-5' },
      { id: 'a small script tattoo in thin lettering', label: 'Script', card: 'tattoo-6' },
    ],
    saying: 'Describe the tattoo',
    refHint: 'A clear photograph of the design itself.',
    where: {
      ask: 'And where is it?',
      options: [
        { id: 'on their right forearm', label: 'Right forearm' },
        { id: 'on their left forearm', label: 'Left forearm' },
        { id: 'on their right upper arm', label: 'Right upper arm' },
        { id: 'on their left upper arm', label: 'Left upper arm' },
        { id: 'on one shoulder', label: 'Shoulder' },
        { id: 'on the side of their neck', label: 'Neck' },
        { id: 'on their hand', label: 'Hand' },
        { id: 'on their back', label: 'Back' },
      ],
    },
  },
  {
    id: 'prosthetic',
    label: 'Prosthetic limb',
    ask: 'What does their limb look like?',
    options: [
      { id: 'a prosthetic limb in a matte black finish', label: 'Matte black', card: 'prosthetic-1' },
      { id: 'a bionic limb in a brushed metal finish', label: 'Brushed metal', card: 'prosthetic-2' },
      { id: 'a prosthetic limb in a woven carbon fibre finish', label: 'Carbon fibre', card: 'prosthetic-3' },
      { id: 'a prosthetic limb in a soft skin-tone finish', label: 'Skin tone', card: 'prosthetic-4' },
      { id: 'a prosthetic limb in a bright painted finish', label: 'Painted', card: 'prosthetic-5' },
      { id: 'a bionic limb in a matte white finish with visible joints', label: 'Matte white', card: 'prosthetic-6' },
    ],
    saying: 'Describe it',
    refHint: 'A clear photograph showing its shape and finish.',
    where: {
      ask: 'And which limb?',
      // a limb is not worn on a limb: it is one, and the words say which
      options: [
        { id: 'in place of their left arm', label: 'Left arm' },
        { id: 'in place of their right arm', label: 'Right arm' },
        { id: 'in place of their left leg', label: 'Left leg' },
        { id: 'in place of their right leg', label: 'Right leg' },
        { id: 'in place of their left hand', label: 'Left hand' },
        { id: 'in place of their right hand', label: 'Right hand' },
      ],
    },
  },
];

export const traitOf = (id: string): Trait | undefined => TRAITS.find((t) => t.id === id);

/** One answered trait: what it looks like, where it is, and the picture of it. */
export interface TraitAnswer {
  /** The chosen option's words, or the person's own. */
  words?: string;
  /** Where it is, for the traits that ask. */
  where?: string;
  /** Pictures of the thing itself, never of a person. */
  refs?: string[];
}

export type TraitAnswers = Partial<Record<TraitId, TraitAnswer>>;

/**
 * Does the sentence already say where it is?
 *
 * A person who typed "fine-line botanical covering her right forearm" has
 * answered the placement question inside the appearance one, and asking again
 * is the kind of thing that makes a form feel like a form. Bounded and
 * deterministic: the words the placement options themselves are made of.
 */
const PLACES =
  /\b(forearm|upper arm|arm|shoulder|neck|throat|hand|wrist|back|chest|ribs|thigh|leg|calf|ankle|foot|cheek|eyebrow|brow|chin|lip|nose|ear|temple|jaw|collarbone)\b/i;

export function saysWhere(words: string | undefined): boolean {
  return PLACES.test(words ?? '');
}

/**
 * The whole of a trait, in one sentence for the engine.
 *
 * Words first, place second, because that is the order a person says it in and
 * the order the placement is worth least without: "a fine-line botanical
 * tattoo on their right forearm".
 */
export function traitSentence(id: TraitId, a: TraitAnswer): string {
  const words = a.words?.trim() ?? '';
  const where = a.where?.trim() ?? '';
  if (!words) return where ? `${traitOf(id)?.label.toLowerCase() ?? id} ${where}` : '';
  return where && !saysWhere(words) ? `${words} ${where}` : words;
}

/** Everything kept about this person, as the one sentence their prompts carry. */
export function keepSentence(answers: TraitAnswers, order: TraitId[] = TRAITS.map((t) => t.id)): string {
  return order
    .map((id) => (answers[id] ? traitSentence(id, answers[id] as TraitAnswer) : ''))
    .filter(Boolean)
    .join(', ');
}
