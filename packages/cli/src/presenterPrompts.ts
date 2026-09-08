/**
 * The words every presenter view is drawn from.
 *
 * One module, because two things downstream read these as a contract: the
 * compiler's wardrobe-release clause (brief.ts) names the capture uniform as
 * neutral base layers to be dressed out of, and the curated roster was drawn
 * in the same set, so a person built here matches one we ship. A drift in
 * either string would quietly desync what the release clause is releasing.
 */

/**
 * The capture uniform. Fitted and plain so build reads through it, off-white
 * so a leak into a finished shot is harmless, and the same on every person.
 * Reference clothing is capture context, never wardrobe; the compiler says so.
 */
export const CAPTURE_UNIFORM = 'a fitted off-white ribbed tank top and matching fitted off-white leggings, barefoot';

/** The studio itself. Identical for every person, which is the entire point. */
export const STUDIO_SET =
  'against a solid seamless white studio background, eye-level camera with gentle 85mm-equivalent portrait compression and a soft shallow depth of field, one large soft key light with gentle fill producing even, flattering, true-to-life beauty light, while keeping fine natural skin texture at pore scale and true-to-life proportions, the complexion even and uniform in tone across face, neck and shoulders, never airbrushed, plastic, or synthetic-looking, a calm quietly confident expression, true-to-life color grade with minimal retouch';

export function studioPrompt(subject: string): string {
  // "No logos" here is deliberate, not a gap: a built asset is neutral raw
  // material, and a brand mark enters a shot exactly one way, as the mark chip
  // the user places (see docs/brand-marks.md). Baking a logo into an asset
  // would put a second uncontrolled copy of it into every future shot.
  //
  // The clause that arrives first wins, so the full-bleed instruction leads:
  // without it the backdrop stops short and leaves flat bands down the sides.
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind, ' +
    'the seamless studio backdrop runs past all four edges and is the only thing behind the subject at every edge of the frame. ' +
    `${subject}, ${STUDIO_SET}. ` +
    'No text, no logos, no watermarks anywhere in the frame.'
  );
}

/**
 * The five canonical views, in the order they are built: the reference set
 * the Figma studio lays out as Avatar, Front, Left, Back, Right.
 *
 * `portrait` is the identity: the face at face size, which is the only place
 * identity can be judged (a full-length frame renders it at ~105px brow to
 * chin, a portrait at four times that). `front` carries build, proportion and
 * hair length. `left`, `back` and `right` complete the set the way a casting
 * sheet does, full length and turned. A brief still carries three references
 * (CHARACTER_REF_MAX): the portrait, the front and the first turned view; the
 * other two live on the presenter's page.
 */
export type PresenterView = 'portrait' | 'front' | 'left' | 'back' | 'right';
export const PRESENTER_VIEWS: readonly PresenterView[] = ['portrait', 'front', 'left', 'back', 'right'];

/** What a view asks for, about the person named in `who`. */
export function viewSubject(view: PresenterView, who: string): string {
  switch (view) {
    case 'portrait':
      return `${who}, head-and-shoulders portrait framing from just above the top of the head down to the collarbone, facing the camera straight-on, relaxed neutral expression, eyes to the lens, their own hair exactly as the references show it, the same plain studio backdrop and even frontal light`;
    case 'front':
      return `${who}, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, facing the camera straight-on`;
    case 'left':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned so that their left side faces the camera in a full profile, the head in profile too, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
    case 'back':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned to face directly away from the camera so the back of the head, the shoulders and the legs are to the lens, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
    case 'right':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned so that their right side faces the camera in a full profile, the head in profile too, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
  }
}

/**
 * The identity roll for a person made from a description.
 *
 * An adult, an original: the one place Scenri invents a face, and it must
 * never be a real one. The roll is the portrait, so the face is judged at
 * face size before anything is built on it. Realism over retouch and grown-up
 * bone structure are named because the prior leans the other way. With an
 * `adjustment` the current candidate is attached and the ask becomes "the
 * same person, changed only in this": a nudge keeps the person; Try again
 * does not attach anything and rolls a new one.
 */
export function syntheticIdentitySubject(direction: string, opts: { adjustment?: string } = {}): string {
  const person = `an adult, ${direction.trim()}: an original person who does not resemble any real, famous or public figure, mature adult facial structure`;
  const framing =
    'head-and-shoulders portrait framing from just above the top of the head down to the collarbone, facing the camera straight-on, relaxed neutral expression, eyes to the lens';
  const skin =
    'visible natural skin texture with pores and fine lines, no beauty filter, no digital smoothing, the plain studio backdrop and even frontal light';
  const body = `${person}, ${framing}, wearing ${CAPTURE_UNIFORM}, ${skin}`;
  const adjustment = opts.adjustment?.trim();
  if (!adjustment) return body;
  return `the same person as the attached image, changed only in this: ${adjustment}. Otherwise identical to the attached image in face, hair, age and build; ${body}`;
}

/** What the frames are told they are looking at, from the record we will store. */
export function whoIs(
  name: string,
  draft: { promptName: string; hair?: string; identityNotes?: string } | null,
): string {
  if (!draft) return 'the exact person in the attached photographs';
  const bits = [draft.promptName];
  if (draft.hair && !draft.promptName.toLowerCase().includes(draft.hair.toLowerCase())) bits.push(draft.hair);
  if (draft.identityNotes) bits.push(draft.identityNotes);
  return bits.filter(Boolean).join(', ') || name;
}
