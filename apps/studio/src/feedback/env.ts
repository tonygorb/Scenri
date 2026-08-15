import type { Environment } from './types.js';

/**
 * Enough about the machine to reproduce a layout bug, and nothing more.
 *
 * Deliberately not collected: anything that would fingerprint a person rather
 * than describe a viewport — no canvas hash, no font enumeration, no plugin
 * list, no timezone offset games, no IP. The user agent is kept raw but
 * clipped, because browser-version bugs are real and a parsed guess loses the
 * detail that would identify one.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg\/([\d.]+)/, 'Edge'],
  [/\bOPR\/([\d.]+)/, 'Opera'],
  [/\bFirefox\/([\d.]+)/, 'Firefox'],
  // no \b before Chrome: HeadlessChrome and several branded builds spell it
  // as a suffix, and reporting "unknown" for those loses the version that
  // usually explains the bug
  [/Chrome\/([\d.]+)/, 'Chrome'],
  [/\bVersion\/([\d.]+).*Safari/, 'Safari'],
];

const OSES: [RegExp, string][] = [
  [/\biPhone\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

const match = (ua: string, table: [RegExp, string][], withVersion: boolean): string => {
  for (const [re, name] of table) {
    const m = ua.match(re);
    if (m) return withVersion && m[1] ? `${name} ${m[1].split('.')[0]}` : name;
  }
  return 'unknown';
};

/**
 * phone / tablet / desktop by the same rules the CSS uses, so a report agrees
 * with the layout the tester was actually looking at. tokens.css breaks at
 * 767px and the touch rules hang off `pointer: coarse`.
 */
function deviceClass(): Environment['device'] {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (window.matchMedia('(max-width: 767px)').matches) return 'phone';
  return coarse ? 'tablet' : 'desktop';
}

export function readEnvironment(): Environment {
  const ua = navigator.userAgent;
  return {
    build: __SC_BUILD__,
    browser: match(ua, BROWSERS, true),
    os: match(ua, OSES, false),
    device: deviceClass(),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    theme: document.documentElement.dataset.theme ?? 'unknown',
    online: navigator.onLine,
    language: navigator.language,
    at: new Date().toISOString(),
  };
}
