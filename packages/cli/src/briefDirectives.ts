/**
 * The pure directive helpers of the brief compiler: fixed strings and
 * brand-document readers with no compile state. `compileBrief` itself stays in
 * `brief.ts`, where the order-sensitive assembly lives.
 */
/**
 * What the model is told about the product, keyed on how much of the object it
 * can actually see.
 *
 * The single-reference case is the common one, not the edge case: a merchant
 * importing from Shopify or WooCommerce usually has one clean packshot. Telling
 * that model only to "preserve label, shape and colors" leaves it free to invent
 * the faces it cannot see — a confidently wrong back panel on a bag, hardware on
 * a sole it never saw. So the one-reference tier does two things nothing else
 * does: it forbids invented geometry on unseen faces, and it biases the
 * composition toward the view we actually have.
 *
 * Keyed on `attached` alone — what actually reaches the engine.
 *
 * It used to also read how many images the product record held, and told the
 * model that four or more of them "cover the object from every side, so no
 * face of it has to be guessed at". Nothing checked that. An imported product
 * routinely carries one shot per colourway rather than one per angle, so the
 * products that tripped that branch were often the ones whose images were not
 * angles at all — and the claim got *more* confident the more colours a store
 * sold. A count is not evidence of coverage, so the coverage claim is gone and
 * the conservative line is the only one left.
 */
export function productFidelityDirective(attached: number): string {
  if (attached <= 1) {
    return (
      'The attached product image is the exact product: preserve its label, shape, colors and proportions faithfully, ' +
      'and do not redesign it. It is also the only view of this product that exists. Any face, side or detail not ' +
      'visible in it is unknown — keep those plain and consistent with the visible materials and color, and do not ' +
      'invent hardware, text, seams, closures, ornament or branding on them. Prefer a composition that shows the ' +
      'product from the view the reference gives.'
    );
  }
  // No angle claim either: an imported product routinely stores one image per
  // COLORWAY, and "the same product from different angles" told the model the
  // colour differences were lighting — measured as a black render of a product
  // sold in green, blue and purple. The first image is the identity authority
  // (the curation copy already teaches "use first"), so it owns the colour.
  return (
    'The attached product images all show the exact product to feature: preserve its label, shape and proportions ' +
    'faithfully, do not redesign it, and never treat an extra image as an additional product. The first product ' +
    'image is the authority for its color, finish and material. Where another image differs in color or finish, it ' +
    'shows the same product in another colorway — never blend colorways, and render the one the first image shows. ' +
    'Any face not visible in them is unknown — keep it plain and consistent with the materials the first image ' +
    'shows, and do not invent detail on it. If the direction above explicitly asks for more than one colorway, ' +
    'that explicit request wins.'
  );
}

/**
 * What a refinement is allowed to change.
 *
 * A refine used to reach the engine as a bare instruction beside a picture,
 * with nothing anywhere saying that the picture was the point. "Add one subtle
 * prop" is a complete scene brief to an image model, so it wrote a new scene:
 * the prop arrived, and so did new lighting, new shadows and a new surface.
 *
 * Both variants name the dimensions that go wrong in practice rather than
 * saying "keep everything", which a model reads as a mood. The local one also
 * releases the shadows and reflections belonging to the change, because a new
 * object that casts nothing is its own kind of wrong.
 */
/**
 * What may not move when the FRAME is what changes.
 *
 * The extend path used to drop `editPreservationDirective` entirely, on the
 * argument that its "same framing, same crop, same dimensions" lines
 * contradict a frame that is deliberately growing. True — but it left the one
 * refine that redraws every pixel (the reframe arm has no mask) with no
 * language protecting the presenter, the product, the wardrobe or the light,
 * and identity references were measured pulling the camera back to match
 * their own framing when nothing pushed against them. This variant names what
 * stays without ever claiming the frame does.
 *
 * The vocabulary rules of the expand instructions apply: grain is never
 * named, no lens or focal-length words, and nothing invites a recomposition.
 */
export function extendPreservationDirective(): string {
  return (
    'This grows the frame of a photograph that already exists; it does not restage it. The photograph in hand is ' +
    'the shot: the same person with the same face and the same clothing, the same product with the same label, ' +
    'geometry and colour, each at the same size, in the same place, under the same light. New area only continues ' +
    'the same scene past the original edges. Do not redesign the product, replace the person, change what anyone ' +
    'wears, or move the camera nearer or further away.'
  );
}

