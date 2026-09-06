import { useMemo } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ShowcaseEntry } from '../../api.js';
import { recipeProps, type Catalogs } from '../../showcaseRecipe.js';
import { useShelf } from '../../layout/useShelf.js';
import { shuffle } from './shuffle.js';
import { ShowcaseCard } from '../../layout/ShowcaseCard.js';

/**
 * The first screen of an empty brand.
 *
 * It offers use cases rather than scenes. A scene is one ingredient of three,
 * so picking one still leaves you to choose a product, cast someone and write
 * the direction before anything can run. A use case is a whole recipe that
 * already ran: product, presenter, scene, art direction and format together.
 * One click stages the lot in the brief below, ready to send or to edit, which
 * is the shortest honest path from an empty brand to a real image.
 *
 * The row is a plain swipeable shelf, not a marquee. This is the first screen
 * of an empty brand and the job here is to read the options and pick one: a
 * row that drifts makes labels harder to read and every card a moving target.
 * The fade on each end already says it continues. */
export function FirstRun({
  entries,
  catalogs,
  stagedId,
  onUse,
  productHref,
  presenterHref,
  sceneHref,
}: {
  entries: ShowcaseEntry[];
  catalogs: Catalogs;
  stagedId: string | null;
  onUse: (entry: ShowcaseEntry) => void;
  productHref: (id: string) => string;
  presenterHref: (id: string) => string;
  sceneHref: (id: string) => string;
}) {
  // A different handful, in a different order, every time the page is opened:
  // the wall is a gallery of what the tool can do, not a ranked list.
  const shelf = useMemo(() => shuffle(entries).slice(0, 10), [entries]);
  const { ref, page } = useShelf<HTMLDivElement>(shelf.length);

  return (
    <div className="sc-canvas-empty">
      <h3>
        Your first <em>shot</em>
      </h3>
      {/* No "start writing" button: the caret is already in the brief below.
          A button whose only job is to focus something already focused is one
          more thing to read on the emptiest screen in the app. */}
      <p>Describe what you want in the prompt below, or open one of these.</p>
      {shelf.length > 0 && (
        <div className="sc-shelf">
          {/* A mouse has no sideways gesture. The wheel is redirected in the
              hook; these are the visible way to say the row moves. The row
              loops, so neither arrow is ever at an end and neither hides. */}
          <button type="button" className="sc-shelf-arrow prev" aria-label="Previous examples" onClick={() => page(-1)}>
            <CaretLeft size={13} weight="bold" />
          </button>
          <button type="button" className="sc-shelf-arrow next" aria-label="More examples" onClick={() => page(1)}>
            <CaretRight size={13} weight="bold" />
          </button>
          <div className="sc-shelf-row" ref={ref}>
            {/* Three copies: the loop lives in the middle one and steps back a
                copy whenever it drifts out. The outer two are scenery, so they
                stay out of the tab order and out of a screen reader's way. */}
            {[0, 1, 2].map((copy) =>
              shelf.map((e) => (
                <ShowcaseCard
                  key={`${copy}-${e.id}`}
                  entry={e}
                  // `grid`, not `shelf`: the shelf size pins captions open, and
                  // ten always-on titles under ten pictures is a wall of text.
                  // Hover reveals one, the same as Home.
                  size="grid"
                  hideRecipe
                  decorative={copy !== 1}
                  active={stagedId === e.id}
                  onOpen={() => onUse(e)}
                  productHref={productHref}
                  presenterHref={presenterHref}
                  sceneHref={sceneHref}
                  {...recipeProps(e, catalogs)}
                />
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
