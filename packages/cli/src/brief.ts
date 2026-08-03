import type { EngineCapabilities, Core } from '@scenri/core';
import { composePrompt, type Look } from './looks.js';

/**
 * A brief is the request as the user wrote it: prose interleaved with typed
 * tokens. It compiles to exactly one prompt string plus attachments, so what
 * the composer previews and what the engine receives can never drift.
 */
export type BriefToken =
  | { t: 'text'; v: string }
  | { t: 'product'; id: string }
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
  /** Legacy single look (brief.templateId). Frames the whole prompt. */
  template?: Look;
  /** Lookup for inline look tokens, which compile where they sit. */
  templateById?: (id: string) => Look | undefined;
}

const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

/** Deterministic: same brief + same context always yields the same request. */
export function compileBrief(brief: Brief, ctx: CompileContext): CompiledBrief {
  const warnings: string[] = [];
  const attachments: Attachment[] = [];
  const directives: string[] = [];
  let width = 1024;
  let height = 1024;
  let productId: string | null = null;

  const products: any[] = ctx.brand?.products ?? [];
  const characters: any[] = ctx.brand?.characters ?? [];
  const inlineTemplates: Look[] = [];
  let hasPerson = false;
  let sentence = '';

  for (const tok of brief.tokens) {
    switch (tok.t) {
      case 'text':
        sentence += tok.v;
        break;

      case 'product': {
        const p = products.find((x) => x.id === tok.id);
        if (!p) {
          warnings.push('A product in this brief is no longer in the brand kit.');
          break;
        }
        productId = p.id;
        sentence += p.name;
        const hash = assetHash(p.shots?.[0]?.file);
        if (hash && ctx.images.has(hash)) {
          attachments.push({ role: 'product', label: p.name, hash });
          directives.push(
            'The attached product image is the exact product: preserve its label, shape and colors faithfully, do not redesign it.',
          );
        } else {
          warnings.push(`${p.name} has no usable photo, so it is named but not attached.`);
        }
        break;
      }

      case 'character': {
        const c = characters.find((x) => x.id === tok.id);
        if (!c) {
          warnings.push('Someone in this brief is no longer in the cast.');
          break;
        }
        hasPerson = true;
        sentence += c.name;
        const chash = assetHash(c.shots?.[0]?.file);
        if (chash && ctx.images.has(chash)) {
          attachments.push({ role: 'character', label: c.name, hash: chash });
          directives.push(
            'The attached person reference is the same person every time: hold their face, hair and build, and do not restyle them.',
          );
        } else {
          warnings.push(`${c.name} has no usable photo, so they are named but not attached.`);
        }
        break;
      }

      case 'color': {
        const hex = tok.hex.toUpperCase();
        sentence += tok.name ? `${tok.name} (${hex})` : hex;
        directives.push(`Use ${hex} as a defining color in the composition.`);
        break;
      }

      case 'ref': {
        if (!ctx.images.has(tok.imageHash)) {
          warnings.push('A reference shot is missing and was skipped.');
          break;
        }
        attachments.push({ role: 'reference', label: 'Reference shot', hash: tok.imageHash });
        directives.push('Match the composition, lighting and treatment of the attached reference.');
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
        sentence += composePrompt(t, { fields: brief.templateFields ?? {}, notes: '' });
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

  const look = inlineTemplates[0] ?? (inlineTemplates.length ? undefined : ctx.template);
  if (look?.subject === 'product' && !productId) {
    warnings.push(`${look.name} is built around a product. Add one to this brief.`);
  } else if (look?.subject === 'person' && !hasPerson) {
    warnings.push(`${look.name} is built around a person. Add someone from the cast.`);
  }

  if (directives.length) prompt = `${prompt}${prompt.endsWith('.') ? '' : '.'} ${dedupe(directives).join(' ')}`;

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
