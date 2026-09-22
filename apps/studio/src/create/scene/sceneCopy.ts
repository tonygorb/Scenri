/**
 * Every line the scene studio says, once.
 *
 * Plain and specific, in the product's own words: a scene is a place and its
 * light, and what a shot is told about it is words. No em dashes, no marvel,
 * nothing about models.
 */
/** "Hands, another angle and a bold one". */
function joinAnd(xs: string[]): string {
  const [first, ...rest] = xs;
  const lead = [first, ...rest.map((x) => x.toLowerCase())];
  return lead.length > 1 ? `${lead.slice(0, -1).join(', ')} and ${lead[lead.length - 1]}` : (lead[0] ?? '');
}

export const COPY = {
  title: 'Create scene',
  editTitle: 'Edit scene',
  intent: 'Create a scene',

  // the setup
  source: 'Where are we shooting? Describe the place, or start from pictures of one.',
  addPictures: 'Add pictures',
  guideMe: 'Guide me',
  photos: 'Add one to four pictures of the place. The more they share, the better it reads.',
  photosDrop: { label: 'Add pictures of the place', hint: 'Drop them here, or choose files' },
  /** Scenes this person already made, offered rather than a dump of every shot. */
  haveLabel: 'Or take a scene you already made',
  haveHint: 'The place in it is read. Product shots stay out.',
  haveAlt: (name: string) => name,
  haveMore: (n: number) => `See all ${n} scenes`,
  haveFewer: 'Show fewer',
  haveSearch: 'Find a scene',
  /** Stop was pressed before anything landed. Not a fault. */
  stopped: 'That was stopped. Nothing here was changed.',
  stoppedRead: 'Stopped before the place was read. Read it again, or say it differently.',
  stoppedDraw: 'Stopped. Nothing was drawn.',
  stoppedChange: 'Stopped before the picture changed. The new words are kept: draw them, or put back the last picture.',
  readThem: 'Read them',
  guideInstead: 'Guide me instead',
  skip: 'Skip',
  describeInstead: 'Describe instead',
  /** Said once, at the first row: a world is a starting point, not the final scene. */
  worldHint: "Choose a starting world. You'll personalise it next.",
  /** The light row, once a world has already named its own light. */
  worldLightPrompt: (light: string) => `This world is already lit ${light}. Keep it, or choose another.`,
  keepWorldLight: 'Keep it',
  /** The surface row, after a world: what that world is made of already answers it. */
  keepWorldSurface: "Keep the world's own",
  /** The signature row's pass: the reading invents an idea for the place. */
  suggestOne: 'Suggest one',
  /** After a sentence that gave a feeling but no place. */
  followWorld: 'You have the feel of it. What kind of place is it?',
  /** After a sentence that gave the place but not how it is lit. */
  followLight: 'You have the place. What light is it in?',
  /** A follow-up passed over: the reader decides it from the sentence. */
  leaveToReading: 'Leave it to the reading',
  /** Joined on when a world was chosen and nothing after it was personalised. */
  worldIsAStart:
    'Treat this as a starting direction, not a picture to reproduce: keep the material language and the character of the light, and invent a specific original arrangement.',

  // the empty stage
  emptyLead: 'The place appears here',
  emptyHint: 'Describe it, or add pictures of it',

  // the composer
  sourcePlaceholder: 'Describe the place, or choose above',
  /** Every question passed and nothing said: the line is the only way on. */
  nothingSaidPlaceholder: 'Tell me where we are, in your own words',
  /**
   * The line at a row, naming what it is for.
   *
   * "Tap one above, or describe it" left "it" to be worked out, and the row it
   * belongs to is the thing a person is deciding. The words are the way past
   * any row: eight worlds is a starting point, not the whole of what a place can
   * be.
   */
  rowPlaceholder: (row: string) => `Tap one above, or describe the ${row} in your own words`,
  photosOff: 'Add the pictures above, then read them.',
  addPlaceholder: 'Anything to add or leave out?',
  keepPlaceholder: 'Anything to keep or ignore in them?',
  changePlaceholder: 'Say what to change. The rest stays.',
  namePlaceholder: 'Its name',
  nameIt: 'Name this scene',
  attachLabel: 'Add pictures of the place',
  send: 'Send',
  lineLabel: 'Your answer',
  change: 'Change',

  // the work
  reading: 'Writing what your shots are told',
  readingPhotos: 'Reading your pictures',
  changing: 'Changing the words',
  drawing: 'Drawing the scene',
  stillReading: 'Still writing what your shots are told',

  // the read-back and the decision
  readingHead: 'What your shots are told',
  placeLabel: 'The place',
  lightLabel: 'Light',
  cameraLabel: 'Camera',
  figureLabel: 'Built around',
  agree: 'Here is the place, in full. Ready to draw?',
  agreePhotos: 'Here is the place I read in your pictures. Ready to draw?',
  agreeChanged: 'Here it is with that. Ready to draw?',
  agreeBlind: 'Here is the place, in full. Nothing here can draw yet, so it is saved as words.',
  readAgain: 'I read the place again.',
  draw: 'Draw the scene',
  saveWords: 'Save scene',
  here: 'Here is the scene.',
  again: 'Here it is again.',
  changed: 'Here it is, changed.',
  decide: (name: string) => `Here is ${name}. Use it, or change something.`,
  decideEdit: (name: string) => `Here is ${name}. Save it, or change something.`,
  use: 'Use this scene',
  saveChanges: 'Save changes',
  tryAgain: 'Try again',
  changeSomething: 'Change something',
  name: 'While it draws: what should we call it?',
  editOpen: (name: string) => `Here is ${name}, as it is saved. Change something, or draw it again.`,
  failed: 'That did not work. Nothing standing was touched.',
  failedFirst: (why: string) => `That did not go through: ${why}. Nothing was drawn.`,
  lost: 'That work is gone: the server restarted while it ran. Try it again.',
  offline: 'Lost touch with Scenri. Still trying.',
  retry: 'Try again',
  version: (n: number) => `Version ${n}`,

  // after Use: the place in use, drawn here (sceneExamples.ts on the server)
  saved: 'Saved.',
  inUse: (who: 'product' | 'presenter') =>
    `Saved. Now it is shown in use, with a Scenri demo ${who}. Shots are told the words, never handed these pictures.`,
  noLibrary: "Saved. Scenri's library has not downloaded yet, so it cannot be shown in use for now.",
  exampleHere: {
    hero: 'Here is the hero.',
    close: 'Here is a close-up.',
    hands: 'Here it is in hands.',
    angle: 'Here is another angle.',
    bold: 'Here is a bold one.',
  },
  exampleFailed: (label: string, why: string) =>
    `The ${label.toLowerCase()} did not draw: ${why.replace(/[.\s]+$/, '')}.`,
  /** The three more, or two for a place already staged in hands or built around a person. */
  more: (labels: string[]) =>
    `Add ${['no', 'one', 'two', 'three'][labels.length] ?? labels.length} more? ${joinAnd(labels)}.`,
  addThem: 'Add them',
  notNow: 'Not now',
  ready: (name: string) => `${name} is ready.`,
  readyMissing: (name: string) => `${name} is ready. Some did not draw.`,
  openScene: 'Open scene',
  useInAShot: 'Use in a shot',

  // one line back to a sentence that answers nothing
  notAPlace: "That did not read as a place. Try a few words about it, like 'a quiet concrete gallery at dusk'.",
  greet: 'Hello. Describe the place, or choose above.',
  greetRow: 'Tap one above, or say it in a few words.',
  askHelp: 'Describe the place in a few words, or tap one above. Everything can be changed later.',
  goFirst: 'Choose above, or describe the place first.',
  startOverIsUp: 'Start over is at the top of this panel.',
  notInAScene: 'A scene holds the place and its light. Add presenters and products in Create.',
  usePutBack: 'Step back through the versions on the picture, and Put back the one you want.',
  sayAChange: 'Say what to change about the place, and the rest stays as it is.',
  renamed: (name: string) => `Called it ${name}.`,
  changeIt: 'Change it',
  changeTitle: 'Change this answer?',
  changeBody:
    'The picture was drawn from the answers as they are. Changing one asks again from there, and the pictures so far go. To keep the picture and change one thing, say it in the line instead.',
  onlyPictures: 'Only pictures can show a place.',
  fourPictures: 'Four pictures is the most a scene is read from.',

  // leaving
  leaveTitle: 'Leave this scene?',
  leaveBody: 'Nothing has been read yet, so the answers here go.',
  leave: 'Leave',
  discardTitle: 'Discard the changes?',
  discardBody: 'The scene stays as it was saved. What was drawn here is let go.',
  discard: 'Discard changes',
  startOver: 'Start over',
  startOverTitle: 'Start over?',
  startOverBody: 'This conversation begins again from the first question. Nothing here is saved yet.',
};
