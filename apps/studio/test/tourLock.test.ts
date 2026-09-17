import { describe, it, expect, beforeEach } from 'vitest';
import { LOCK_MARK, createLock } from '../src/layout/tourLock.js';

/**
 * jsdom does not act on `inert`; these prove the bookkeeping: what is held,
 * what is left live, and that a release only ever undoes the lock's own marks.
 */
let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="app">
      <header id="bar"><nav id="nav"><a id="home">Home</a><a id="create">Create</a></nav></header>
      <main id="main"><div id="live" aria-live="polite"></div><section id="grid"><button id="card">Card</button></section><section id="wall" inert></section></main>
    </div>
    <div id="menu-portal"></div>
    <div id="tour"></div>`;
  root = document.body;
});

const inert = (id: string) => document.getElementById(id)!.hasAttribute('inert');

describe('the tour lock', () => {
  it('holds every branch except the kept elements and their ancestors', () => {
    const lock = createLock(root);
    lock.set([document.getElementById('create')!, document.getElementById('tour')!, document.getElementById('live')!]);
    expect(inert('home')).toBe(true);
    expect(inert('create')).toBe(false);
    expect(inert('nav')).toBe(false);
    expect(inert('bar')).toBe(false);
    expect(inert('app')).toBe(false);
    expect(inert('grid')).toBe(true);
    expect(inert('live')).toBe(false);
    expect(inert('menu-portal')).toBe(true);
    expect(inert('tour')).toBe(false);
  });

  it('never claims a node something else made inert, and never frees it', () => {
    const lock = createLock(root);
    lock.set([document.getElementById('card')!]);
    expect(document.getElementById('wall')!.hasAttribute(LOCK_MARK)).toBe(false);
    lock.release();
    expect(inert('wall')).toBe(true);
    expect(document.querySelectorAll(`[${LOCK_MARK}]`)).toHaveLength(0);
    expect(inert('home')).toBe(false);
  });

  it('moving the hold only changes what differs, and a release leaves the page as it was', () => {
    const lock = createLock(root);
    lock.set([document.getElementById('card')!]);
    expect(inert('bar')).toBe(true);
    lock.set([document.getElementById('create')!]);
    expect(inert('bar')).toBe(false);
    expect(inert('home')).toBe(true);
    expect(inert('main')).toBe(true);
    lock.release();
    expect(document.querySelectorAll('[inert]')).toHaveLength(1);
  });

  it('a kept element that has left the page is simply not kept', () => {
    const lock = createLock(root);
    const gone = document.createElement('button');
    lock.set([gone, document.getElementById('card')!]);
    expect(inert('card')).toBe(false);
    expect(inert('bar')).toBe(true);
  });
});
