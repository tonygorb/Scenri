import { useSearchParams } from 'react-router';
import { useOpenLearn } from '../../app/dialogs.js';
import { FIRST_USE } from '../../firstUse.js';
import { useMediaQuery } from '../../useMediaQuery.js';

/**
 * Learn, in the bar beside the bell (DESIGN.md, "First use"): every lesson, a
 * press away from any page. A ghost button, one word and no mark, so the bell
 * stays the row's only icon and New its only fill; never a destination: it
 * opens the Learn dialog over the page you are on. From 1024px;
 * below that the bar has no room for a word, and Help, which sits in the bar
 * there, carries Learn instead. Gone with the rest of first use while it is
 * paused (firstUse.ts).
 */
export function LearnButton() {
  const wide = useMediaQuery('(min-width: 1024px)');
  const openLearn = useOpenLearn();
  const [params] = useSearchParams();
  if (!FIRST_USE || !wide) return null;
  return (
    <button
      type="button"
      className="sc-learn-btn"
      aria-haspopup="dialog"
      data-on={params.has('learn') || undefined}
      onClick={() => openLearn()}
    >
      Learn
    </button>
  );
}
