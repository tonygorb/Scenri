import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/**
 * A row of choices that scrolls rather than wraps.
 *
 * Two kinds of question ride this: the drawn look plates, and the picture
 * cards a distinctive detail is chosen from. Both want the same thing, which
 * is why it is one component: options wide enough to actually look at, in one
 * line rather than a grid, with a gesture for every hand. A finger swipes, a
 * trackpad scrolls sideways, and a mouse gets the two controls at the ends;
 * they stay put where the row runs out and fade instead of vanishing, so
 * nothing underneath them moves. Each edge is faded only while it is hiding
 * something, which makes the fade information rather than trim.
 */
export function Strip({ step, children }: { step: number; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ back: false, on: true });

  const read = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const room = el.scrollWidth - el.clientWidth;
    setEnds({ back: el.scrollLeft > 2, on: el.scrollLeft < room - 2 });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    read();
    el.addEventListener('scroll', read, { passive: true });
    const size = new ResizeObserver(read);
    size.observe(el);
    return () => {
      el.removeEventListener('scroll', read);
      size.disconnect();
    };
  }, [read]);

  const go = (dir: -1 | 1) => row.current?.scrollBy({ left: dir * step, behavior: 'smooth' });
  const fade = ends.back && ends.on ? 'both' : ends.back ? 'back' : ends.on ? 'on' : undefined;

  return (
    <div className="sc-convo-strip" data-fade={fade}>
      <Arrow dir={-1} live={ends.back} onGo={go} />
      <div className="sc-convo-plates" ref={row}>
        {children}
      </div>
      <Arrow dir={1} live={ends.on} onGo={go} />
    </div>
  );
}

/** One end of the row: live while there is somewhere to go, dim where there is not. */
function Arrow({ dir, live, onGo }: { dir: -1 | 1; live: boolean; onGo: (dir: -1 | 1) => void }) {
  const back = dir < 0;
  return (
    <button
      type="button"
      className="sc-convo-strip-go"
      data-dir={back ? 'back' : 'on'}
      data-spent={!live || undefined}
      aria-label={back ? 'Show earlier' : 'Show more'}
      aria-disabled={!live || undefined}
      // every option is already in the tab order; these are for the pointer
      tabIndex={-1}
      onClick={(e) => {
        // the press must not leave focus sitting on a control that is about to
        // fade out with the pointer
        e.currentTarget.blur();
        if (live) onGo(dir);
      }}
    >
      {back ? <CaretLeft size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
    </button>
  );
}
