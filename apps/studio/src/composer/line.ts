/**
 * The brief line, as DOM.
 *
 * Everything in this file works on nodes, never on React state, so it can be
 * tested and so there is exactly one place that knows the rules. Two of those
 * rules are the whole reason this module exists:
 *
 * 1. While the user is editing, the DOM is the source of truth. Tokens are read
 *    out of it; they are never written back in except by an explicit repaint.
 * 2. The caret is never moved programmatically during a click. Chromium anchors
 *    its editing caret to a (node, offset) pair and ignores a move made while
 *    it is processing a click: the Selection API keeps reporting the position
 *    you set while the next keystroke lands somewhere else entirely. Structural
 *    edits therefore rearrange the DOM *around* the anchor the browser already
 *    holds, so it ends up where the user expects without being told.
 */

export type { SentenceToken, FormatToken, BriefToken } from './line/tokens.js';
export { isSentence, emptySentence, briefTokens, identityKeyOf, CHIP, encode, decode, groupOf } from './line/tokens.js';
export { readLine, renderLine } from './line/render.js';
export { caretUnits, setCaretUnits, caretToEnd, hasSelectionIn, tailText } from './line/caret.js';
export { normalizeLine, isBlankLine, syncEmpty } from './line/invariants.js';
export type { InsertOptions, Sigil } from './line/insert.js';
export {
  insertToken,
  SIGILS,
  sigilAtCaret,
  removeChip,
  unitsBeforeChip,
  collapseDoubleSpaceAtCaret,
} from './line/insert.js';
export { textBeforeCaret, caretRect, caretBeside, caretFromPoint, pointToLinePosition } from './line/query.js';
export {
  moveSlots,
  moveSlotsFor,
  snapAfter,
  snapToSlot,
  moveChipToUnits,
  moveChipBy,
  dropUnitsAt,
  gapStartUnits,
  moveAnnouncement,
} from './line/reorder.js';
export { keepCaret } from './line/focus.js';
export { serializeSelection, serializeBriefTokens, chipLabel, parseBriefHtml } from './line/clipboard.js';
export type { ColorToken } from './line/chips.js';
export { templateChip, chipAt, chipHexWords, updateColorChip, normalizeTint, closeIcon } from './line/chips.js';
