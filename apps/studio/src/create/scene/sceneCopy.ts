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
  resize: 'Resize the panel',

  // writing
  placeLead: 'Describe the place',
  placeHint: 'Where it is, what it is made of, and the light. Your words decide what matters in the pictures.',
  placeholder: 'A warm brutalist hotel lobby at dusk, hard side light',
  picturesLead: 'Pictures of it',
  picturesRead: 'Up to four. Read into words for this scene, never sent with your shots.',
  picturesPlate: 'Because it is built around a figure, its preview goes with a shot beside a presenter.',
  picturesSayWhich:
    'If they show different things, say which is for what: "the architecture of the first, the light of the second".',
  addPictures: 'Add pictures',
  morePictures: (n: number) => `${n} more`,
  dropHere: 'Drop pictures of the place here',

  // the empty stage
  emptyLead: 'The place appears here',
  emptyHint: 'Describe it, or drop pictures of it',
  phoneIntro: 'A scene is the place and the light around your shot.',

  // the primary, and why it is closed
  draw: 'Draw the scene',
  readOnly: 'Read the scene',
  continue: 'Continue',
  readAgain: 'Read again',
  waitingForPictures: 'Waiting for the pictures',
  needSomething: 'Describe the place, or add a picture of it',
  picturesNeedCodex: 'Reading pictures needs Codex. Describe the place in words, or set up Codex.',

  // working
  reading: 'Reading the place',
  changing: 'Changing the words',
  drawing: 'Drawing the scene',
  stop: 'Stop',
  stillReading: 'Still reading the place',

  // review
  readingHead: 'What your shots are told',
  readingNote: 'Every shot made with this scene is given these words.',
  placeLabel: 'The place',
  lightLabel: 'Light',
  cameraLabel: 'Camera',
  figureLabel: 'Built around',
  figureNote:
    'A role, not a person. Attach a presenter and they play it; with nobody attached the set renders on its own.',
  previewWords: 'A preview of these words, with nothing staged in it.',
  previewFigure: 'A preview of these words. Beside a presenter, this picture goes with the shot.',
  ready: 'The scene is ready',
  wordsReady: 'The words are ready. Nothing was drawn.',
  staleLine: 'The place or the pictures changed. Read them again.',
  readFirst: 'Read the changed place first',
  yourWords: 'Your words',
  noWords: 'No words, only the pictures.',
  editWords: 'Change your words',
  editReading: 'Edit these words',
  saveWords: 'Keep these words',
  cancel: 'Cancel',
  nameLabel: 'Name',
  namePlaceholder: 'Name this scene',
  nameIt: 'Name this scene',
  use: 'Use this scene',
  saveChanges: 'Save changes',
  saveAsNew: 'Save as a new scene',
  again: 'Try again',
  change: 'Change something',
  drawPreview: 'Draw a preview',
  changePlaceholder: 'Say what to change. The rest stays.',
  changeLabel: 'What to change',
  changeAction: 'Change',
  saving: 'Saving',

  // one line back
  notInAScene: 'A scene holds the place and its light. Add presenters and products in Create.',
  useputBack: 'Step back through the versions on the picture, and Put back the one you want.',
  sayAChange: 'Say what to change about the place, and the rest stays as it is.',
  failed: 'That did not work. Nothing standing was touched.',
  lost: 'That work is gone: the server restarted while it ran. Try it again.',

  // leaving
  leaveTitle: 'Leave this scene?',
  leaveBody: 'It is not saved, so the words, pictures and previews go.',
  leave: 'Leave',
  keepWorking: 'Keep working',
  discardTitle: 'Discard the changes?',
  discardBody: 'The scene stays as it was saved. What was drawn here is let go.',
  discard: 'Discard changes',

  // saved
  saved: (name: string) => `${name} saved`,
  filed: (cats: string[]) => (cats.length ? `Filed under ${cats.join(' and ')}. Change it on its page.` : ''),
  gone: "This scene isn't here anymore.",
};
