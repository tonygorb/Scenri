import type { NothingKind } from '../../conversation/question.js';

/**
 * Every line Scenri says in the creation conversation, once, so the record
 * repeats it exactly.
 *
 * One convention holds all of them: a short question about *them*, in the
 * words a person would use out loud, and no line underneath explaining what
 * the question meant. A question that needs a note is the wrong question. The
 * run reads as one conversation rather than a form: who they are, then what
 * they look like, then anything else that is always true of them, then their
 * name.
 */
export const PROMPT = {
  source: 'Who are we making? Describe someone new, or add photos of a real person.',
  describe: 'Describe them. Age, hair, build, skin and presence all help; one or two sentences is enough.',
  lookHint: 'Skip anything you would rather leave to us.',
  photos: 'Add one clear photo of their face. Up to three more angles hold the likeness better.',
  name: 'What should we call them?',
  nameWhileDrawing: 'While it draws: what should we call them?',
  nameWhileReading: 'While I read them: what should we call them?',
  // The one question that opens more: what is always true of this person, over
  // and above the rows. It says "always" so nothing under it has to.
  traits: 'Anything else that is always true of them?',
  traitsPhotos: 'Anything in these photos that is always true of them?',
  keep: 'Anything else about them?',
  // The last word before a picture is drawn: the whole person is set out above
  // it, so the ask itself is one short question and nothing more.
  agree: 'Here is the presenter, in full. Ready to draw?',
  identity: (who: string) => `Here is ${who === 'them' ? 'the face' : who}. Use this person, or change something.`,
  change: 'What should change?',
  // A view standing for the first time is not a revision of anything, so it
  // is not offered a previous one to go back to.
  landed: (view: string) => `Here is the ${view}. Use it, or try again.`,
  extras: 'Add back and profile views? They help shots from behind or in profile.',
};

/**
 * What is being read, while it is being read.
 *
 * The words that describe a person are read off their photographs when they
 * have some, and off their own drawn face when they do not. Saying "reading the
 * photos" to somebody who described a person in a sentence names a thing that
 * does not exist, and reads as the app having lost the plot.
 */
export const readingWhat = (source: string | undefined): string => (source === 'photos' ? 'the photos' : 'the face');

export const SOURCE_OPTIONS = [
  { id: 'photos', label: 'Add photos' },
  { id: 'scratch', label: 'Describe someone' },
];

/** The words a typed sentence picks a door by. */
export const DOOR_WORDS: Record<string, RegExp> = {
  photos: /\b(photos?|pictures?|pics?|upload|images?|selfies?)\b/,
  scratch: /\b(scratch|describe|description|invent|make (someone|one|them) up|imagine|new person)\b/,
};

/**
 * Five ready answers to the question as it is asked: who, age, skin, hair,
 * build and presence, in one sentence. A few words on the chip, the whole
 * sentence on hover and into the composer.
 */
export const STARTERS = [
  {
    label: 'Late 30s, warm',
    text: 'A woman in her late 30s, Mediterranean, olive skin, dark shoulder-length hair, slim build, warm and composed.',
  },
  {
    label: 'Early 20s, bright',
    text: 'A man in his early 20s, fair skin with freckles, short blond hair, athletic build, bright and easygoing.',
  },
  {
    label: 'Mid 40s, quiet',
    text: 'A man in his mid 40s, East Asian, close-cropped black hair, lean build, quietly confident.',
  },
  {
    label: 'Late 20s, easy',
    text: 'A woman in her late 20s, deep brown skin, natural curls, tall and graceful, with an easy laugh.',
  },
  {
    label: 'Sixties, calm',
    text: 'A woman in her early sixties, light skin, silver hair in a soft bob, broad build, calm and assured.',
  },
];

export const ATTEST_TEXT = "I have permission to use this person's likeness.";

export const gapsPrompt = (n: number): string =>
  n === 1
    ? 'One thing I cannot tell yet.'
    : n === 2
      ? 'Two things I cannot tell yet.'
      : 'A few things I cannot tell yet.';

export function photosLine(n: number): string {
  return n === 1 ? 'One photo' : `${n} photos`;
}

export function photosHint(n: number, max: number): string {
  if (n === 0) return 'The same person, face clear. Different angles help.';
  if (n === 1) return 'One photo works. Two to four, from different angles, hold the likeness better.';
  if (n < max) return `${n} photos. More angles hold the likeness better.`;
  return 'Four angles. The reference set comes from these.';
}

/** A sentence with nothing of a person in it, waiting to be drawn from anyway or replaced. */
export const UNSURE_PROMPT =
  'That does not read as a description yet. Draw from it anyway, or describe them: age, hair, build, skin, presence.';

/**
 * What changing this answer costs, said in the block that is changing it.
 *
 * A conversation reads forward, so an answer changed halfway up takes back
 * everything said after it and those questions are asked again. Worth knowing
 * before the tap rather than after, and worth knowing without being stopped:
 * it is information at the moment of the decision, not a gate in front of it.
 * Nothing to lose, nothing said.
 */
export const changeCost = (after: number): string | undefined =>
  after === 0
    ? undefined
    : after === 1
      ? 'Changing this asks the one after it again.'
      : `Changing this asks the ${after} after it again.`;

/** What is asked once before a face is drawn from a changed answer. */
export const REDRAW_TITLE = 'Change this answer?';
export const REDRAW_BODY =
  'The face is drawn again from the change, and the views built on it follow. Nothing already saved changes.';
export const REDRAW_BODY_PHOTOS =
  'The views drawn from the photos are drawn again with the change. The photos themselves stay as they are.';

/** Where the conversation is when a sentence answers nothing: what the reply points back to. */
export type AsidePhase = 'source' | 'describe' | 'look' | 'name' | 'refine' | 'detail';

