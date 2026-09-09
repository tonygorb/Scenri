import { describe, expect, it } from 'vitest';
import {
  type ChoiceGroup,
  type Turn,
  choiceFromText,
  groupsAnswered,
  THINK_MS,
  answersNothing,
  revealDuration,
  revealPlan,
  smallTalk,
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

describe('the arrival', () => {
  it('is word by word, a beat after the turn before it, and never past seven tenths', () => {
    expect(revealPlan('Maren').words).toEqual(['Maren']);
    expect(revealPlan('What should we call them?').step).toBe(28);
    expect(revealDuration('What should we call them?')).toBe(THINK_MS + 180 + 28 * 5 + 160);
    const long = revealPlan(Array.from({ length: 60 }, () => 'word').join(' '));
    expect(long.step * 60).toBeLessThanOrEqual(700);
    expect(revealDuration('')).toBe(THINK_MS + 180 + 160);
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

describe('small talk', () => {
  it('is a greeting, a thanks, a test, or a word or two that describes nobody', () => {
    for (const t of ['hello', 'Hi!', 'hey there', 'thanks', 'ok', 'test', '?', 'yes', 'help'])
      expect(smallTalk(t)).toBe(true);
  });
  it('is named for what it is, so the reply can answer it', () => {
    const table: Record<string, string[]> = {
      greeting: ['hey there', 'hello Scenri', 'good morning', 'thanks a lot'],
      ack: ['ok', 'sure', 'yes!', 'lol', 'hmm'],
      question: ['how are you?', 'what is this', 'who are you', 'can you help me?', 'is this free', 'and then?'],
      nav: ['start over', 'restart', 'cancel', 'go back', 'never mind'],
      go: ['skip', 'go on', 'draw', 'start'],
      help: ['help', 'help me', '???', 'what do i do'],
      intent: ['i want to create a presenter', 'make me a presenter', 'new presenter', 'create'],
      nonsense: [
        'bullshit',
        'this is bullshit',
        'asdf',
        'asdfgh jkl',
        'qwerty',
        'blah blah blah',
        'lorem ipsum',
        '12345',
        '!!!',
        'test test',
        'aaaaaaa',
        'wtf',
      ],
      likeness: ['like Zendaya', 'looks like Brad Pitt', 'a woman like Audrey Hepburn'],
      vague: ['nothing much', 'maybe later'],
    };
    for (const [kind, texts] of Object.entries(table))
      for (const t of texts) expect([t, answersNothing(t)]).toEqual([t, kind]);
    for (const t of [
      'a woman',
      'late 30s',
      'silver hair',
      'tall guy',
      'Maren',
      'shorter hair',
      'older',
      'why not a woman in her 40s',
      'like Mediterranean women, olive skin',
      'a florist from Paris who sells tulips',
    ])
      expect([t, answersNothing(t)]).toEqual([t, null]);
  });
  it('is not a sentence about a person, however short', () => {
    for (const t of [
      'a woman',
      'late 30s',
      'silver hair',
      'tall guy',
      'Maren',
      'shorter hair',
      'older',
      'two photos',
      'from scratch',
    ])
      expect(smallTalk(t)).toBe(false);
  });
});
