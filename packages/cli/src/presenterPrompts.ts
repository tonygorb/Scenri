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

export type PresenterView = 'portrait' | 'front' | 'three-quarter' | 'back' | 'left' | 'right';

/** What one view is, and what the rest of the system may derive from it. */
export interface ViewRole {
  id: PresenterView;
  /** Built by default, or only once somebody asks for the whole set. */
  tier: 'core' | 'supplementary';
  /** A person decides this one; the draft does not advance past it alone. */
  gate?: true;
  /** The approved views it is drawn from, in the order they are attached. */
  from: PresenterView[];
  /** How it is named in a sentence a person reads. */
  label: string;
}

/**
 * The six views a person can be cast in, as one table.
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
 * Row order is the save order and the build order, and there is no second
 * ordering anywhere in the system. Everything under the table derives from it,
 * so what a view IS costs one row to change rather than a sweep through five
 * files that used to hold the same list and had nothing keeping them level.
 */
export const VIEW_ROLES: readonly ViewRole[] = [
  { id: 'portrait', tier: 'core', gate: true, from: [], label: 'face' },
  { id: 'front', tier: 'core', gate: true, from: ['portrait'], label: 'front view' },
  { id: 'three-quarter', tier: 'core', from: ['portrait', 'front'], label: 'three-quarter view' },
  { id: 'back', tier: 'supplementary', from: ['portrait', 'front'], label: 'back view' },
  { id: 'left', tier: 'supplementary', from: ['portrait', 'front'], label: 'left view' },
  // Never from the left: drawing one profile off the other is the surest way
  // to put a trait on the wrong side of a face. See refDeps.
  { id: 'right', tier: 'supplementary', from: ['portrait', 'front', 'left'], label: 'right view' },
];

const idsWhere = (want: (r: ViewRole) => boolean): readonly PresenterView[] => VIEW_ROLES.filter(want).map((r) => r.id);

export const PRESENTER_VIEWS: readonly PresenterView[] = idsWhere(() => true);
export const CORE_VIEWS: readonly PresenterView[] = idsWhere((r) => r.tier === 'core');
export const EXTRA_VIEWS: readonly PresenterView[] = idsWhere((r) => r.tier === 'supplementary');

/** Which approved views a view is drawn from. The order is the attachment order. */
export const DEPENDS = Object.fromEntries(VIEW_ROLES.map((r) => [r.id, r.from])) as Record<
  PresenterView,
  PresenterView[]
>;

/** How a view is named in a sentence a person reads. */
export const VIEW_LABEL = Object.fromEntries(VIEW_ROLES.map((r) => [r.id, r.label])) as Record<PresenterView, string>;

/** The views a person decides rather than the draft deciding for them. */
export const HAND_APPROVED: ReadonlySet<PresenterView> = new Set(idsWhere((r) => r.gate === true));