export function editPreservationDirective(
  scope: 'local' | 'global',
  opts?: { removal?: boolean; relights?: boolean },
): string {
  if (scope === 'local') {
    const removal = opts?.removal
      ? ' What is removed leaves nothing behind: the surface and the scene continue as if it had never been there, with no outline, silhouette, residue or ghost of it.'
      : '';
    return (
      'This is a change to a photograph that already exists, not a new photograph. Return the same image with ' +
      'one change made. Everything the instruction does not name comes back exactly as it is now: the same framing, ' +
      'the same crop, the same camera position, the same subject placement and pose, the same lighting, the same ' +
      'colours, the same background and the same dimensions. Do not re-render, re-stage, re-light or re-compose the ' +
      'picture. Change only what was asked for, together with the shadows, reflections and contact points that move ' +
      'with it. Every surface keeps the texture it already has: no invented pattern, grain, weave or embossing on ' +
      'fabric, skin or walls that the photograph does not carry now.' +
      removal
    );
  }
  // The texture line exists because refinement chains measured it: by the
  // fifth consecutive global refine a plain dress had grown an embossed
  // pattern no hop asked for, and skin had hardened a step per hop. A full
  // re-render invents texture unless told the surfaces are already finished.
  //
  // The light line is the same lesson one axis over. The local variant always
  // said "the same lighting"; the global one named subject, product,
  // dimensions and texture and never light, so "make the texture more
  // realistic" was free to relight the whole frame. It is pinned unless the
  // instruction itself is about light (editScopeRules: relights), in which
  // case the ask wins and nothing here argues with it.
  const light = opts?.relights ? '' : ' The light stays as it is: the same direction, colour temperature and shadows.';
  return (
    'This is a change to a photograph that already exists, not a new photograph. Apply the instruction to the image ' +
    'you were given and keep what it does not name: the same subject and the same face, the same product with the ' +
    'same label, geometry and colour, and the same dimensions. Do not replace the subject and do not redesign the ' +
    `product.${light} Every surface keeps the texture it already has: no invented pattern, grain, weave or embossing on ` +
    'fabric, skin or walls that the photograph does not carry now.'
  );
}

/**
 * Why the extra references are attached to a refinement.
 *
 * Without this the model has been handed the picture plus two more photographs
 * of things already in it, which reads as an invitation to build a new
 * composition out of all three.
 *
 * Keyed on what actually rides. The old string claimed "the same product and
 * the same person" about EVERY inherited reference - including a carried mood
 * image that may contain a stranger, whose face the sentence then handed to
 * the picture, and including product-only threads with no person at all. The
 * legacy no-argument call keeps the both-kinds sentence byte for byte.
 */
export function inheritedIdentityDirective(kinds?: { product?: boolean; person?: boolean }): string {
  const product = kinds?.product ?? true;
  const person = kinds?.person ?? true;
  if (product && person)
    return (
      'The attached product and person references are the same product and the same person that are already in ' +
      'this picture. Use them to hold that identity exact while you make the change, not as a reason to re-stage the shot.'
    );
  if (product)
    return (
      'The attached product references show the same product that is already in this picture. Use them to hold ' +
      'its identity exact while you make the change, not as a reason to re-stage the shot.'
    );
  return (
    'The attached person reference shows the same person who is already in this picture. Use it to hold their ' +
    'identity exact while you make the change, not as a reason to re-stage the shot.'
  );
}

/**
 * What a carried mood reference is for on a refinement.
 *
 * A ref token inherited from the original generation rides the edit
 * (editIdentity.ts), but the per-identity loop had no branch for it: the
 * generic inherited-identity sentence called it "the same person" while the
 * adapter called it composition-only - two claims about one image that may
 * contain a stranger's face. This states the scope once, in the compiler's
 * own voice, after the identity claim so it wins positionally.
 */
export function inheritedRefDirective(): string {
  return (
    'The carried reference is attached for composition, lighting and treatment only. Any person or product ' +
    'visible in it lends mood, never identity — nobody and nothing in this photograph takes a face, a body or ' +
    'a design from it.'
  );
}

/**
 * The facts a product record states about itself, byte for byte as the
 * compiler has always emitted them — lifted out of the token loop so a
 * refinement can state the same facts about an identity it inherited. The
 * golden showcase fixture is the proof the lift moved nothing.
 */
