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
 * The six views a person can be cast in: three core, built by default, and
 * three extras, built only on request.
 *
 * `portrait` is the identity: the face at face size, which is the only place
 * identity can be judged (a full-length frame renders it at ~105px brow to
 * chin, a portrait at four times that). `front` carries build, proportion and
 * hair length. `three-quarter` is the turned view a brief most often needs,
 * with both eyes still in frame. Those three are exactly what a brief carries
 * (CHARACTER_REF_MAX), and the three-view shape held identity 6/6 in the
 * battery; a view costs minutes of engine time, so `back`, `left` and `right`
 * complete the casting sheet only when asked for. The compiler swaps one of
 * them in when the shot's own words ask for that side (askedView).
 *
 * PRESENTER_VIEWS is the save order.
 */
export type PresenterView = 'portrait' | 'front' | 'three-quarter' | 'back' | 'left' | 'right';
export const CORE_VIEWS: readonly PresenterView[] = ['portrait', 'front', 'three-quarter'];
export const EXTRA_VIEWS: readonly PresenterView[] = ['back', 'left', 'right'];
export const PRESENTER_VIEWS: readonly PresenterView[] = [...CORE_VIEWS, ...EXTRA_VIEWS];

/** What a view asks for, about the person named in `who`. */
export function viewSubject(view: PresenterView, who: string): string {
  switch (view) {
    case 'portrait':
      return `${who}, head-and-shoulders portrait framing from just above the top of the head down to the collarbone, facing the camera straight-on, relaxed neutral expression, eyes to the lens, their own hair exactly as the references show it, the same plain studio backdrop and even frontal light`;
    case 'front':
      return `${who}, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, facing the camera straight-on`;
    case 'three-quarter':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned about forty-five degrees from the camera so that both eyes stay in frame (a three-quarter view), the head turned with the body, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
    case 'left':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned so that their left side faces the camera in a full profile, the head in profile too, this being a turn of the same body and never a mirror image of it so anything on one side of them stays on that side, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
    case 'back':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned to face directly away from the camera so the back of the head, the shoulders and the legs are to the lens, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
    case 'right':
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, turned so that their right side faces the camera in a full profile, the head in profile too, this being a turn of the same body and never a mirror image of it so anything on one side of them stays on that side, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
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
  return `the same person as the attached image, changed only in this: ${adjustment}. That change is the point of this picture and overrides anything below that describes it otherwise. ${keptAspects(adjustment)}; ${body}`;
}

/**
 * The aspects an ask can be about, and the words that say it is.
 *
 * "Otherwise identical in face, hair, age and build" used to ride behind
 * every ask, which contradicted the ask itself: "blue eyes, changed only in
 * this ... otherwise identical in face" asks for two opposite things at once,
 * and the model kept the face it was shown. What the ask names is excepted
 * from that clause, so only the rest is held still.
 */
const ASPECTS: { name: string; except?: string; words: RegExp }[] = [
  {
    name: 'face',
    except: 'the rest of the face',
    words:
      /\b(face|facial|jaw|chin|cheeks?|cheekbones?|nose|mouth|lips?|teeth|smile|eyes?|eyelids?|eyebrows?|brows?|lashes|freckles?|beard|moustache|mustache|stubble|glasses|expression|skin|complexion|wrinkles?|scars?|birthmarks?|moles?|piercings?|studs?|makeup|make-up|eyeliner|lipstick)\b/i,
  },
  {
    name: 'hair',
    words:
      /\b(hair|haircut|hairline|bob|fringe|bangs|ponytail|bun|braids?|curls?|curly|straighter|bald|shaved|beard)\b/i,
  },
  { name: 'age', words: /\b(age|aged|older|younger|youthful|years old|teenage|[2-7]0s)\b/i },
  {
    name: 'build',
    words:
      /\b(build|body|frame|slim|slimmer|slender|thin|athletic|muscular|heavier|leaner|fuller|broader|broad|shoulders|weight|taller|shorter)\b/i,
  },
  {
    // What a body carries rather than what shape it is. Without this row an ask
    // for a tattoo or a prosthetic arm shipped "otherwise identical in face,
    // hair, age and build" beside it, which is a contradiction: the picture
    // being asked for is not identical, that is the point of asking.
    name: 'marks and limbs',
    except: 'their other marks and limbs',
    words:
      /\b(tattoos?|tattooed|scars?|birthmarks?|moles?|piercings?|prosthetics?|prosthesis|bionic|limbs?|arms?|hands?|legs?)\b/i,
  },
];

/** The "otherwise identical" clause with whatever the ask names taken out of it. */
function keptAspects(adjustment: string): string {
  const kept = ASPECTS.map((a) => (a.words.test(adjustment) ? a.except : a.name)).filter((x): x is string => !!x);
  if (!kept.length) return 'Otherwise the same person as the attached image';
  const list = kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(', ')} and ${kept.at(-1)}`;
  return `Otherwise identical to the attached image in ${list}`;
}

/** The person the frames show, for a draft that has no words yet. */
export const ATTACHED_PERSON = 'the exact person in the attached photographs';

/**
 * What the frames are told they are looking at, from the record we will
 * store. An edit session's accepted identity edits ride as one clause after
 * the record's words, so a view drawn after "shorter hair" follows the
 * change rather than the photographs it was originally read from; the drawn
 * views attached ahead of the photographs carry the picture of it.
 */
/**
 * Their own left and right, said out loud.
 *
 * A trait on one side is the one thing a turned view can get exactly wrong,
 * and the word for the side is the only thing carrying it. Said only when a
 * side is named, so nobody else's prompt grows a clause about handedness.
 */
export function sideNote(keep: string): string {
  return /\b(left|right)\b/i.test(keep) ? " (their own left and right, not the viewer's)" : '';
}

/**
 * The kept words a view can actually show.
 *
 * A portrait is framed from above the head to the collarbone, so an
 * instruction about a forearm can only be obeyed by reframing it, which would
 * cost the face every view is drawn from. A back view cannot show a face. So
 * a detail that is only about the face is left out of the back, a detail that
 * is only about the body is left out of the portrait, and anything else, or
 * anything we cannot place, rides everywhere: leaving a person's own words out
 * is the worse mistake of the two.
 */
const KEEP_FACE =
  /\b(face|facial|jaw|chin|cheeks?|cheekbones?|nose|nostrils?|septum|mouth|lips?|teeth|smile|eyes?|eyelids?|eyebrows?|brows?|lashes|freckles?|beard|moustache|mustache|stubble|glasses|spectacles|ears?|lobes?|temples?|forehead|skin|complexion|wrinkles?|makeup|make-up|eyeliner|lipstick)\b/i;
const KEEP_BODY =
  /\b(arms?|forearms?|wrists?|hands?|knuckles?|fingers?|shoulders?|back|chest|collarbones?|torso|stomach|waist|hips?|legs?|thighs?|calf|calves|ankles?|feet|foot|toes?|knees?|prosthetics?|prosthesis|bionic|limbs?|sleeve)\b/i;

export function keepFor(view: PresenterView, keep: string | undefined): string | undefined {
  const said = keep?.trim();
  if (!said) return undefined;
  const face = KEEP_FACE.test(said);
  const body = KEEP_BODY.test(said);
  if (face && !body) return view === 'back' ? undefined : said;
  if (body && !face) return view === 'portrait' ? undefined : said;
  return said;
}

export function whoIs(
  name: string,
  draft: {
    promptName?: string;
    hair?: string;
    identityNotes?: string;
    identityEdits?: string[];
    keep?: string;
  } | null,
): string {
  if (!draft) return ATTACHED_PERSON;
  const promptName = draft.promptName ?? '';
  const bits = [promptName];
  if (draft.hair && !promptName.toLowerCase().includes(draft.hair.toLowerCase())) bits.push(draft.hair);
  if (draft.identityNotes) bits.push(draft.identityNotes);
  const said = bits.filter(Boolean).join(', ') || name;
  // What the person said should stay, in their own words, before any later
  // change: a view drawn from pictures that cannot show a trait still knows
  // they have it. It stays a noun phrase, because the view's own clauses are
  // appended to it.
  const keep = draft.keep?.trim();
  const who = keep
    ? `${said}, who also has ${keep}${sideNote(keep)}, which is part of who they are and is drawn in this view whether or not the attached images show it`
    : said;
  const edits = (draft.identityEdits ?? []).filter(Boolean);
  if (!edits.length) return who;
  return `${who}, except as changed here: ${edits.join('; ')}; the attached drawn views show the change`;
}
