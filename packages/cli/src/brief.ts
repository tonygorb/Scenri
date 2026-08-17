import type { EngineCapabilities, Core } from '@scenri/core';
import { composePrompt, type Scene } from './scenes.js';

/**
 * A brief is the request as the user wrote it: prose interleaved with typed
 * tokens. It compiles to exactly one prompt string plus attachments, so what
 * the composer previews and what the engine receives can never drift.
 */
export type BriefToken =
  | { t: 'text'; v: string }
  | { t: 'product'; id: string; angle?: string }
  | { t: 'character'; id: string }
  | { t: 'color'; hex: string; name?: string }
  | { t: 'ref'; imageHash: string }
  | { t: 'mark'; imageHash: string }
  | { t: 'template'; id: string }
  | { t: 'format'; id: FormatId; w: number; h: number };

export type FormatId = 'square' | 'story' | 'landscape' | 'portrait';

export interface Brief {
  tokens: BriefToken[];
  templateId?: string;
  templateFields?: Record<string, string>;
}

/**
 * Per-role reference budgets, independent of the engine cap.
 *
 * These stop one token starving another: without them a product with six
 * catalogued angles would consume the entire engine budget and evict the
 * presenter's face. The engine cap is applied afterwards, in role-priority
 * order, so what survives a tight cap is always identity before inspiration.
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
  return (
    'The attached product images all show the exact same product from different angles: preserve its label, shape ' +
    'and colors faithfully, do not redesign it, and do not treat the extra angles as additional products. ' +
    'Any face not visible in them is unknown — keep it plain and consistent with the visible materials, and do not ' +
    'invent detail on it.'
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
  return /\b\d{2,3}\s?mm\b|\bf\/\d|\blens\b|\bcamera\b|\bshot from\b|\beye[- ]level\b|\blow angle\b|\bhigh angle\b|\boverhead\b|\btop[- ]down\b|\bbird'?s[- ]eye\b|\bclose[- ]up\b|\bmacro\b|\bwide shot\b|\bcrop(?:ped)?\b|\bframing\b|\bdepth of field\b|\bbokeh\b|\bshallow (?:focus|depth)\b|\bdeep focus\b/i.test(
    text,
  );
}

export const PRODUCT_REF_MAX = 3;
export const CHARACTER_REF_MAX = 2;

export interface Attachment {
  /**
   * Why this image is attached. The engine turns each role into a directive, so
   * a role is the only thing stopping an image influencing a dimension it was
   * never meant to: a colour-inspiration shot must not drive composition, and a
   * composition reference must not recolour the product. `reference` is kept as
   * the untyped legacy role for briefs authored before roles were split.
   */
  role: 'product' | 'character' | 'brand' | 'scene' | 'composition' | 'style' | 'reference';
  /**
   * The id of the product or presenter this image came from, when it came from
   * one. Callers correlate a compiled attachment back to the chip that asked
   * for it; without this the only handle was `label`, i.e. a display string —
   * which mis-matched whenever two entries shared a name, and breaks outright
   * once a label is free to differ from the name the compiler wrote.
   * Absent for `ref`/`brand` attachments, which have no catalog entry.
   */
  id?: string;
  label: string;
  hash: string;
  /**
   * True for the FIRST reference of each product/presenter — the one that
   * actually carries the identity. Extra angles are corroboration: valuable,
   * but droppable under a tight engine cap. Losing an essential attachment
   * means the generation can no longer show the right subject at all, and the
   * caller should refuse rather than produce a confident wrong answer.
   */
  essential?: boolean;
}

export interface CompiledBrief {
  prompt: string;
  referenceImages: string[];
  /**
   * Attachments the engine cap forced out, in role-priority order. Callers
   * must inspect this: a dropped `reference` is a cosmetic loss, but a dropped
   * `product` or `character` means the generation can no longer be faithful to
   * the identity the user selected, and should be refused rather than run.
   */
  dropped: Attachment[];
  width: number;
  height: number;
  attachments: Attachment[];
  warnings: string[];
  productId: string | null;
}