export function productFactDirectives(p: any): string[] {
  const out: string[] = [];
  if (p.preservationNotes) out.push(String(p.preservationNotes));
  if (p.negativeConstraints) out.push(`Avoid: ${p.negativeConstraints}`);
  // Two spellings reach here: demo products ship `materials` /
  // `primaryColors` as descriptive prose, catalog imports supply a
  // singular `material`. Read both rather than silently honouring one.
  const materials = p.materials ?? p.material;
  if (materials) out.push(`Its materials and finish: ${materials}.`);
  if (p.primaryColors) out.push(`Its actual colors: ${p.primaryColors}.`);
  // An imported product that sells in several colours names them, so the
  // model knows a colour difference between references is a colorway and not
  // lighting — and which one this shot renders.
  if (Array.isArray(p.colorways) && p.colorways.length)
    out.push(
      `It is sold in these colorways: ${p.colorways.join(', ')}. The one in this shot is the colorway the first product image shows.`,
    );
  if (p.dimensions)
    out.push(`Its real-world size is ${p.dimensions} — keep it at true scale relative to everything else in frame.`);
  return out;
}

/** Same lift for a presenter's own identity metadata. */
export function characterFactDirectives(c: any): string[] {
  const out: string[] = [];
  if (c.identityNotes) out.push(String(c.identityNotes));
  if (c.negativeConstraints?.length) out.push(`Avoid: ${[].concat(c.negativeConstraints).join(', ')}`);
  return out;
}

/**
 * What a refinement's inherited references are FOR, named per identity.
 *
 * The generic inherited-identity sentence says the references are the same
 * product and person; nothing said what must hold. The generation-tier
 * fidelity language never reached a refine — measured as the fidelity drop
 * the file header of editIdentity.ts records — so refinements state the
 * contract themselves, in edit terms: the photograph is the composition, the
 * references are what the identity must stay true to.
 */
export function productEditFidelityDirective(name: string): string {
  return (
    `Every attached product reference shows ${name}, the exact product already in this photograph: hold its label, ` +
    'shape, colours and proportions to what the references and the photograph agree on while you make the change, ' +
    'and never treat an extra angle as a second product. Any face of it no reference shows stays exactly as the ' +
    'photograph already has it.'
  );
}

export function characterEditIdentityDirective(name: string): string {
  return (
    `${name} is the person in this photograph: keep them present and clearly visible. Match their face, facial ` +
    "structure, skin, hair and build to the attached person reference exactly. The reference's plain outfit and " +
    'studio backdrop are capture conditions, not direction: keep the styling this photograph already has unless the ' +
    'instruction itself changes it, and never return them to the plain base layers they were photographed in.'
  );
}

/**
 * Presenter over reference, for identity.
 *
 * A hand-attached reference with no presenter may deliberately carry a person
 * ("use the person from this reference") and the neutral role directive keeps
 * that case working. The moment a presenter is attached, the structured
 * selection is the identity authority and a reference goes back to being what
 * its role says: composition, lighting, treatment. Nothing else in the prompt
 * said this, so "match their face exactly" (the presenter) and "match this
 * image" (the reference) rode side by side with nothing disowning the face in
 * the reference. Prompt-side only; the escape is removing the presenter chip,
 * at which point this is never emitted.
 */
export function referenceIdentityGuard(): string {
  return (
    'A reference shot lends its composition, lighting and treatment, never its cast: the attached presenter is ' +
    'the only source of person identity in this shot, and any person visible in a reference shot is a stand-in ' +
    'whose place the presenter takes. This holds even where the direction asks to use someone from a reference — ' +
    'the attached presenter is that someone.'
  );
}

export function markEditDirective(): string {
  return (
    "The attached brand mark is this brand's own mark: wherever the logo appears or the instruction asks for it, " +
    'reproduce it exactly as drawn — same colours, letterforms and proportions — never redrawn or re-lettered. ' +
    'Every character it carries stays intact, including the smallest secondary lettering, in its original script ' +
    'and reading direction — never translated, transliterated or re-spelled.'
  );
}

/**
 * The rendering floor for every person in every frame.
 *
 * Presenters came back waxy, plastic, or HDR-glossy often enough to be a
 * reported class of failure, and the audit found why it was "sometimes": 24
 * catalog scenes ask for "immaculate commercial-render clarity" and its
 * variants (written for products, harmless there), two portrait scenes
 * commanded editorial retouch outright, and nothing anywhere stated what skin
 * must look like. This is that statement, adapted from the STUDIO_SET
 * paragraph that already governs presenter reference synthesis
 * (customAssets.ts) - deliberately duplicated rather than shared, because
 * that prompt is frozen and moving it would move every future presenter.
 *
 * Emitted whenever a person is in frame, and only then, so the product scenes
 * keep their render-crisp language for the frames that are actually renders
 * of objects. Physically grounded on purpose: a hard flash MAY shine on skin.
 * The last clause is the escape hatch every compiler directive carries -
 * explicit direction wins, so a deliberately stylised person stays possible.
 */
