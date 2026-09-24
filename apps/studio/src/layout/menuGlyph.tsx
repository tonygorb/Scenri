import {
  Archive,
  ArrowCounterClockwise,
  ArrowRight,
  ArrowSquareOut,
  Check,
  Copy,
  FolderSimpleMinus,
  FrameCorners,
  Image,
  Infinity as InfinityIcon,
  PencilSimple,
  PencilSimpleLine,
  Plus,
  Stack,
  Star,
  Trash,
} from '@phosphor-icons/react';
import type { ShotMenuIcon } from './canvas/shotMenu.js';
import type { CatalogMenuIcon } from './catalogMenu.js';

/** A line's mark, at the menu's 14px, in the line's own ink. */
export type MenuIcon = ShotMenuIcon | CatalogMenuIcon;

/**
 * The mark beside a menu line. 14px, and `currentColor`, so a red line
 * carries a red mark. Shot menus and catalog menus share this drawing, so
 * Open, Open in new tab and Delete are the same control on every card.
 */
export function MenuGlyph({ name }: { name: MenuIcon }) {
  const props = { size: 14, 'aria-hidden': true as const };
  switch (name) {
    case 'open':
      return <FrameCorners {...props} />;
    case 'continue':
      return <ArrowRight {...props} />;
    case 'open-tab':
      return <ArrowSquareOut {...props} />;
    case 'refine':
      return <InfinityIcon {...props} />;
    case 'select':
      return <Check {...props} weight="bold" />;
    case 'keep':
      return <Star {...props} />;
    case 'kept':
      return <Star {...props} weight="fill" />;
    case 'unset':
      return <FolderSimpleMinus {...props} />;
    case 'versions':
      return <Stack {...props} />;
    case 'archive':
      return <Archive {...props} />;
    case 'restore':
      return <ArrowCounterClockwise {...props} />;
    case 'delete':
    case 'discard':
      return <Trash {...props} />;
    case 'use':
      return <Plus {...props} />;
    case 'duplicate':
      return <Copy {...props} />;
    case 'rename':
      return <PencilSimpleLine {...props} />;
    case 'edit':
      return <PencilSimple {...props} />;
    case 'cover':
      return <Image {...props} />;
  }
}