export const FORMATS: { id: FormatId; label: string; w: number; h: number }[] = [
  { id: 'square', label: 'Square 1:1', w: 1024, h: 1024 },
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920 },
  { id: 'landscape', label: 'Landscape 16:9', w: 1600, h: 900 },
  { id: 'portrait', label: 'Portrait 4:5', w: 1024, h: 1280 },
];

interface CompileContext {
  brand: any;
  images: Core['images'];
  engineCaps: EngineCapabilities;
  /** Legacy single scene (brief.templateId). Frames the whole prompt. */
  template?: Scene;
  /** Lookup for inline scene tokens, which compile where they sit. */
  templateById?: (id: string) => Scene | undefined;
}

const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

/**
 * A scene only ever contributes text, never an image, but its prose can
 * still name a product or wardrobe brand of its own (for demo purposes). When
 * a real product or presenter is attached alongside it, these directives are
 * appended last so they outrank whatever the scene's own text described.
 */
export function sceneGuardDirectives(opts: { hasProduct: boolean; hasPerson: boolean }): string[] {
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

/**
 * Structural validation at the API boundary.
 *
 * `compileBrief` is deliberately forgiving — it warns and carries on so one
 * bad chip never costs the user the whole sentence. That is right for
 * recoverable trouble, but a malformed payload is not recoverable: it means
 * the caller is broken, and returning a plausible image for a brief we could
 * not read is exactly the "confidently wrong" failure this system exists to
 * prevent. So the boundary rejects, and the compiler forgives.
 */
export function validateBrief(brief: unknown): string[] {
  const errors: string[] = [];
  const b = brief as { tokens?: unknown } | null;
  if (!b || typeof b !== 'object') return ['brief must be an object'];
  if (!Array.isArray(b.tokens)) return ['brief.tokens must be an array'];

  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  b.tokens.forEach((raw, i) => {
    const at = `tokens[${i}]`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }
    const t = raw as Record<string, unknown>;
    switch (t.t) {
      case 'text':
        if (typeof t.v !== 'string') errors.push(`${at}.v must be a string`);
        break;
      case 'product':
        if (!str(t.id)) errors.push(`${at}.id must be a non-empty string`);
        if (t.angle !== undefined && !str(t.angle)) errors.push(`${at}.angle must be a non-empty string`);
        break;
      case 'character':
      case 'template':
        if (!str(t.id)) errors.push(`${at}.id must be a non-empty string`);
        break;
      case 'color':
        if (!str(t.hex) || !/^#[0-9a-fA-F]{6}$/.test(String(t.hex))) errors.push(`${at}.hex must be a #RRGGBB color`);
        break;
      case 'ref':
      case 'mark':
        if (!str(t.imageHash)) errors.push(`${at}.imageHash must be a non-empty string`);
        break;
      case 'format':
        if (!Number.isFinite(t.w) || !Number.isFinite(t.h) || Number(t.w) <= 0 || Number(t.h) <= 0)
          errors.push(`${at} must carry positive numeric w and h`);
        break;
      default:
        errors.push(`${at}.t "${String(t.t)}" is not a supported token kind`);
    }
  });
  return errors;
}

/** Deterministic: same brief + same context always yields the same request. */
export function compileBrief(brief: Brief, ctx: CompileContext): CompiledBrief {
  const warnings: string[] = [];
  const attachments: Attachment[] = [];
  const productDirectives: string[] = [];
  const personDirectives: string[] = [];
  const otherDirectives: string[] = [];
  let width = 1024;
  let height = 1024;
  let productId: string | null = null;

  const products: any[] = ctx.brand?.products ?? [];
  const characters: any[] = ctx.brand?.characters ?? [];
  const inlineTemplates: Scene[] = [];
  let hasPerson = false;
  let sentence = '';
  // Tokens compile independently and never know what text preceded them, so
  // every append goes through here to guarantee a separating space — raw
  // concatenation (e.g. a product name directly followed by scene prose)
  // otherwise fuses into one run-on word.
  const append = (s: string) => {
    sentence += (sentence && !sentence.endsWith(' ') ? ' ' : '') + s;
  };

  for (const tok of brief.tokens) {
    switch (tok.t) {
      case 'text':
        append(tok.v);
        break;

      case 'product': {
        const p = products.find((x) => x.id === tok.id);
        if (!p) {
          warnings.push('A product in this brief is no longer in the brand kit.');
          break;
        }
        productId = p.id;
        // `promptName` is the frozen descriptive noun phrase; `name` is the
        // short label the UI shows. The model needs the former — it is the
        // only text in the whole prompt saying what the object is.
        append(p.promptName ?? p.name);
        // A specific angle (e.g. "detail" for a macro shot, "worn-scale" for
        // an on-body shot) beats the default first shot when the recipe asks
        // for one; falls back silently if that angle isn't available.
        const primary = (tok.angle && p.shots?.find((s: any) => s.angle === tok.angle)) || p.shots?.[0];
        // Geometry, proportions and label placement need more than one view —
        // a single frontal shot leaves the model guessing at depth and at any
        // face of the product it cannot see. Send the requested angle first
        // (it is the one the recipe cares about), then up to PRODUCT_REF_MAX-1
        // further distinct angles for corroboration.
        const orderedShots = [primary, ...(p.shots ?? []).filter((s: any) => s && s !== primary)];
        const phashes: string[] = [];
        for (const s of orderedShots) {
          if (phashes.length >= PRODUCT_REF_MAX) break;
          const h = assetHash(s?.file);
          if (h && ctx.images.has(h) && !phashes.includes(h)) phashes.push(h);
        }
        if (phashes.length) {
          phashes.forEach((h, i) => {
            attachments.push({ role: 'product', id: p.id, label: p.name, hash: h, essential: i === 0 });
          });
          productDirectives.push(productFidelityDirective(phashes.length));
          if (p.preservationNotes) productDirectives.push(String(p.preservationNotes));
          if (p.negativeConstraints) productDirectives.push(`Avoid: ${p.negativeConstraints}`);
          // Real-world scale and material, when the product record knows them.
          // A model given no size cue will happily render a watch the size of
          // a dinner plate in a wide shot; stating the physical facts is the
          // cheapest correction available.
          // Two spellings reach here: demo products ship `materials` /
          // `primaryColors` as descriptive prose, catalog imports supply a
          // singular `material`. Read both rather than silently honouring one.
          const materials = p.materials ?? p.material;
          if (materials) productDirectives.push(`Its materials and finish: ${materials}.`);
          if (p.primaryColors) productDirectives.push(`Its actual colors: ${p.primaryColors}.`);
          if (p.dimensions)
            productDirectives.push(
              `Its real-world size is ${p.dimensions} — keep it at true scale relative to everything else in frame.`,
            );
        } else {
          warnings.push(`${p.name} has no usable photo, so it is named but not attached.`);
        }
        break;
      }

      case 'character': {
        const c = characters.find((x) => x.id === tok.id);
        if (!c) {
          warnings.push('A presenter in this brief is no longer in your roster.');
          break;
        }
        hasPerson = true;
        // Same two-name contract products have: the model reads `promptName`
        // where there is one, humans read `name`. A curated presenter has no
        // promptName and is named by `name`, which is why renaming one is a
        // generation change; a person built here freezes a promptName at
        // creation so their display name stays free to edit.
        append(c.promptName ?? c.name);
        // Up to 2 angles per person (front + one more, if available): a face
        // benefits from multiple views for identity lock, unlike a labeled
        // product, which a single well-matched reference fully specifies.
        const chashes = (c.shots ?? [])
          .slice(0, CHARACTER_REF_MAX)
          .map((s: any) => assetHash(s?.file))
          .filter((h: string | null): h is string => !!h && ctx.images.has(h));
        if (chashes.length) {
          chashes.forEach((chash: string, i: number) => {
            attachments.push({ role: 'character', id: c.id, label: c.name, hash: chash, essential: i === 0 });
          });
          personDirectives.push(
            'The attached person reference is the same person every time: hold their face, hair and build, and do not restyle them.',
          );
          // Presenters carry the same kind of identity metadata products do
          // (identityNotes / negativeConstraints). It used to be dropped on
          // the floor, so a presenter's own "never change this about them"
          // instructions never reached the model while a product's did.
          if (c.identityNotes) personDirectives.push(String(c.identityNotes));
          if (c.negativeConstraints?.length)
            personDirectives.push(`Avoid: ${[].concat(c.negativeConstraints).join(', ')}`);
        } else {
          warnings.push(`${c.name} has no usable photo, so they are named but not attached.`);
        }
        break;
      }

      case 'color': {
        const hex = tok.hex.toUpperCase();
        append(tok.name ? `${tok.name} (${hex})` : hex);
        otherDirectives.push(`Use ${hex} as a defining color in the composition.`);
        break;
      }

      case 'ref': {
        if (!ctx.images.has(tok.imageHash)) {
          warnings.push('A reference shot is missing and was skipped.');
          break;
        }
        attachments.push({ role: 'reference', label: 'Reference shot', hash: tok.imageHash });
        otherDirectives.push('Match the composition, lighting and treatment of the attached reference.');
        break;
      }

      case 'mark': {
        const logos: any[] = ctx.brand?.logos ?? [];
        const logo = logos.find((l) => assetHash(l?.file) === tok.imageHash);
        if (!logo || !ctx.images.has(tok.imageHash)) {
          warnings.push('A brand mark in this brief is no longer in the kit.');
          break;
        }
        // otherDirectives, not brandRuleDirectives: attaching the mark is a choice
        // made for this shot, so it ranks with the shot-specific directives
        // rather than with the kit's standing instructions.
        attachments.push({ role: 'brand', label: markLabel(ctx.brand, logo), hash: tok.imageHash });
        otherDirectives.push(
          "The attached brand mark is this brand's own mark. If the direction asks for the logo to appear, reproduce it exactly as drawn — same colours, letterforms and proportions, never redrawn or re-lettered. Otherwise take only its colour and treatment from it.",
        );
        break;
      }

      case 'template': {
        const t = ctx.templateById?.(tok.id);
        if (!t) {
          warnings.push('A template in this brief is no longer installed.');
          break;
        }
        // a brief runs one recipe: later templates are named and ignored
        if (inlineTemplates.length) {
          warnings.push(`${t.name} was ignored: a brief runs one template, and ${inlineTemplates[0].name} came first.`);
          break;
        }
        inlineTemplates.push(t);
        // the surrounding sentence is the art direction, so notes stay empty here
        append(composePrompt(t, { fields: brief.templateFields ?? {}, notes: '' }));
        break;
      }

      case 'format': {
        width = tok.w;
        height = tok.h;
        break;
      }

      default: {
        // A token kind we do not understand used to fall straight through
        // this switch and vanish. Silence is the wrong default here: the user
        // put something in the sentence and got an image that ignored it.
        warnings.push(`Unsupported brief token "${String((tok as { t?: unknown }).t)}" was ignored.`);
        break;
      }
    }
  }

  sentence = sentence.replace(/\s{2,}/g, ' ').trim();

  const explicitFormat = [...brief.tokens]
    .reverse()
    .find((t): t is Extract<BriefToken, { t: 'format' }> => t.t === 'format');
  if (inlineTemplates.length) {
    const first = inlineTemplates[0];
    width = first.width;
    height = first.height;
    if (explicitFormat) {
      width = explicitFormat.w;
      height = explicitFormat.h;
    }
  }

  // Legacy briefs carry templateId: that template frames the whole prompt.
  // Inline template tokens instead compile exactly where the chip sits.
  let prompt: string;
  if (ctx.template && !inlineTemplates.length) {
    prompt = `[${ctx.template.promptName ?? ctx.template.name}] ${composePrompt(ctx.template, {
      fields: brief.templateFields ?? {},
      notes: sentence,
    })}`;
    width = ctx.template.width;
    height = ctx.template.height;
    // an explicit format token still wins over the template default
    if (explicitFormat) {
      width = explicitFormat.w;
      height = explicitFormat.h;
    }
  } else {
    prompt = sentence;
  }

  const scene = inlineTemplates[0] ?? (inlineTemplates.length ? undefined : ctx.template);
  if (scene?.subject === 'product' && !productId) {
    warnings.push(`${scene.name} is built around a product. Add one to this brief.`);
  } else if (scene?.subject === 'person' && !hasPerson) {
    warnings.push(`${scene.name} is built around a person. Add a presenter.`);
  }

  // The scene's own prose may name a demo product or wardrobe brand of its
  // own; when a real product/presenter is attached, the guard directives
  // outrank it precisely because they're appended after it, last.
  // A scene's camera tendency is a default, not a lock: it is emitted only when
  // the shot direction has not already chosen a camera, so the two can never
  // compete. See shotSpecifiesCamera.
  const sceneCamera = inlineTemplates[0]?.camera?.trim() || ctx.template?.camera?.trim() || '';
  const cameraDirectives =
    sceneCamera && !shotSpecifiesCamera(sentence) ? [`Camera for this shot: ${sceneCamera}`] : [];

  const guard = scene ? sceneGuardDirectives({ hasProduct: !!productId, hasPerson }) : [];
  // The brand's rules sit between the shot's own directives and the scene
  // guards — the right neighbourhood, since a guard is the other thing here
  // whose whole job is to overrule what came before it.
  const brandLines = brandRuleDirectives(ctx.brand);
  const allDirectives = [
    ...productDirectives,
    ...personDirectives,
    ...otherDirectives,
    ...cameraDirectives,
    ...brandLines,
    ...guard,
  ];
  if (allDirectives.length) prompt = `${prompt}${prompt.endsWith('.') ? '' : '.'} ${dedupe(allDirectives).join(' ')}`;

  // Attachments are useless past what the engine will actually read.
  //
  // Order matters: the clamp below slices by position, and position used to be
  // whatever order the user happened to drop chips into the sentence. That
  // meant a "[presenter] [product]" brief on a low-cap engine kept two face
  // shots and threw the PRODUCT away — silently generating the wrong object.
  // Identity beats inspiration, always: product first, then character, then
  // plain style references, which are the only ones safe to lose.
  // Identity before context before direction before taste. Under a tight engine
  // cap what survives is what the image would be *wrong* without: the product,
  // then the person. A style reference is the first thing worth losing.
  const ROLE_PRIORITY: Record<Attachment['role'], number> = {
    product: 0,
    character: 1,
    brand: 2,
    scene: 3,
    composition: 4,
    reference: 5,
    style: 6,
  };
  const ordered = attachments
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        // Essential identity first, so a tight cap sheds extra product angles
        // and style references before it sheds a subject entirely.
        Number(!!y.a.essential) - Number(!!x.a.essential) ||
        ROLE_PRIORITY[x.a.role] - ROLE_PRIORITY[y.a.role] ||
        x.i - y.i,
    )
    .map((x) => x.a);
  const max = ctx.engineCaps.maxReferenceImages;
  const kept = ordered.slice(0, Math.max(0, max));
  const dropped = ordered.slice(kept.length);
  if (dropped.length) {
    // By label, not by attachment: a product contributes several angles, and
    // naming it once per dropped angle reads as three different products
    // having been lost.
    const names = [...new Set(dropped.map((d) => d.label))];
    warnings.push(
      `${ctx.engineCaps.displayName} reads ${max} reference image${max === 1 ? '' : 's'}, so ${names.join(
        ' and ',
      )} ${names.length === 1 ? 'was' : 'were'} left out.`,
    );
  }

  return {
    prompt: prompt.trim(),
    referenceImages: kept.map((a) => ctx.images.pathFor(a.hash)),
    dropped,
    width,
    height,
    attachments: kept,
    warnings,
    productId,
  };
}

const dedupe = (xs: string[]) => [...new Set(xs)];

/** Plain text of a brief, for node titles and lists. */
export function briefLabel(brief: Brief, brand: any): string {
  const products: any[] = brand?.products ?? [];
  return brief.tokens
    .map((t) =>
      t.t === 'text'
        ? t.v
        : t.t === 'product'
          ? (products.find((p) => p.id === t.id)?.name ?? 'product')
          : t.t === 'character'
            ? ((brand?.characters ?? []).find((c: any) => c.id === t.id)?.name ?? 'someone')
            : t.t === 'color'
              ? (t.name ?? t.hex)
              : t.t === 'ref'
                ? 'reference'
                : t.t === 'template'
                  ? ''
                  : '',
    )
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