export function personSkinDirective(): string {
  return (
    'Every person in this photograph has real photographed skin: fine natural texture at pore scale, faint lines ' +
    'and natural asymmetry left intact, true-to-life proportions, never airbrushed, waxy, plastic or ' +
    'synthetic-looking. Light behaves physically on it: a hard flash or a specular key may genuinely shine on skin, ' +
    'but the surface underneath stays living skin in a photograph, never gloss, never a render. Any retouch, ' +
    'clarity or sharpness language in the direction above is about finish and focus, never a licence to smooth skin ' +
    'beyond what a professional photograph holds; if the direction above explicitly asks for a stylised or ' +
    'non-photographic treatment of the person, that explicit request wins.'
  );
}

/**
 * How a person and a product physically meet.
 *
 * No anatomy or contact language existed anywhere in the compiler, and the
 * reported failures are the classic set: products floating beside hands,
 * fingers passing through packaging, a cream jar at basketball scale in a
 * palm. One positive statement of real handling, emitted with the existing
 * pair directives (product AND person attached) - never a negative-prompt
 * boilerplate list, and with the same explicit-direction escape hatch, so a
 * surreal brief that wants the bottle floating still gets it.
 */
export function productHandlingDirective(): string {
  return (
    'Where the presenter touches the product, they handle it the way a real person handles an object of exactly ' +
    'that size and weight: a natural grip, fingers wrapping in genuine contact with its surface, hand and wrist at ' +
    'anatomically real angles, the product supported by that grip rather than floating. If the direction above ' +
    'explicitly stages the product away from their hands or in an impossible way, that explicit direction wins.'
  );
}

/**
 * A garment with nobody attached is a product, not an outfit.
 *
 * Apparel briefs that carried no presenter produced an invented wearer: a
 * fully bodied figure with a void inside the raised hood in one battery frame,
 * and an empty jacket floating with no support in another. Nobody asked for a
 * person, so the model split the difference and drew most of one.
 *
 * One sentence, emitted only for apparel category products when no presenter
 * is attached and only for generations: a refinement already has a picture
 * whose staging is settled. The direction can still ask for it worn, and then
 * its own words outrank this.
 */
export function garmentDisplayDirective(): string {
  return (
    'No person is part of this brief. Present the garment as a product, laid, hung, folded or dressed on a plain ' +
    'form, never on a person, a partial figure or an invisible body, unless the direction above explicitly asks ' +
    'for it worn.'
  );
}

/**
 * The general case of the garment line: a product with nobody attached is
 * photographed on its own.
 *
 * Thirteen demo product records carry their own "no props, hands, or
 * presenter in frame" in their negative constraints, which is why demo QA
 * never met this. An imported product carries no such note, and a
 * product-only brief on a custom scene kept coming back with a person in it
 * (a flower field, a serum, nobody asked for). Nothing anywhere said the
 * product was alone. Same shape as the garment line: state the rule, carry
 * the escape clause in the same sentence, so "held in one hand" still works.
 * Emitted only for generations; a refinement's picture has its staging.
 */
export function soloProductDirective(): string {
  return (
    'No person is part of this brief. The product is photographed on its own: no model, no hand, no partial figure ' +
    'and no silhouette or reflection of anyone presenting it, unless the direction above explicitly asks for a ' +
    'person, a hand or a model.'
  );
}

/**
 * Does the shot direction already decide the camera?
 *
 * Camera belongs to the shot; a Scene may only express a tendency. Rather than
 * emit both and let them argue in prose — which is how a scene that mentions
 * 50mm ends up beating a recipe asking for an 85mm macro — the compiler emits
 * exactly one. If the direction speaks about lens, distance, height, framing or
 * depth, the scene's tendency is dropped entirely and there is no conflict to
 * resolve.
 *
 * Deliberately generous: a false positive costs only the scene's default, while
 * a false negative would put two cameras in one prompt.
 */
export function shotSpecifiesCamera(text: string): boolean {
  // "closeup" (one word) and "DOF" are how people actually type these; the
  // reported adherence failure spelled both ways the old pattern missed.
  return /\b\d{2,3}\s?mm\b|\bf\/\d|\blens\b|\bcamera\b|\bshot from\b|\beye[- ]level\b|\blow angle\b|\bhigh angle\b|\boverhead\b|\btop[- ]down\b|\bbird'?s[- ]eye\b|\bclose[- ]?up\b|\bmacro\b|\bwide shot\b|\bcrop(?:ped)?\b|\bframing\b|\bDOF\b|\bdepth of field\b|\bbokeh\b|\bshallow (?:focus|depth)\b|\bdeep focus\b/i.test(
    text,
  );
}

