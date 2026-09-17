import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  inputModality,
  installInputModality,
  keyboardFocus,
  resetInputModalityForTests,
} from '../src/inputModality.js';

let undo: () => void;

beforeEach(() => {
  resetInputModalityForTests();
  undo = installInputModality();
});
afterEach(() => undo());

const key = (k: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...init }));
const press = () => window.dispatchEvent(new Event('pointerdown'));

describe('input modality', () => {
  it('is unset until someone does something, so rings show on arrival', () => {
    expect(inputModality()).toBeNull();
    expect(document.documentElement.dataset.input).toBeUndefined();
  });

  it('a press says pointer and a key says keyboard', () => {
    press();
    expect(document.documentElement.dataset.input).toBe('pointer');
    key('Tab');
    expect(document.documentElement.dataset.input).toBe('keyboard');
    key('Escape');
    expect(inputModality()).toBe('keyboard');
  });

  it('a lone modifier or a composing key changes nothing', () => {
    press();
    key('Meta');
    key('Shift');
    key('a', { isComposing: true });
    key('Unidentified');
    expect(inputModality()).toBe('pointer');
  });

  it('focus after a press never counts as keyboard focus', () => {
    const b = document.createElement('button');
    document.body.appendChild(b);
    press();
    b.focus();
    expect(keyboardFocus(b)).toBe(false);
    b.remove();
  });
});
