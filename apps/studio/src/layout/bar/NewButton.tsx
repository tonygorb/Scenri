import { Link } from 'react-router';
import { Aperture, CaretDown, FilmSlate, IdentificationBadge, Package, Plus } from '@phosphor-icons/react';
import { BarMenu, BarRow } from './BarMenu.js';
import { thumbOf } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useCreateAsset } from '../../create/AssetCreateHost.js';
import { useKindPreview } from '../../create/useKindPreview.js';
import { useMainNav } from '../nav.js';
import type { CreateKind } from '../../createDraft.js';

const INGREDIENTS: { kind: CreateKind; label: string; line: string; noun: string; icon: typeof Package }[] = [
  { kind: 'product', label: 'Product', line: 'What you are photographing', noun: 'product', icon: Package },
  {
    kind: 'presenter',
    label: 'Presenter',
    line: 'Who appears in the shot',
    noun: 'presenter',
    icon: IdentificationBadge,
  },
  { kind: 'scene', label: 'Scene', line: 'The place and its light', noun: 'scene', icon: FilmSlate },
];

/**
 * Making something, as one control with two halves.
 *
 * The filled half does the usual thing straight away: it opens Create with the
 * composer up. The caret offers the same act plus the three things a shot is
 * made from. A solid primary that only opens a menu promises an action it does
 * not perform, and an unlabelled plus was the opposite problem: it performed one
 * nobody could name.
 *
 * The menu leads with the shot rather than listing only the ingredients, because
 * a menu that offers everything except the usual thing makes you hunt for the
 * usual thing. That row wears the same wash Home puts on the same act, so it is
 * told apart by paint and the list needs no rule cut across it.
 *
 * Each ingredient row carries this brand's own picture of that kind and how many
 * it already holds: the same pictures the create dialog uses, from the same hook,
 * so the bar and the dialog cannot disagree about what a brand's presenters look
 * like. A kind with none keeps its glyph, because borrowing another's picture
 * would say something untrue.
 */
export function NewButton() {
  const createAsset = useCreateAsset();
  const preview = useKindPreview();
  // A finished shot on the row that makes one, from the wall the app has already
  // loaded. No fetch of its own, and a glyph if it has not arrived: the lead row
  // is told apart by its wash either way.
  const { showcase } = useAppData();
  const shotPic = showcase.find((s) => s.previewUrl)?.previewUrl ?? null;
  // The same destination the nav's Create item computes, rather than a second
  // opinion about what "go and make a shot" means from here, plus the add panel
  // open on All: a shot starts from what goes in it, so New lands there.
  const create = useMainNav(16).find((i) => i.key === 'create');
  const newShot = create ? `${create.to}&attach=all` : '';

  return (
    <div className="sc-new">
      <Link className="sc-new-go" to={newShot} aria-label="New shot" data-attach-opener="">
        <Plus size={14} weight="bold" className="sc-new-plus" aria-hidden="true" />
        <span className="sc-new-lb">New</span>
      </Link>
      <span className="sc-new-split" aria-hidden="true" />
      <BarMenu
        label="New"
        className="sc-menu-start"
        trigger={
          <button type="button" className="sc-new-more" aria-label="Other ways to start">
            <CaretDown size={12} weight="bold" className="sc-new-caret" aria-hidden="true" />
          </button>
        }
      >
        {/* A real Link, so the row survives a middle click the way the nav does. */}
        <BarRow className="sc-menu-item sc-start-row" data-lead="" to={newShot}>
          <span className="sc-start-pic">
            {shotPic ? (
              <img src={thumbOf(shotPic, 'tile')} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="sc-start-glyph">
                <Aperture size={22} />
              </span>
            )}
          </span>
          <span className="sc-start-txt">
            <b>New shot</b>
            <small>Write a brief, get a shot</small>
          </span>
        </BarRow>

        {/* No rule under the lead row: its wash is what tells it apart, and a line
          as well would be saying the same thing twice. */}
        <div className="sc-menu-label">Add to this brand</div>
        {INGREDIENTS.map((row) => {
          const { url, count } = preview[row.kind];
          return (
            <BarRow key={row.kind} className="sc-menu-item sc-start-row" onSelect={() => createAsset(row.kind)}>
              <span className="sc-start-pic">
                {url ? (
                  <img src={url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="sc-start-glyph">
                    <row.icon size={22} />
                  </span>
                )}
              </span>
              <span className="sc-start-txt">
                <b>{row.label}</b>
                <small>{row.line}</small>
              </span>
              <span className="sc-start-n">
                {count === 0 ? 'None yet' : count}
                <span className="sc-vh">{` ${row.noun}${count === 1 ? '' : 's'} so far`}</span>
              </span>
            </BarRow>
          );
        })}
      </BarMenu>
    </div>
  );
}
