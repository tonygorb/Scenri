import { describe, expect, it } from 'vitest';
import {
  photoTooBig,
  photoTrouble,
  photoUnreadable,
  stageHint,
  stageLead,
} from '../src/create/presenter/presenterCopy.js';

/**
 * The stage's second line points at wherever the work actually is, and the
 * work is not always describing.
 */
describe('what the empty stage says under its sign', () => {
  it('points at the conversation while there is still something to describe', () => {
    expect(stageHint('look-hair')).toBe('Keep describing your presenter');
    expect(stageHint(null)).toBe('Keep describing your presenter');
  });

  it('asks for photographs where photographs are what is wanted', () => {
    expect(stageHint('photos')).toBe('Add their photos');
  });

  it('stops asking for more once there is nothing left to ask', () => {
    expect(stageHint('agree')).toBe('Ready when you are');
  });

  it('says one line whatever is being asked, so the sign never changes height', () => {
    const said = ['look-hair', 'photos', 'agree', null].map((q) => stageHint(q));
    expect(said.every((s) => !s.includes('\n') && s.length < 40)).toBe(true);
  });
});

/**
 * Choosing files is one action that can go wrong several ways at once, and
 * every one of those ways used to be silent.
 */
describe('what is said about photographs that did not arrive', () => {
  const none = { over: 0, same: 0, failed: [], max: 4 };

  it('says nothing when every photograph arrived', () => {
    expect(photoTrouble(none)).toBeNull();
  });

  it('counts what would not fit rather than dropping it quietly', () => {
    expect(photoTrouble({ ...none, over: 1 })).toBe('That is one more than 4 photos, so the last one was not added.');
    expect(photoTrouble({ ...none, over: 2 })).toBe('That is 2 more than 4 photos, so the last 2 were not added.');
  });

  it('says a photograph is already here, so the chooser does not look broken', () => {
    expect(photoTrouble({ ...none, same: 1 })).toBe('One of those is already here.');
    expect(photoTrouble({ ...none, same: 3 })).toBe('3 of those are already here.');
  });

  it('names the file that could not be read, and what would work instead', () => {
    const said = photoTrouble({ ...none, failed: [photoUnreadable('holiday.jpg')] });
    expect(said).toContain('holiday.jpg');
    expect(said).toContain('JPEG');
    expect(said).not.toContain('Vips');
  });

  it('names the size a file passed, in the units a person uses', () => {
    expect(photoTooBig('huge.png', 25 * 1024 * 1024)).toBe(
      'huge.png is larger than 25MB. Choose a smaller copy of it.',
    );
  });

  it('says all of it in one line when several things went wrong at once', () => {
    const said = photoTrouble({ over: 1, same: 1, failed: [photoUnreadable('bad.jpg')], max: 4 });
    expect(said).toContain('not added');
    expect(said).toContain('already here');
    expect(said).toContain('bad.jpg');
  });
});

/**
 * The sign on an empty stage names what that stage is waiting for. On the
 * photo path the portrait is the person's own photograph and exists from the
 * start, so "First portrait appears here" would be a plain falsehood there.
 */
describe('what the empty stage says it is waiting for', () => {
  it('offers the first portrait before any draft exists', () => {
    expect(stageLead(undefined, 'face')).toBe('First portrait appears here');
  });

  it('still offers the first portrait when the face is what is missing', () => {
    expect(stageLead('portrait', 'face')).toBe('First portrait appears here');
  });

  it('names the view being waited for once the face is settled', () => {
    expect(stageLead('front', 'full body')).toBe('The full body appears here');
    expect(stageLead('three-quarter', 'three-quarter view')).toBe('The three-quarter view appears here');
  });
});
