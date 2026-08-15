/**
 * What each engine really does with the shape and the size a brief asks for.
 *
 * The adapters already know this — replicate refuses a ratio it cannot make,
 * openrouter reduces the request to a ratio string and drops the pixels
 * entirely — but they only say so at send time, which is one generation too
 * late to help anyone choosing. This is the same knowledge said before the
 * choice instead of after it, so the composer can dim a shape that cannot be
 * made and hide a control that cannot do anything.
 *
 * It is deliberately a second copy. The alternative is a capability field on
 * every adapter and a round trip to read it back, for five facts that have not
 * changed since the engines were written. Keep it in step with
 * `packages/engines/*`: `formats` mirrors each adapter's own ratio table and
 * `sizing` mirrors what it passes on.
 */

/** What an engine does with the pixel dimensions the compiler hands it. */
export type Sizing =
  /** Sent as real width and height; the picture comes back at them. */
  | 'exact'
  /** Reduced to a ratio: the shape survives, the size is dropped. */
  | 'ratio'
  /** Asked for in the prompt, and honoured or not by the model. */
  | 'advisory';

type Capability = {
  sizing: Sizing;
  /** Format ids this engine can make. Omitted where every format works. */
  formats?: string[];
};

const CAPABILITIES: Record<string, Capability> = {
  // the size rides in the prompt as "1232x1536: …", so it is a request an
  // agent may or may not act on, and the server only ever checks the ratio
  'codex-cli': { sizing: 'advisory' },
  // image_config.aspect_ratio only: draft, standard and high send identical bodies
  openrouter: { sizing: 'ratio' },
  // three buckets, and it throws rather than silently return the wrong shape
  replicate: { sizing: 'ratio', formats: ['square', 'story', 'landscape'] },
  fal: { sizing: 'exact' },
  demo: { sizing: 'exact' },
};

/** An engine with no entry is assumed to honour what it is given. */
const HONOURS_EVERYTHING: Capability = { sizing: 'exact' };

export const capabilityOf = (engineId: string): Capability => CAPABILITIES[engineId] ?? HONOURS_EVERYTHING;

/** False only where the engine's own adapter would refuse this shape. */
export function supportsFormat(engineId: string, formatId: string): boolean {
  const allowed = capabilityOf(engineId).formats;
  return !allowed || allowed.includes(formatId);
}

/** Whether asking for a size can change anything at all on this engine. */
export const sizingOf = (engineId: string): Sizing => capabilityOf(engineId).sizing;
