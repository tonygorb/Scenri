import type { ComponentType, SVGProps } from 'react';
import { Circle, type Icon, Lightning } from '@phosphor-icons/react';
import { OpenAIMark } from '../layout/OpenAIMark.js';
import { OpenRouterMark } from '../layout/OpenRouterMark.js';
import { ReplicateMark } from '../layout/ReplicateMark.js';

/**
 * Who the providers are, in one place.
 *
 * The settings pane and the connect dialog used to hold their own copies of the
 * key names, the placeholder strings and the glyphs, which is how the row ended
 * up calling fal's key `fal` while the server called it `fal_key`. One table
 * now answers both, and adding a provider is one entry rather than three edits.
 */

/** A provider whose whole setup is a key the user pastes. Codex is not one. */
export interface KeyProvider {
  engineId: string;
  /** The field `PUT /api/settings` accepts. Must match SECRET_KEYS on the server. */
  settingKey: string;
  /** Shown in the empty field. The shape of the key, not an instruction. */
  hint: string;
  /** Where this provider issues keys. */
  keysUrl: string;
}

export const KEY_PROVIDERS: KeyProvider[] = [
  {
    engineId: 'openrouter',
    settingKey: 'openrouter_api_key',
    hint: 'sk-or-...',
    keysUrl: 'https://openrouter.ai/keys',
  },
  {
    engineId: 'replicate',
    settingKey: 'replicate_api_token',
    hint: 'r8_...',
    keysUrl: 'https://replicate.com/account/api-tokens',
  },
  { engineId: 'fal', settingKey: 'fal_key', hint: 'fal_...', keysUrl: 'https://fal.ai/dashboard/keys' },
];

export const keyProviderFor = (engineId: string): KeyProvider | undefined =>
  KEY_PROVIDERS.find((p) => p.engineId === engineId);

/**
 * Each provider's own mark on its own plate, both taken from the icon that
 * provider publishes, sized optically rather than uniformly.
 *
 * `plate` and `ink` are not a palette we chose. They are sampled from each
 * owner's own icon: OpenAI's 180px favicon (white plate, black mark),
 * OpenRouter's app icon (white plate, violet mark) and Replicate's favicon
 * (red plate, white mark). Nothing is tinted, mixed or adapted to scenri, and
 * the pairs never come apart: a mark always sits on the plate its owner puts
 * it on.
 *
 * Given the same box, Replicate's solid corner block reads twice as heavy as
 * OpenRouter's thin arrows, so the sizes are matched by weight on screen and
 * are not expected to agree with each other.
 */
const BRAND: Record<
  string,
  { Mark: ComponentType<SVGProps<SVGSVGElement>>; size: number; plate: string; ink: string }
> = {
  'codex-cli': { Mark: OpenAIMark, size: 16, plate: '#FFFFFF', ink: '#000000' },
  openrouter: { Mark: OpenRouterMark, size: 18, plate: '#FFFFFF', ink: '#7624F4' },
  replicate: { Mark: ReplicateMark, size: 15, plate: '#E42022', ink: '#FFFFFF' },
};

/**
 * The plate and ink a provider's tile should wear, if that provider publishes
 * an icon. Returned together, because half of a published pair is a colour
 * nobody published.
 */
export const engineTile = (engineId: string): { plate: string; ink: string } | undefined => {
  const brand = BRAND[engineId];
  return brand ? { plate: brand.plate, ink: brand.ink } : undefined;
};

/**
 * Anything with no brand mark of its own. fal belongs here too: its published
 * assets carry no open licence, so until fal grants written permission it
 * falls through to the Lightning default like any unbranded engine.
 */
const GLYPH: Record<string, Icon> = {
  demo: Circle,
};

/**
 * One provider's mark. No plate behind it: a white tile under every logo would
 * be four bright rectangles in a pane whose whole job is to stay quiet.
 */
export function EngineMark({ engineId, scale = 1 }: { engineId: string; scale?: number }) {
  const brand = BRAND[engineId];
  if (brand) {
    const px = Math.round(brand.size * scale);
    // Every path is `currentColor`, so the tile's ink colours all four the same
    // way and no geometry is ever touched.
    return <brand.Mark width={px} height={px} />;
  }
  const Glyph = GLYPH[engineId] ?? Lightning;
  return <Glyph size={Math.round(15 * scale)} />;
}