/**
 * Does the shot direction already decide the light?
 *
 * The camera rule, one axis over. Read against the user's OWN words only,
 * never the compiled sentence: 71 of 72 catalog scene prompts name their
 * light, so a gate that read the sentence would silence every scene. Same
 * generosity as the camera: a false positive only drops the scene's default
 * line, a false negative would put two lights in one prompt. Bare "key",
 * "fill", "warm" and "cool" are left out on purpose ("key visual", "fill the
 * frame", "a warm cup"), and so are the nouns the showcase recipes measured
 * as objects rather than light: a cap or lens "rim", an aloe "gel", spray
 * "mist", a table "lamp", and "sun" inside a hyphenated compound
 * ("sun-stick", "sun-cracked"). Their light senses stay: "rim light",
 * "gelled", "misty", "lamplight", "low sun".
 */
export function shotSpecifiesLight(text: string): boolean {
  return /\blight(?:s|ing|ed)?\b|\blit\b|\bflash\b|\bstrobe\b|\bspot ?light\b|\bsoft ?box\b|\bgelled\b|\bcolou?r gels?\b|\bback ?lit\b|\bbacklight\b|\brim[- ]?li(?:ght|t)\b|\bglow(?:ing)?\b|\bneon\b|\bgolden hour\b|\bblue hour\b|\bsun\b(?!-)|\bsun(?:set|rise|light|lit|ny)\b|\bdusk\b|\bdawn\b|\bnight(?:time)?\b|\bmidday\b|\bnoon\b|\bovercast\b|\bcloudy\b|\bdaylight\b|\bmoon(?:lit|light)\b|\bcandle(?:lit|light)?\b|\blamp[- ]?li(?:ght|t)\b|\bshadow(?:s|ed|y)?\b|\bsilhouette[ds]?\b|\bhigh[- ]key\b|\blow[- ]key\b|\bchiaroscuro\b|\bexposure\b|\b(?:over|under)exposed\b|\bwhite ?balance\b|\bcolou?r temperature\b|\b\d{4} ?k\b|\bdiffused?\b|\bbounced?\b|\bpracticals\b|\b(?:the|a|one|low|warm|single) practical\b|\btungsten\b|\bfluorescent\b|\bfoggy\b|\bmisty\b|\bhazy\b/i.test(
    text,
  );
}

/**
 * Who owns the light.
 *
 * Scene = illumination, product references = identity and material, and the
 * compiler says so. Before this nothing did: Scene.lighting, the one
 * structured light phrase every catalog scene carries and the analyzer is
 * required to write, reached the plate draw, the cards and the search index
 * and never a generation prompt; and where a presenter's reference has always
 * been released ("their lighting is neutral studio capture conditions") the
 * product's packshot never was, so its softbox rode into the finished frame
 * and a good render sat pasted into a good scene.
 *
 * Two short lines, in the register the camera line already uses.
 *   - the WORLD line, `Light for this shot: <scene.lighting>.`, when a scene
 *     is in the brief, something is attached to be lit, the direction did not
 *     choose the light itself, and no hand-attached reference already owns it
 *     (its directive says "match the composition, lighting and treatment",
 *     and a catalog default must not outrank a deliberate attachment);
 *   - the PRODUCT release, when a product photo rides and there is a world to
 *     take light from (a scene or a reference). No scene and no reference
 *     means the packshot's light is the best evidence the model has, so the
 *     plain packshot path stays byte-identical.
 * A presenter and a product attached together get one clause tying them to
 * the same light. Generation only: a refinement's picture already holds it.
 */
export function lightingContractDirectives(opts: {
  /** The scene's `lighting` phrase; '' when no scene is in the brief. */
  sceneLighting: string;
  /** shotSpecifiesLight over the user's own text tokens, never the compiled sentence. */
  directionLights: boolean;
  /** A reference token rides: it is a world of its own. */
  hasReference: boolean;
  /** A product or presenter is in the brief, so there is something to light. */
  hasIdentity: boolean;
  /** A product photo actually rides, so the release names a real picture. */
  productRides: boolean;
  hasPerson: boolean;
}): string[] {
  const lighting = opts.sceneLighting.trim().replace(/[.\s]+$/, '');
  const out: string[] = [];
  if (lighting && !opts.directionLights && !opts.hasReference && opts.hasIdentity)
    out.push(`Light for this shot: ${lighting}.`);
  if (opts.productRides && (lighting || opts.hasReference))
    out.push(
      "The product reference photographs define the product's identity and materials, never the light they were " +
        "taken in: light it as physically present in this set, with this set's key direction, softness, colour " +
        'temperature and exposure on its surfaces, its bounce and reflections, and its own cast and contact shadows, ' +
        'label and form still readable.' +
        (opts.hasPerson ? ' The presenter and the product stand in that same light.' : ''),
    );
  return out;
}

