import type { EngineCapabilities, Core, ReferenceRole } from '@scenri/core';
import type { CustomScene } from './assetRecords.js';
import { composePrompt, type Scene } from './scenes.js';
import { allocateAttachments } from './attachmentBudget.js';
import { MARK_WARN_EDGE } from './routes/shared.js';
import type { EditScope } from './editScopeRules.js';
export {
  brandRuleDirectives,
  characterFactDirectives,
  editPreservationDirective,
  inheritedIdentityDirective,
  garmentDisplayDirective,
  markLabel,
  personSkinDirective,
  productFactDirectives,
  productFidelityDirective,
  productHandlingDirective,
  sceneGuardDirectives,
  sceneFigureDirectives,
  shotSpecifiesCamera,
} from './briefDirectives.js';
import {
  brandRuleDirectives,
  characterFactDirectives,
  editPreservationDirective,
  inheritedIdentityDirective,
  garmentDisplayDirective,
  markLabel,
  personSkinDirective,
  productFactDirectives,
  productFidelityDirective,
  productHandlingDirective,
  referenceIdentityGuard,
  sceneGuardDirectives,
  sceneFigureDirectives,
  shotSpecifiesCamera,
} from './briefDirectives.js';

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

export const PRODUCT_REF_MAX = 3;
/**
 * Three, up from two. A face is the identity that most needs corroboration,
 * and curated presenters carry four studio views; capping at two threw the
 * third away even on a roomy engine with slots to spare. The budget still
 * arbitrates when it is tight - the third view is round-robin corroboration,
 * boarding after every identity's essential and every hand-attached thing.
 */
export const CHARACTER_REF_MAX = 3;
/**
 * One. A scene reference is context, never identity, and the budget it spends
 * has to come out of something. At the codex cap of five with a product and a
 * presenter attached, the allocator pays for this out of the product's third
 * angle. When a brand mark also rides, the mark takes that seat instead and
 * the presenter's second view is what pays - both identities keep their
 * essential first image, and the loss is corroboration, named honestly in
 * the generation warning.
 */
export const SCENE_REF_MAX = 1;

export interface Attachment {
  /**
   * Why this image is attached. The engine turns each role into a directive, so
   * a role is the only thing stopping an image influencing a dimension it was
   * never meant to: a colour-inspiration shot must not drive composition, and a
   * composition reference must not recolour the product. `reference` is kept as
   * the untyped legacy role for briefs authored before roles were split.
   */
  role: ReferenceRole;
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
  /**
   * Set by the edit route (never by compileBrief): this attachment was
   * carried from the shot being refined rather than attached in this brief.
   * The UI shows carried context in its own quieter voice.
   */
  inherited?: boolean;
  /**
   * Which catalogued view this picture is (front, portrait, left-profile...),
   * when its record knows. The golden fixture records it, because role, id and
   * essential alone cannot see a change of WHICH image leads: every presenter
   * recipe once swapped its leading reference and the fixture stayed green.
   */
  angle?: string;
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

/**
 * What the compiler may read off a scene.
 *
 * `brandSceneById` hands a `CustomScene` back typed as `Scene`, so `staging` is
 * there at runtime and invisible to the types. Widening here rather than adding
 * a custom-only field to the catalog `Scene` interface, which 72 shipped files
 * and a loader validator answer to.
 */
type CompilableScene = Scene & Pick<CustomScene, 'figure' | 'figureTreatment' | 'refs' | 'preview'>;

interface CompileContext {
  brand: any;
  images: Core['images'];
  engineCaps: EngineCapabilities;
  /** Legacy single scene (brief.templateId). Frames the whole prompt. */
  template?: CompilableScene;
  /** Lookup for inline scene tokens, which compile where they sit. */
  templateById?: (id: string) => CompilableScene | undefined;
  /**
   * Refinements compile through this same function, and they need one thing a
   * generation must never carry: a statement that a photograph already exists
   * and most of it has to survive. Absent means generation, so every compiled
   * generation prompt stays byte for byte what it was.
   */
  mode?: 'generation' | 'edit';
  /** How much of the frame the instruction is allowed to move. See editScopeRules. */
  editScope?: EditScope;
  /** The instruction removes something, so the ghost it would leave is named. */
  editRemoval?: boolean;
  /**
   * Which identity KINDS were inherited from the shot being refined, so the
   * claim speaks only about what actually rides. Legacy `true` means both -
   * the historical sentence, byte for byte.
   */
  inheritedIdentity?: boolean | { product: boolean; person: boolean };
  /**
   * The edit grows the canvas. The global preservation directive promises
   * "the same dimensions", which is the one thing an extend must break —
   * expandInstruction carries its own preservation language for the region
   * that matters, so the contradictory sentence is dropped rather than argued
   * with.
   */
  editReshape?: 'extend';
  /**
   * What the inherited identities are and what must hold about each, built by
   * the edit route from the records its inherited tokens resolve to. Emitted
   * inside the edit-only preservation block, so a generation prompt can never
   * carry them.
   */
  inheritedDirectives?: string[];
}

const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

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
  /** Scene attachments that are the RAW upload (no plate drawn) - see below. */
  const rawSceneFallback: Attachment[] = [];
  const productDirectives: string[] = [];
  const personDirectives: string[] = [];
  const otherDirectives: string[] = [];
  let width = 1024;
  let height = 1024;
  let productId: string | null = null;

