/**
 * Every line the scene studio says, once.
 *
 * Plain and specific, in the product's own words: a scene is a place and its
 * light, and what a shot is told about it is words. No em dashes, no marvel,
 * nothing about models.
 */
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
  /** Pictures already in the library, offered rather than asked for. */
  haveLabel: 'Take one you already made',
  haveHint: 'The world in it is read; the product and the person in it are not.',
  haveAlt: (n: number) => `Shot ${n}, take the place in it`,
  readThem: 'Read them',
  guideInstead: 'Guide me instead',
  skip: 'Skip',

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
   * any row: six worlds is a starting point, not the whole of what a place can
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
  reading: 'Reading the place',
  changing: 'Changing the words',
  drawing: 'Drawing the scene',
  stillReading: 'Still reading the place',

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
  leaveBody: 'It is not saved, so what was said and drawn here goes.',
  leave: 'Leave',
  discardTitle: 'Discard the changes?',
  discardBody: 'The scene stays as it was saved. What was drawn here is let go.',
  discard: 'Discard changes',
  startOver: 'Start over',
  startOverTitle: 'Start over?',
  startOverBody: 'This conversation begins again from the first question. Nothing here is saved yet.',
  footnote: 'One reading and one picture at a time.',
  footnoteBlind: 'Nothing here can draw, so a scene is saved as words.',
};