/**
 * A figure the concept needs, bound to whoever is actually attached.
 *
 * Only a custom scene carries `figure`, and only when its references showed a
 * person the concept depends on - so every catalog scene emits nothing here and
 * every compiled prompt in the golden fixture is untouched by this existing.
 *
 * There is deliberately no attempt to detect whether the shot wants people. The
 * shot's own words sit at the head of the prompt and every directive follows
 * them, so a directive always outranks them positionally; guessing when to stay
 * quiet would mean guessing at negation in free text, and a false positive kills
 * the feature silently. The house answer to this is `garmentDisplayDirective`:
 * state the rule, and carry the escape clause inside the same sentence.
 */
/**
 * A name in the brief says what to show, never what to write. Measured on
 * codex: two products named in the sentence came back as gold lettering on
 * the wall in four of four outputs, because nothing said the names were not
 * signage. The product's own printed packaging is the one exception, and it
 * is already governed by the fidelity directive.
 */
export function namesAreNotLetteringDirective(): string {
  return (
    'The names in this brief identify what to show and are never text to render: no caption, label, signage, ' +
    "engraving or lettering spells a product name or a person's name, in any language or script, anywhere in the " +
    'picture. Printing that is ' +
    "part of a product's own packaging stays exactly as photographed, and nothing else spells a name unless the " +
    'direction above explicitly asks for it to be written.'
  );
}