  const products: any[] = ctx.brand?.products ?? [];
  const characters: any[] = ctx.brand?.characters ?? [];
  const inlineTemplates: CompilableScene[] = [];
  let hasPerson = false;
  let sentence = '';
  // Tokens compile independently and never know what text preceded them, so
  // every append goes through here to guarantee a separating space — raw
  // concatenation (e.g. a product name directly followed by scene prose)
  // otherwise fuses into one run-on word.
  const append = (s: string) => {
    sentence += (sentence && !sentence.endsWith(' ') ? ' ' : '') + s;
  };

  // A reference that is byte-identical to a mark that will attach would ship
  // the same artwork twice under two contradictory contracts: reproduce it
  // exactly (the mark) and match its composition (the ref). It rides once, as
  // the mark; different artwork under both roles stays legitimate.
  const attachingMarkHashes = new Set(
    (brief.tokens as any[])
      .filter((t) => t?.t === 'mark')
      .map((t) => t.imageHash as string)
      .filter((h) => (ctx.brand?.logos ?? []).some((l: any) => assetHash(l?.file) === h) && ctx.images.has(h)),
  );

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
        const pshots: { h: string; angle?: string }[] = [];
        for (const s of orderedShots) {
          if (pshots.length >= PRODUCT_REF_MAX) break;
          const h = assetHash(s?.file);
          if (h && ctx.images.has(h) && !pshots.some((x) => x.h === h))
            pshots.push({ h, ...(s?.angle ? { angle: String(s.angle) } : {}) });
        }
        if (pshots.length) {
          pshots.forEach(({ h, angle }, i) => {
            attachments.push({
              role: 'product',
              id: p.id,
              label: p.name,
              hash: h,
              essential: i === 0,
              ...(angle ? { angle } : {}),
            });
          });
          productDirectives.push(productFidelityDirective(pshots.length));
          // Real-world scale, material and the record's own preservation
          // notes, when the product record knows them. A model given no size
          // cue will happily render a watch the size of a dinner plate in a
          // wide shot; stating the physical facts is the cheapest correction
          // available. Shared with the refine path, which states the same
          // facts about an inherited identity.
          productDirectives.push(...productFactDirectives(p));
          // No product record has ever carried `dimensions` in practice, so
          // the true-scale line above was dead and a cream jar could render
          // at basketball scale. The description is the one text that states
          // what the object IS ("sized for a facial serum"), so it anchors
          // scale whenever explicit dimensions do not.
          if (p.description && !p.dimensions)
            productDirectives.push(
              `What this object physically is: ${String(p.description).replace(/\.\s*$/, '')}. Keep it at that real size relative to hands, faces, furniture and everything else in frame.`,
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
        const cshots = (c.shots ?? [])
          .slice(0, CHARACTER_REF_MAX)
          .map((s: any) => ({ h: assetHash(s?.file), angle: s?.angle ? String(s.angle) : undefined }))
          .filter((x: { h: string | null }): x is { h: string; angle?: string } => !!x.h && ctx.images.has(x.h));
        if (cshots.length) {
          cshots.forEach(({ h, angle }: { h: string; angle?: string }, i: number) => {
            attachments.push({
              role: 'character',
              id: c.id,
              label: c.name,
              hash: h,
              essential: i === 0,
              ...(angle ? { angle } : {}),
            });
          });
          // Presence first, identity second. Every other directive here is
          // conditional on the person already being rendered ("match their
          // face", "dress them") — nothing ever said the person must be IN
          // the picture, and a scene's own prose could quietly compose them
          // out. The name makes the sentence unique per presenter, so the
          // dedupe pass never collapses two people into one claim.
          personDirectives.push(
            `${c.promptName ?? c.name} is in this photograph: a real person, clearly visible in the frame. ` +
              'Do not leave them out, crop them out, or reduce them to a reflection or a shadow.',
          );
          // Identity is named precisely, and the capture setup is released
          // just as precisely. Every presenter's reference set is shot
          // full-length in the same neutral off-white uniform; the old wording
          // ("do not restyle them") read as preserve-the-photo-wholesale, and
          // that uniform kept walking into finished commercial images.
          // The release was still not enough on its own. In a 12 frame
          // presenter battery the capture layer came back in four of them, so
          // the last clause names the failure instead of only describing what
          // the reference is, and says what to do when the direction is silent
          // rather than leaving the model to fall back on the photograph.
          personDirectives.push(
            'The attached person reference is the same person every time: match their face, facial structure, skin, hair and build exactly. ' +
              'Their outfit, pose, background and lighting are neutral studio capture conditions, not styling direction: ' +
              'dress and style them for this shot, to a commercial standard, following any wardrobe the direction itself specifies. ' +
              'Where the direction specifies none, dress them for the place and the occasion the frame shows, and never return them to the plain base layers they were photographed in.',
          );
          // Presenters carry the same kind of identity metadata products do
          // (identityNotes / negativeConstraints). It used to be dropped on
          // the floor, so a presenter's own "never change this about them"
          // instructions never reached the model while a product's did.
          // Shared with the refine path, like the product facts above.
          personDirectives.push(...characterFactDirectives(c));
          // The record's own skin truth, name-prefixed so the dedupe pass can
          // never collapse two presenters' skin into one claim. Every curated
          // presenter states one ("faint natural lines, minimal retouch");
          // it was dropped by the resolver until now, which is half of the
          // airbrushed-presenter report - the floor below is the other half.
          if (c.skin)
            personDirectives.push(
              `${c.promptName ?? c.name}'s skin, exactly as the reference photographs show it: ${c.skin}.`,
            );
          // Bone structure, in words, because the pictures cannot carry it.
          // The reference frames are full-length, so the face arrives at
          // roughly 105px brow to chin while a portrait renders it at four
          // times that: the payload fixes type and colouring and leaves the
          // jaw, brow and cheekbones to the prior, which is why one brief
          // returned four different faces of one casting type. Named the same
          // way skin is, so the dedupe pass can never merge two presenters'
          // faces into one claim.
          if (c.facial)
            personDirectives.push(
              `${c.promptName ?? c.name}'s face, which must survive every generation unchanged: ${c.facial}.`,
            );
          if (c.build) personDirectives.push(`${c.promptName ?? c.name}'s build: ${c.build}.`);
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
        if (attachingMarkHashes.has(tok.imageHash)) {
          warnings.push('That reference is the same image as your brand mark, so it rides once, as the mark.');
          break;
        }
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
        // Every stored blob is a PNG by construction, and a PNG's IHDR
        // carries its size at bytes 16-23. Under the warn edge fine lettering
        // is subpixel before any provider sees it, so the chip says so before
        // the money is spent rather than the render saying it after. Legacy
        // small marks minted before the resolution floor trip this too, which
        // retroactively explains their broken lettering.
        try {
          const head = ctx.images.read(tok.imageHash);
          const edge = Math.max(head.readUInt32BE(16), head.readUInt32BE(20));
          if (edge < MARK_WARN_EDGE)
            warnings.push(
              `${markLabel(ctx.brand, logo)} is only ${edge}px across, so fine lettering will not survive generation. Export it larger, or as SVG.`,
            );
        } catch {
          // an unreadable header is not a compile failure
        }
        otherDirectives.push(
          "The attached brand mark is this brand's own mark. If the direction asks for the logo to appear, reproduce it exactly as drawn — same colours, letterforms and proportions, never redrawn or re-lettered. Every character it carries appears intact, including the smallest secondary lettering, in its original script and reading direction — never translated, transliterated or re-spelled. Otherwise take only its colour and treatment from it.",
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

        /*
         * A figure-led scene sends a picture, because its prose cannot carry it.
         *
         * Measured, not assumed. A scene whose whole art direction is a dense
         * graphic treatment - a face tiled with printed stickers - compiled to
         * words came back as blank pastel paper every time, because three
         * separate rules in this prompt argue about lettering and the treatment
         * loses. The same brief with the reference attached produced the
         * treatment correctly, kept the presenter's face, and invented its own
         * graphics. That is the same mechanism a hand-attached reference already
         * uses, and it is why one of those "just works".
         *
         * Only when the scene names a figure: an environment compiles to prose
         * perfectly well, and every catalog scene stays byte-identical. Never on
         * an edit, where the source frame already holds the world and the budget
         * is one slot smaller. Not essential, so it degrades instead of refusing.
         *
         * THE CONDITIONING IMAGE, deliberate and pinned by tests: exactly one
         * image conditions the generation - the scene's own drawn preview
         * when one exists, else refs[0], the first upload. The preview is the
         * identity-neutral plate ("they are nobody in particular",
         * scenePreviewPrompt): it lends the world and the treatment but never
         * a face, where the raw upload is a full-bleed photograph of a real
         * person the model demonstrably borrowed. References 2..N reach only
         * the analyzer, which is instructed to build order-neutral consensus,
         * so they shape the scene's PROSE and never its pixels. The card
         * shows the same preview, so what the user sees IS what conditions.
         */
        if (ctx.mode !== 'edit' && t.figure) {
          const plate = assetHash(t.preview);
          const hasPlate = !!plate && ctx.images.has(plate);
          const candidates = hasPlate ? [plate] : (t.refs ?? []).slice(0, SCENE_REF_MAX).map((r) => assetHash(r?.file));
          for (const h of candidates) {
            if (h && ctx.images.has(h)) {
              const a: Attachment = { role: 'scene', id: t.id, label: t.name, hash: h, essential: false };
              attachments.push(a);
              // The raw upload may be a photograph of a real person. Whether
              // it can ride depends on who else is in the brief, and that is
              // only known after the whole token loop - so it is remembered
              // here and judged there.
              if (!hasPlate) rawSceneFallback.push(a);
            }
          }
        }
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

  // Attachments are useless past what the engine will actually read.
  //
  // The budget lives in attachmentBudget.ts: essentials board first, then every
  // distinct attached thing gets one slot before any product or presenter gets
  // a corroboration angle, then leftovers. This is what stops a second product
  // angle evicting the reference or brand mark the user attached by hand.
  //
  // Allocated here, before the guards are written: a guard about "the scene's
  // own photograph" may only be said when that photograph survived the budget —
  // a directive about an image the engine never received is the composer lying
  // about what was sent.
  // No plate exists for this scene, so its conditioning image would be the
  // raw upload - possibly a full-bleed photograph of a real person nobody
  // selected. With a presenter attached that is a competing identity in the
  // payload, and identity is the one thing a scene must never lend: the scene
  // degrades to prose, quietly, the same way a budget-dropped scene ref does.
  // With nobody attached the upload still rides: a dense treatment compiled
  // to words alone came back as blank paper (measured, see the scene case),
  // and there is no selected identity to protect.
  if (hasPerson && rawSceneFallback.length) {
    for (const a of rawSceneFallback) {
      const i = attachments.indexOf(a);
      if (i !== -1) attachments.splice(i, 1);
    }
  }
  const max = ctx.engineCaps.maxReferenceImages;
  const { kept, dropped } = allocateAttachments(attachments, max);

  const guard = scene
    ? sceneGuardDirectives({
        hasProduct: !!productId,
        hasPerson,
        hasScenePhoto: kept.some((a) => a.role === 'scene'),
      })
    : [];
  // Product and presenter are otherwise two independent identity locks with no
  // stated relationship; without this line a sweater and its wearer compile as
  // two objects to preserve side by side. One sentence, wearability left to
  // the model — a category taxonomy here would be wrong for half the catalog.
  const pairDirectives =
    productId && hasPerson
      ? [
          'If the attached product is something a person wears, the presenter wears that exact product, with the rest of the outfit styled around it; otherwise the presenter presents or uses the product naturally.',
          // A product's own notes are written for solo packshots, and several
          // catalog records literally say "no props, hands, or presenter in
          // frame". That data already shipped, so the override lives here in
          // the compiler: fired only when a person is attached, worded like
          // the mark exception — the ban stays for invented people, the
          // attached one is deliberate.
          'Any earlier instruction that bans props, hands, people, or a presenter from the frame is a solo-packshot rule for this product and does not apply to this shot: the attached presenter is deliberate and must appear as directed.',
          productHandlingDirective(),
        ]
      : [];
  // After the pair line, which is the other directive whose job is to relate two
  // attached things to each other, and before the guards, which must keep the
  // last word on cast (briefDirectives.ts: a scene composing an attached
  // presenter out of their own shot was a real reported failure).
  const figureDirectives = scene?.figure
    ? sceneFigureDirectives({
        figure: scene.figure,
        treatment: scene.figureTreatment,
        hasPerson,
        // The treatment's fictional-brands rule needs to know a real mark is
        // deliberately in play; attachments are fully collected by this point.
        hasMark: attachments.some((a) => a.role === 'brand'),
      })
    : [];

  // "Closeup zoom with DOF holding the bottle" reads, to a model, like an
  // invitation to shoot the bottle alone: the tight crop satisfies the framing
  // and quietly deletes the person. Say the reconciliation out loud — a tight
  // frame includes the presenter at hand level at minimum, and framing is
  // never license to drop them.
  // The skin floor, decided after the token loop because a character token can
  // follow a product token and `hasPerson` is only settled here. One emission
  // however many presenters are in frame (the identical string dedupes), in
  // the person group so it travels with the identity lock. It fires in edit
  // mode too - a refinement is exactly where the waxy look compounds - and
  // the preservation block still lands after it, per the ordering contract.
  if (hasPerson) personDirectives.push(personSkinDirective());
  const closeUpDirectives =
    hasPerson && /\bclose[- ]?up\b|\bmacro\b|\bzoom(?:ed)?\b|\bDOF\b|\bdepth of field\b/i.test(sentence)
      ? [
          'The tight framing includes the presenter: keep at least their hand in genuine contact with the product, and as much more of them as the crop allows. A close-up is never a reason to leave the person out of the photograph.',
        ]
      : [];
  // The brand's rules sit between the shot's own directives and the scene
  // guards — the right neighbourhood, since a guard is the other thing here
  // whose whole job is to overrule what came before it.
  const brandLines = brandRuleDirectives(ctx.brand);
  // A refinement says what may not move, and it says it last. The scene guards
  // are the other thing here whose whole job is to overrule what came before
  // them, and preservation has to overrule even those: a guard tells the model
  // to disregard a product the scene named, while this tells it the picture in
  // its hands is the shot.
  const preservation =
    ctx.mode === 'edit'
      ? [
          ...(ctx.editReshape === 'extend'
            ? []
            : [editPreservationDirective(ctx.editScope ?? 'global', { removal: ctx.editRemoval })]),
          ...(ctx.inheritedIdentity
            ? [inheritedIdentityDirective(ctx.inheritedIdentity === true ? undefined : ctx.inheritedIdentity)]
            : []),
          ...(ctx.inheritedDirectives ?? []),
        ]
      : [];
  // Read the attached products' own records: only apparel earns the line, and
  // only when nobody is attached to wear it and this is a fresh generation.
  const apparelUnworn =
    ctx.mode !== 'edit' &&
    !hasPerson &&
    attachments.some((a) => {
      if (a.role !== 'product' || !a.id) return false;
      const rec = (ctx.brand?.products ?? []).find((x: any) => x?.id === a.id);
      return String(rec?.category ?? '').toLowerCase() === 'apparel';
    })
      ? [garmentDisplayDirective()]
      : [];
  // Presenter over reference, for identity - said only about images that
  // actually rode (same honesty rule as the photo guard), and only on a
  // generation: an edit's identity rides the source frame.
  const refGuard =
    ctx.mode !== 'edit' && hasPerson && kept.some((a) => a.role === 'reference') ? [referenceIdentityGuard()] : [];

  const allDirectives = [
    ...productDirectives,
    ...personDirectives,
    ...pairDirectives,
    ...figureDirectives,
    ...closeUpDirectives,
    ...otherDirectives,
    ...cameraDirectives,
    ...apparelUnworn,
    ...brandLines,
    ...guard,
    ...refGuard,
    ...preservation,
  ];
  if (allDirectives.length) prompt = `${prompt}${prompt.endsWith('.') ? '' : '.'} ${dedupe(allDirectives).join(' ')}`;

  if (dropped.some((d) => d.role !== 'scene')) {
    // By label, not by attachment: a product contributes several angles, and
    // naming it once per dropped angle reads as three different products
    // having been lost.
    // Never name a dropped scene reference. This warning exists to tell someone
    // an identity they attached will not be shown; a scene ref is context that
    // degrades quietly, and naming it here reads as though their scene failed.
    // And name an identity only when ALL of it was dropped: a shed
    // corroboration angle whose essential survived degrades quietly - the
    // refine path has said this since 0.6.9, and the generation path used to
    // tell someone their presenter "was left out" when its first image had in
    // fact boarded.
    const keptLabels = new Set(kept.map((a) => a.label));
    const names = [...new Set(dropped.filter((d) => d.role !== 'scene').map((d) => d.label))].filter(
      (l) => !keptLabels.has(l),
    );
    if (names.length) {
      // "reads 0 reference images" is technically true and reads like a bug; an
      // engine that takes none deserves a sentence written for that case.
      const reads = max === 0 ? 'reads no reference images' : `reads ${max} reference image${max === 1 ? '' : 's'}`;
      warnings.push(
        `${ctx.engineCaps.displayName} ${reads}, so ${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} left out.`,
      );
    }
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
