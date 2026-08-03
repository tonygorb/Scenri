import { parse, type HTMLElement } from 'node-html-parser';

export function loadHtml(html: string): HTMLElement {
  return parse(html);
}

export function attr(el: HTMLElement | null | undefined, name: string): string | undefined {
  return el?.getAttribute(name) ?? undefined;
}

export function textOf(el: HTMLElement | null | undefined): string {
  return (el?.text ?? '').replace(/\s+/g, ' ').trim();
}