export function sceneFigureDirectives(opts: {
  figure: string;
  treatment?: string;
  hasPerson: boolean;
  /** How many presenters are attached; the figure is a role one of them takes, the rest stand with them. */
  people?: number;
  hasMark?: boolean;
  /** A product is attached, so with nobody attached it is what takes the figure's place. */
  hasProduct?: boolean;
}): string[] {
  const figure = opts.figure.trim().replace(/[.\s]+$/, '');
  if (!figure) return [];
  const treatment = (opts.treatment ?? '').trim().replace(/[.\s]+$/, '');
  const out: string[] = [];

  if (opts.hasPerson && (opts.people ?? 1) > 1) {
    // Several presenters, one figure position: the first named takes it and
    // the others share the frame. Said explicitly, because "one figure, never
    // a second person" composed the second presenter out three times in four.
    out.push(
      `This world is built around one figure: ${figure}. The attached presenters share that role: the first named ` +
        'presenter takes the figure position and the others stand with them in the same frame, every one of them ' +
        'clearly visible. Any person the scene direction describes IS one of the attached presenters and never an ' +
        'extra person, and each identity comes from their own attached photograph alone, never from anything the ' +
        'scene direction says about a body.',
    );
  } else if (opts.hasPerson) {
    // Presence is already a fact by the time this is read: personDirectives says
    // the presenter is in the photograph. This only says WHAT PART they play,
    // and re-anchors identity so a figure the scene described is never a second
    // person.
    out.push(
      `This world is built around one figure: ${figure}. The attached presenter is that figure. ` +
        'Any person the scene direction describes IS the presenter and never a second person, and their identity comes ' +
        'from their own attached photograph alone, never from anything the scene direction says about a body.',
    );
  } else {
    // The presenter chip is the only WHO authority. This used to fill the
    // role with an anonymous invented person, on the argument that a
    // figure-led scene drawn empty is a different scene; a user's product-only
    // shot on a custom scene then kept coming back with someone in it, and
    // every custom scene in a real library carried a figure. Unpopulated by
    // default: the figure's placement and scale still shape the frame, the
    // product stands where the figure stood, and the direction can still ask
    // for someone. A treatment scene already carries its own nobody-in-frame
    // reconciliation below, which this agrees with word for word.
    const stands = opts.hasProduct
      ? "the attached product takes the figure's placement and scale in the frame"
      : 'the frame is composed for that placement and scale and holds the set alone';
    out.push(
      `This world is built around one figure: ${figure}. No presenter is attached, so this world is photographed ` +
        `unpopulated: no person, hand or silhouette stands in for that figure, and ${stands}, ` +
        'unless the direction above asks for someone.',
    );
  }

  if (treatment) {
    // The reconciliation, said out loud, in the shape pairDirectives uses for
    // the packshot bans: name the scope of the earlier instruction rather than
    // contradicting it. A presenter's directives lock "their face, facial
    // structure, skin, hair and build", and 19 of 21 curated presenters carry
    // notes saying a feature "must survive every generation". Both stay true:
    // they are claims about WHO the person is, and a treatment is a layer over
    // that person, not a different person.
    const who = opts.hasPerson
      ? 'The face and body underneath are still exactly theirs - same structure, same proportions, same build - and any ' +
        'earlier instruction that their features must survive unchanged is a rule about who they are, which this does not alter. '
      : '';
    // Presence is a claim about the attached presenter. With nobody attached
    // the unpopulated line above says the opposite, so this stays unsaid and
    // the nobody-in-frame reconciliation further down carries the treatment.
    const present = opts.hasPerson
      ? 'The figure is bodily present and in shot: where the treatment covers or hides them, that is the photograph working ' +
        'as intended and never a reason to leave them out, crop them away, or reduce them to a shadow. '
      : '';
    out.push(
      `The art direction of this world is what has been done to that figure: ${treatment}. ` +
        'Render it as a real physical treatment, following the shape of the face and body it sits on rather than floating ' +
        'in the frame. ' +
        // Density is not distribution. "Scattered, loosely spaced" was read as
        // a dozen pieces massed on one cheek: correct spacing, wrong spread.
        // Where it reaches has to be said separately from how much there is.
        'Spread it across the whole form the way the reference does, reaching every part it covers there - brow, ' +
        'forehead, nose, both cheeks, jaw - instead of massing it in one area and leaving the rest untouched. ' +
        // Reaching wide and staying light are not in tension, but asking for
        // reach alone was read as permission to fill: spread went right and
        // the count tripled. How far it goes and how much there is have to be
        // stated as two separate things, or fixing one breaks the other.
        'Reaching wide is not the same as covering more: keep the number of pieces and the bare surface between ' +
        'them exactly as the description says, so a sparse treatment stays sparse while still touching every part ' +
        'of the form. ' +
        'Each piece sits on the plane beneath it, curving and catching light with the surface it is stuck to. ' +
        `${who}${present}` +
        // The treatment is the art direction, not a property of the person. Ask
        // for this world with no people in it and the stickers should still be
        // there, on whatever the frame does hold - that IS the scene. Suppressing
        // them left a plain product on a plinth with nothing of the scene in it.
        'If no person appears in this shot, the treatment does not go with them: it is what this world looks like, so ' +
        'it applies to whatever the frame does hold - the product, the surfaces, the set - as real pieces resting on ' +
        'those things. Applied on top, never redesigning them: the product keeps the exact form, colour, material and ' +
        'its own printed label that its reference shows, with the treatment sitting over it. ' +
        // Two failures were fixed here in turn. Banning all printing produced
        // bare pastel paper; demanding unreadable lettering then produced
        // scribble. Neither is brand safety, they are just bad graphics. What
        // this needs is print that looks designed, belonging to companies that
        // do not exist.
        'Where the treatment carries printing, render it as genuinely designed print: real letterforms, readable words, ' +
        'numerals, illustration and colour, at the quality of commercial label artwork. Invent the companies - every ' +
        'name, logotype and piece of packaging artwork must be plausible but fictional, resembling no existing brand. ' +
        // "Invent" was read as "vary": a real mark visible in the reference
        // came back with a word bolted on, which is the same brand wearing a hat.
        'That includes near-misses: do not borrow, extend or re-spell a name that appears in any attached reference, ' +
        'and use ordinary words for the produce itself rather than any company that sells it.' +
        // The fictional-brands rule and an attached brand mark are in direct
        // conflict without this: "resembling no existing brand" reads as an
        // instruction to mutate the one real mark the user deliberately
        // attached. Same shape as pairDirectives' packshot override - name the
        // scope of the earlier rule, carry the exception in the same breath.
        (opts.hasMark
          ? " The one exception is the attached brand mark: it is this brand's own real mark, deliberately attached, " +
            'so the fictional-brands rule above does not apply to it. Where the direction asks for that mark to appear, ' +
            'it appears exactly as drawn - every character, including the smallest lettering, in its original script - ' +
            'never redrawn, re-lettered, translated or fictionalised.'
          : ''),
    );
  }
  return out;
}

/**
 * A scene contributes text to a shot - and, when it is built around a figure,
 * one reference photograph too (brief.ts). Its prose can still name a product
 * or wardrobe brand of its own (for demo purposes), and its photograph can
 * still show one. When a real product or presenter is attached alongside it,
 * these directives are appended last so they outrank whatever the scene's own
 * text described - and, when the scene's photograph survived the attachment
 * budget, whatever that photograph stages.
 */
