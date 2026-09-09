import { describe, expect, it } from 'vitest';
import {
  type ChoiceGroup,
  type Turn,
  choiceFromText,
  groupsAnswered,
  revealDuration,
  turnKey,
} from '../src/conversation/question.js';

const doors = [
  { id: 'photos', label: 'Add photos' },
  { id: 'scratch', label: 'Describe someone' },
];

describe('a typed sentence at a choice question', () => {
  it('names an option by its label or its id', () => {
    expect(choiceFromText('Add photos', doors)).toBe('photos');
    expect(choiceFromText('describe someone', doors)).toBe('scratch');
    expect(choiceFromText('scratch', doors)).toBe('scratch');
  });
  it('names an option by a plain synonym', () => {
    expect(choiceFromText('I have photos', doors)).toBe('photos');
    expect(choiceFromText('from my pictures', doors)).toBe('photos');
    expect(choiceFromText('upload', doors)).toBe('photos');
    expect(choiceFromText('from scratch', doors)).toBe('scratch');
    expect(choiceFromText('make someone up', doors)).toBe('scratch');
  });
  it('is not a choice when the sentence is the answer itself', () => {
    expect(choiceFromText('Late 30s, Mediterranean, dark shoulder-length hair, slim build, elegant', doors)).toBeNull();
    expect(choiceFromText('', doors)).toBeNull();
    expect(choiceFromText('Maren', doors)).toBeNull();
  });
});

describe('the arrival sweep', () => {
  it('is short for a short line and never longer than six tenths', () => {
    expect(revealDuration('Maren')).toBe(180);
    expect(revealDuration('What should we call them?')).toBe(25 * 14);
    expect(revealDuration('x'.repeat(200))).toBe(600);
  });
});

describe('grouped choices', () => {
  const groups: ChoiceGroup[] = [
    { id: 'who', label: 'Who', options: [{ id: 'woman', label: 'Woman' }] },
    { id: 'age', label: 'Age', options: [{ id: '30s', label: '30s' }] },
  ];
  it('answer together only when every row has a pick', () => {
    expect(groupsAnswered(groups, {})).toBe(false);
    expect(groupsAnswered(groups, { who: 'woman' })).toBe(false);
    expect(groupsAnswered(groups, { who: 'woman', age: '30s' })).toBe(true);
  });
});

describe('turn keys', () => {
  it('are stable by id, never by position', () => {
    const a: Turn = { kind: 'you', id: 'name', text: 'Maren' };
    const b: Turn = { kind: 'question', question: { id: 'source', kind: 'choice', prompt: 'Who?', options: doors } };
    expect(turnKey(a)).toBe('you:name');
    expect(turnKey(b)).toBe('q:source');
    expect(turnKey({ kind: 'scenri', id: 'drawing', text: 'Drawing their face.' })).toBe('scenri:drawing');
  });
});
