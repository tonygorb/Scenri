import { describe, expect, it } from 'vitest';
import { suggestedPresenterCopyName } from '../src/presenterCopyName.js';

describe('suggestedPresenterCopyName', () => {
  it('uses the human copy series, and skips names that are already taken', () => {
    expect(suggestedPresenterCopyName('Maya', [])).toBe('Maya copy');
    expect(suggestedPresenterCopyName('Maya', ['Maya copy'])).toBe('Maya copy 2');
    expect(suggestedPresenterCopyName('Maya', ['Maya copy', 'Maya copy 2'])).toBe('Maya copy 3');
  });

  it('stays on the same stem when the source is already a copy', () => {
    expect(suggestedPresenterCopyName('Maya copy', ['Maya', 'Maya copy'])).toBe('Maya copy 2');
    expect(suggestedPresenterCopyName('Maya copy 2', ['Maya copy', 'Maya copy 2'])).toBe('Maya copy 3');
  });

  it('treats taken names as case-insensitive and trims them', () => {
    expect(suggestedPresenterCopyName('Maya', ['  MAYA COPY  '])).toBe('Maya copy 2');
  });

  it('fits the 60-character presenter name cap', () => {
    const long = 'A'.repeat(60);
    const name = suggestedPresenterCopyName(long, [long]);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith(' copy')).toBe(true);
    expect(name).not.toBe(long);
  });
});