const HOW: Record<AsidePhase, string> = {
  source: 'describe them in a sentence, or pick one',
  describe: 'a few words about them is enough: age, hair, build, skin, presence',
  look: 'tap one, or say it in your own words',
  name: 'a name, so the rest of the conversation can use it',
  refine: 'say what should change: hair, age or build change the person; anything else changes the view on the stage',
  detail: 'tap one, or say what it looks like',
};

/**
 * Where the row is, relative to the words that point at it.
 *
 * The question being asked is the last line of the conversation, so its row
 * of cards is under whatever was just said, never over it. Every one of these
 * used to say "above", which was true while the row was built in place and
 * became a plain falsehood the moment the question moved to the end. They name
 * no direction now: the row is the only one on screen, and it is the thing
 * right there.
 */
/**
 * One step of the look, in its own words.
 *
 * A step asks one thing, so what comes back is answered about that thing: a
 * hair colour is not answered with the whole person's description, which is
 * what the describe phase would have said. `thing` names what was expected;
 * `how` says the two ways to give it.
 */
const LOOK_ASK: Record<string, { thing: string; how: string }> = {
  who: { thing: 'a person', how: 'tap who they are' },
  age: { thing: 'an age', how: 'tap an age, or type one: Scenri draws adults' },
  hair: { thing: 'a hair colour', how: 'tap a colour, or say it: dark auburn, salt and pepper' },
  length: { thing: 'a length', how: 'tap a length, or say it: a chin-length bob' },
  skin: { thing: 'a skin tone', how: 'tap a tone, or say it: warm olive' },
  build: { thing: 'a build', how: 'tap a build, or say it: lean and tall' },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The question again, in words that answer what was actually said. Different words the second time. */
/**
 * The answer to something that answered nothing.
 *
 * `again` is how many times this same question has already been answered this
 * way. The same sentence three times running reads as a wall rather than as a
 * reply, so once somebody is plainly stuck the way out is named instead.
 */
export function asideReply(
  kind: NothingKind,
  phase: AsidePhase,
  again: number,
  said = '',
  step?: string,
  asked = false,
): string {
  const ask = phase === 'look' ? (LOOK_ASK[step ?? ''] ?? null) : null;
  const how = ask?.how ?? HOW[phase];
  /**
   * How to answer, unless the question is standing right underneath.
   *
   * The question being asked is the last line of the conversation, so after a
   * refusal it is drawn again with its row directly below these words. Saying
   * "tap a length, or say it" there makes the app repeat itself twice over: the
   * reply says it, and then the question says it with the cards in hand. The
   * reply's job is to say what was wrong with what was said; the question's job
   * is to ask. `asked` is the flow saying which of those two is about to happen.
   */
  const tail = asked ? '' : ` ${cap(how)}.`;
  // said twice already: point at the way past it rather than asking a third time
  if (again >= 2 && kind !== 'likeness') {
    const out = phase === 'look' || phase === 'detail' ? 'Or Skip it and we will choose.' : '';
    return asked ? out || `${cap(how)}.` : `${cap(how)}.${out ? ` ${out}` : ''}`;
  }
  switch (kind) {
    case 'likeness':
      return 'Describe them by looks. Scenri does not draw a named person.';
    case 'help':
      return ask
        ? `${cap(how)}.` // help asks how, so it is answered with how, standing question or not
        : phase === 'refine'
          ? 'Select a view and say what is wrong with it, or say what should change about them: hair, age, build, skin.'
          : phase === 'name'
            ? 'Any name will do; it can be changed later.'
            : phase === 'detail'
              ? `${cap(how)}.`
              : 'Describe the person in a sentence: age, hair, build, skin, presence. Or add photos of a real person.';
    case 'question':
      return ask
        ? `This step asks for ${ask.thing}: ${how}.`
        : phase === 'refine'
          ? `This is where the picture is changed: ${how}.`
          : phase === 'name'
            ? `This is where they get a name: ${how}.`
            : phase === 'detail'
              ? `This asks what the detail looks like: ${how}.`
              : `This is where the person is described: ${how}.`;
    case 'nav':
      return 'To begin again, use Start over at the top. Close keeps the draft where it is.';
    case 'go':
      return phase === 'refine'
        ? 'Try again redraws it as it is; a sentence says what should change.'
        : `Nothing to draw yet. ${cap(how)}.`;
    case 'intent':
      return ask
        ? `${cap(how)}.`
        : phase === 'refine'
          ? `Nothing changes until it is said what: ${how}.`
          : `That is what we are here for. Who are they? ${cap(how)}.`;
    case 'nonsense':
      return ask
        ? `That is not ${ask.thing}.${tail}`
        : phase === 'name'
          ? `That is not a name. ${cap(how)}.`
          : phase === 'refine'
            ? `That does not say what should change. ${cap(how)}.`
            : phase === 'detail'
              ? `That does not say what it looks like. ${cap(how)}.`
              : `That does not describe anyone. ${cap(how)}.`;
    case 'greeting':
      return again
        ? `Still here.${tail}`
        : /^(hi|hello|hey|heya|hiya|yo|hola|shalom|good)\b/i.test(said.trim())
          ? `Hi.${tail}`
          : `${cap(how)}.`;
    case 'ack':
      return again ? `Still here.${tail}` : asked ? 'Go ahead.' : `Go ahead: ${how}.`;
    case 'vague':
      return again ? `Still here. ${cap(how)}.` : `${cap(how)}.`;
  }
}

/**
 * What an engine said, said in a sentence of ours.
 *
 * Its message is already a sentence and already ends in a full stop, so
 * putting one after it read "...add credits from your Codex account.. Nothing
 * finished was touched."
 */
export const reason = (text: string): string => text.trim().replace(/[.\s]+$/, '');