/** What a view asks for, about the person named in `who`. */
export function viewSubject(view: PresenterView, who: string): string {
  switch (view) {
    case 'portrait':
      return `${who}, head-and-shoulders portrait framing from just above the top of the head down to the collarbone, facing the camera straight-on, relaxed neutral expression, eyes to the lens, their own hair exactly as the references show it, the same plain studio backdrop and even frontal light`;
    case 'front':
      // The front is drawn from the approved face and was the one view that
      // never said so, nor that the hair is theirs. Both clauses ride every
      // other turned view; their absence here was an oversight, not a choice.
      return `${who}: the same person as the attached images, wearing ${CAPTURE_UNIFORM}, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, facing the camera straight-on, their own hair exactly as the attached images show it, the same plain studio backdrop and even light`;
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

/**
 * One thing that stays true about a person, kept whole.
 *
 * A list, not a sentence. A sentence has one length, and a cap cuts it
 * wherever it happens to land: with four details joined, "in place of their
 * left arm" reached the store as "in place of their le" and the side was
 * gone. Each item is carried, capped and filtered on its own, so a long one
 * can never cost a short one and the last one chosen is not the first one
 * lost. Which detail a picture belongs to survives for the same reason.
 */
export interface KeepItem {
  /** The row it came from ('glasses', 'tattoo'), or 'said' for their own words. */
  id: string;
  /** What it is, in the words the person chose, placement included. */
  words: string;
  /** Pictures of the thing itself, never of a person. */
  refs?: string[];
}

/** The one sentence the items make, which is what a record stores and a person reads. */
export const keepSentenceOf = (items: readonly KeepItem[]): string => items.map((i) => i.words).join(', ');

/** A sentence stored before there were items, read back as items. */
export function itemsFromKeep(keep: string | undefined): KeepItem[] {
  return (keep ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .map((words, i) => ({ id: `said-${i}`, words }));
}

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
 * What a view can actually show.
 *
 * A portrait is framed from above the head to the collarbone, so an
 * instruction about a forearm can only be obeyed by reframing it, which would
 * cost the face every view is drawn from. A back view cannot show a face. So
 * a detail that is only about the face is left out of the back, a detail that
 * is only about the body is left out of the portrait, and anything else, or
 * anything we cannot place, rides everywhere: leaving a person's own words out
 * is the worse mistake of the two.
 *
 * Judged per item. Judged on the joined sentence, as it was, one glasses plus
 * one forearm tattoo read as both face and body, so the tattoo was asked for
 * in a head-and-shoulders portrait and the glasses in a back view.
 */
const KEEP_FACE =
  /\b(face|facial|jaw|chin|cheeks?|cheekbones?|nose|nostrils?|septum|mouth|lips?|teeth|smile|eyes?|eyelids?|eyebrows?|brows?|lashes|freckles?|beard|moustache|mustache|stubble|glasses|spectacles|ears?|lobes?|temples?|forehead|skin|complexion|wrinkles?|makeup|make-up|eyeliner|lipstick)\b/i;
const KEEP_BODY =
  /\b(arms?|forearms?|wrists?|hands?|knuckles?|fingers?|shoulders?|back|chest|collarbones?|torso|stomach|waist|hips?|legs?|thighs?|calf|calves|ankles?|feet|foot|toes?|knees?|prosthetics?|prosthesis|bionic|limbs?|sleeve)\b/i;

/**
 * Where a detail lives, for the rows whose answer never says.
 *
 * The words a row produces are the words a person would use for the thing
 * itself, and those do not always name the part of a body they are on: "bold
 * thick black rectangular acetate frames" is a pair of glasses with the word
 * glasses nowhere in it, so read as words alone it was unplaceable and asked
 * for in a back view. A row that always lives in one place says so here; the
 * two rows that move (a tattoo, a prosthetic limb) carry their placement in
 * their own words, and those are read.
 */
const ROW_LIVES: Record<string, 'face' | 'body'> = {
  glasses: 'face',
  freckles: 'face',
  makeup: 'face',
  scar: 'face',
  piercing: 'face',
};

function shows(view: PresenterView, item: KeepItem): boolean {
  const lives = ROW_LIVES[item.id];
  const face = lives ? lives === 'face' : KEEP_FACE.test(item.words);
  const body = lives ? lives === 'body' : KEEP_BODY.test(item.words);
  if (face && !body) return view !== 'back';
  if (body && !face) return view !== 'portrait';
  return true;
}

/** The items this view can show, in the order they were kept. */
export function itemsFor(view: PresenterView, items: readonly KeepItem[]): KeepItem[] {
  return items.filter((i) => shows(view, i));
}

/** And the same, as the clause a prompt carries. */
export function keepFor(view: PresenterView, items: readonly KeepItem[]): string {
  return keepSentenceOf(itemsFor(view, items));
}

/** The person the frames show, for a draft that has no words yet. */
export const ATTACHED_PERSON = 'the exact person in the attached photographs';

/** What a read of the approved face found. */
export interface AnalyzerWords {
  promptName?: string;
  hair?: string;
  identityNotes?: string;
}

/**
 * Who this person is, right now, from every source with a claim on it.
 *
 * One value, so no view has to work out for itself what the person looks
 * like. What they said leads, because they said it; a read of the approved
 * face adds to it and never replaces it, which is the way round it has to be:
 * a face crop cannot see a build, and it used to be the only thing a full
 * body view was told. Their kept details follow whole, and any change
 * accepted in this session comes last, because it is the most recent thing
 * they asked for.
 */
export interface PresenterIdentity {
  said: string;
  read: AnalyzerWords | null;
  items: KeepItem[];
  edits: string[];
}

export function identityOf(rec: {
  direction?: string;
  keep?: string;
  keepItems?: KeepItem[];
  analysis?: AnalyzerWords;
  identityEdits?: string[];
}): PresenterIdentity {
  return {
    said: (rec.direction ?? '').trim(),
    read: rec.analysis ?? null,
    items: rec.keepItems ?? itemsFromKeep(rec.keep),
    edits: (rec.identityEdits ?? []).filter(Boolean),
  };
}

/**
 * The noun phrase every view is built on: who they are, then what stays true
 * of them that this view can show, then whatever has changed since.
 */
export function whoIs(id: PresenterIdentity | null, view: PresenterView): string {
  if (!id) return ATTACHED_PERSON;
  const bits: string[] = [];
  const read = id.read;
  // A read of the approved face leads when there is one: the face was
  // decided, so it is what this person looks like. What they described
  // follows it rather than being replaced by it, because a portrait crop
  // cannot show a build and the description is the only thing that knows.
  // With nothing read, the description carries the view on its own.
  const named = read?.promptName ?? '';
  // A description that already contains the read name says both at once; two
  // of them side by side is a stutter in the middle of the subject.
  if (named && id.said.toLowerCase().includes(named.toLowerCase())) bits.push(id.said);
  else if (named) bits.push(named);
  else if (id.said) bits.push(id.said);
  const already = (v: string) => bits.some((b) => b.toLowerCase().includes(v.toLowerCase()));
  if (read?.hair && !already(read.hair)) bits.push(read.hair);
  if (read?.identityNotes) bits.push(read.identityNotes);
  if (id.said && !already(id.said)) bits.push(id.said);
  const said = bits.filter(Boolean).join(', ') || ATTACHED_PERSON;
  // What the person said should stay, in their own words, before any later
  // change: a view drawn from pictures that cannot show a trait still knows
  // they have it. It stays a noun phrase, because the view's own clauses are
  // appended to it.
  const keep = keepFor(view, id.items);
  const who = keep
    ? `${said}, who also has ${keep}${sideNote(keep)}, which is part of who they are and is drawn in this view whether or not the attached images show it`
    : said;
  if (!id.edits.length) return who;
  return `${who}, except as changed here: ${id.edits.join('; ')}; the attached drawn views show the change`;
}