export function sceneGuardDirectives(opts: {
  hasProduct: boolean;
  hasPerson: boolean;
  hasScenePhoto?: boolean;
}): string[] {
  const out: string[] = [];
  if (opts.hasProduct) {
    out.push(
      'Disregard any product, bottle, package, or brand name described in the scene direction above — the only product in this image is the one shown in the attached product photo; do not substitute, redesign, invent, or merge it with anything named in the scene text.',
    );
  }
  if (opts.hasPerson) {
    out.push(
      'Disregard any wardrobe, accessory, or garment brand named in the scene direction above — dress the attached person reference only in the generic material and color terms described; do not print, stitch, or render any brand name or wordmark from the scene text onto them.',
    );
    // A scene's prose describes a SET, and set copy is often written empty:
    // two catalog scenes literally say "no people". Without this line that
    // wording quietly composed an explicitly attached presenter out of their
    // own shot — the reported adherence failure.
    out.push(
      'The scene direction above describes the set, not the cast. If it says the space is empty or that no people appear, disregard that: the attached person stands in this set, clearly visible. ' +
        'A ban on props or extra objects in the scene direction is about set dressing only — it never applies to the presenter or to the product in their hands.',
    );
  }
  // A figure-led scene attaches one photograph (brief.ts), and a photograph of
  // a staged demo is more vivid than any prose about it. The guards above are
  // scoped to "the scene direction" — a model reads that as the words, never
  // the picture — so the picture needs its own disowning, said about the
  // photograph by name. The treatment carve-out rides in the same breath so
  // this can never argue with the figure directives above it.
  if (opts.hasScenePhoto && (opts.hasProduct || opts.hasPerson)) {
    out.push(
      "One attached reference is the scene's own photograph. It shows this world — the set, the light, and any treatment this world applies — never a cast: any product, garment, prop or person visible in it is a stand-in, demonstrating where the subject sits, how large it stands in the frame, and what has been done to it.",
    );
    if (opts.hasProduct) {
      out.push(
        "The product in the scene photograph is not in this shot. The attached product photo is the only source of product identity: that exact product takes the stand-in's position, at the placement and scale the scene photograph demonstrates, keeping its own shape, label and colours.",
      );
    }
    if (opts.hasPerson) {
      out.push(
        'Any person in the scene photograph lends their role, never their face: the attached presenter takes their place, wearing whatever treatment this world applies, with their identity drawn from their own photographs alone.',
      );
    }
  }
  return out;
}

/**
 * The brand's standing rules, as directives.
 *
 * Unconditional, and the only thing about a brand that is. A rule the user
 * wrote is a boundary, not taste: it cannot override a creative request, it
 * only stops the model doing something they already said they never want. That
 * is why it needs no token, while everything else about a brand does.
 *
 * What a brand contributes to a picture — its colours, its mark — arrives the
 * same way a product or a scene does: as a chip the user placed. This used to
 * also emit the palette, mood, keywords and things-to-avoid behind a `brand`
 * token, which put a second, vaguer statement of the palette beside the colour
 * chip that already said it better, and asked users for art direction nobody
 * could write. Both are gone; `imagery.*` and `palette.usage` stay in the
 * format and in the export, they simply no longer reach a prompt.
 *
 * The lines are prefixed "Brand ..." on purpose: `dedupe` is exact-string and
 * first-occurrence-wins, so an unprefixed prohibition could silently collapse
 * into a product's own "Avoid:" line and be read as being about the product.
 */
export function brandRuleDirectives(brand: any): string[] {
  const out: string[] = [];
  const rules = brand?.rules ?? {};
  const never = (Array.isArray(rules.never) ? rules.never : [])
    .map((x: unknown) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, 24);
  if (never.length) out.push(`Brand rules — never: ${never.join(', ')}.`);
  // Prose is written by hand and rarely ends in punctuation; directives are
  // space-joined, so without this it fuses into whatever follows.
  const notes = String(rules.notes ?? '')
    .trim()
    .slice(0, 600);
  if (notes) out.push(`Brand rules: ${/[.!?]$/.test(notes) ? notes : `${notes}.`}`);
  return out;
}

const MARK_ROLE_LABEL: Record<string, string> = {
  primary: 'logo',
  mark: 'mark',
  wordmark: 'wordmark',
  monochrome: 'monochrome logo',
  alternate: 'alternate logo',
};

/** Display name for an attached brand mark, e.g. "Acme Coffee wordmark". */
export function markLabel(brand: any, logo: any): string {
  const kind = MARK_ROLE_LABEL[String(logo?.role ?? '')] ?? 'logo';
  const name = String(brand?.meta?.name ?? '').trim();
  return name ? `${name} ${kind}` : `Brand ${kind}`;
}
