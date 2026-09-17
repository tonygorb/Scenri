import { useLayoutEffect, useRef } from 'react';
import { registerSlot, releaseSlot } from '../guideFacts.js';

/**
 * A place in a surface where the guide may say one sentence (DESIGN.md,
 * "First use"): the picker, the open shot's tray, a creation dialog, the
 * presenter studio. Empty, it takes no room; the guide fills it or leaves it.
 */
export function GuideSlot({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerSlot(name, el);
    return () => releaseSlot(name, el);
  }, [name]);
  return <div ref={ref} className={className ? `sc-guide-slot ${className}` : 'sc-guide-slot'} />;
}
