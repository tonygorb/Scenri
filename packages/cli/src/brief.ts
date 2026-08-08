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
  | { t: 'template'; id: string }
  | { t: 'format'; id: FormatId; w: number; h: number };

export type FormatId = 'square' | 'story' | 'landscape' | 'portrait';

export interface Brief {
  tokens: BriefToken[];
  templateId?: string;
  templateFields?: Record<string, string>;
}

export interface Attachment {
  role: 'product' | 'character' | 'reference';
  label: string;
  hash: string;
}

export interface CompiledBrief {
  prompt: string;
  referenceImages: string[];
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
        append(p.name);
        // A specific angle (e.g. "detail" for a macro shot, "worn-scale" for
        // an on-body shot) beats the default first shot when the recipe asks
        // for one; falls back silently if that angle isn't available.
        const shot = (tok.angle && p.shots?.find((s: any) => s.angle === tok.angle)) || p.shots?.[0];
        const hash = assetHash(shot?.file);
        if (hash && ctx.images.has(hash)) {
          attachments.push({ role: 'product', label: p.name, hash });
          productDirectives.push(
            'The attached product image is the exact product: preserve its label, shape and colors faithfully, do not redesign it.',
          );
          if (p.preservationNotes) productDirectives.push(String(p.preservationNotes));
          if (p.negativeConstraints) productDirectives.push(`Avoid: ${p.negativeConstraints}`);
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
        append(c.name);
        // Up to 2 angles per person (front + one more, if available): a face
        // benefits from multiple views for identity lock, unlike a labeled
        // product, which a single well-matched reference fully specifies.
        const chashes = (c.shots ?? [])
          .slice(0, 2)
          .map((s: any) => assetHash(s?.file))
          .filter((h: string | null): h is string => !!h && ctx.images.has(h));
        if (chashes.length) {
          for (const chash of chashes) attachments.push({ role: 'character', label: c.name, hash: chash });
          personDirectives.push(
            'The attached person reference is the same person every time: hold their face, hair and build, and do not restyle them.',
          );
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
    prompt = `[${ctx.template.name}] ${composePrompt(ctx.template, {
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
  const guard = scene ? sceneGuardDirectives({ hasProduct: !!productId, hasPerson }) : [];
  const allDirectives = [...productDirectives, ...personDirectives, ...otherDirectives, ...guard];
  if (allDirectives.length) prompt = `${prompt}${prompt.endsWith('.') ? '' : '.'} ${dedupe(allDirectives).join(' ')}`;

  // Attachments are useless past what the engine will actually read.
  const max = ctx.engineCaps.maxReferenceImages;
  const kept = attachments.slice(0, Math.max(0, max));
  const dropped = attachments.slice(kept.length);
  if (dropped.length) {
    warnings.push(
      `${ctx.engineCaps.displayName} reads ${max} reference image${max === 1 ? '' : 's'}, so ${dropped
        .map((d) => d.label)
        .join(' and ')} ${dropped.length === 1 ? 'was' : 'were'} left out.`,
    );
  }

  return {
    prompt: prompt.trim(),
    referenceImages: kept.map((a) => ctx.images.pathFor(a.hash)),
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
