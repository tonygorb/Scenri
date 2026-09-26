/// <reference types="vite/client" />

/**
 * What's New pictures, by the file name a release record gives them.
 *
 * The record lives in the CLI and only knows a name (`0.19.0-home-examples.webp`);
 * the picture ships inside this bundle, so What's New shows it offline and
 * nothing is fetched to explain a release. Every file in the folder is bundled,
 * which is why `releasePictures.test.ts` keeps the folder to the pictures the
 * in-app history still shows.
 *
 * A name with no file resolves to nothing, and the release reads as words
 * alone: a missing picture never leaves a hole.
 */
const PICTURES = import.meta.glob<string>('./assets/whatsnew/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function pictureUrl(file: string): string | null {
  return PICTURES[`./assets/whatsnew/${file}`] ?? null;
}
