/**
 * What a phone sees when it opens Scenri without the code: someone typed the
 * address instead of scanning, or the link lost its code on the way. It is
 * mostly seen on phones, so it is built as a phone screen first.
 *
 * Self-contained on purpose: no script, stylesheet, font or image to fetch,
 * because nothing else on this server answers a device without the code. The
 * logo is inlined from the artwork of record (apps/studio/brand/
 * scenri-lockup.svg; codePage.test.ts fails if the two drift apart), and the
 * type is the system's own, which on a phone is what a code screen should be.
 *
 * The code field is the pattern one-time-code screens settled on: one real
 * input drawn as six boxes, not six inputs. One input is what lets iOS offer
 * the code, lets a paste land whole, gives Backspace and selection their
 * usual meaning, and reads as one field to a screen reader. It asks for the
 * number pad, takes a pasted code with or without its space, and a pasted
 * link by its t= part, and opens Scenri by itself on the sixth digit. Without
 * script it is a plain field that submits the form, and still works.
 */

export type CodeProblem = 'wrong' | 'locked' | null;

/** Symbol then wordmark, the same paths as the studio's ScenriLockup. */
export const LOCKUP_PATHS = [
  'M64 18.71V38.8L51.38 51.39V12.62H57.9C61.27 12.62 64 15.35 64 18.72V18.71Z',
  'M12.62 12.62V51.39H6.1C2.73 51.39 0 48.66 0 45.29V25.2L12.62 12.61V12.62Z',
  'M51.38 51.38L38.79 64H18.7C15.33 64 12.6 61.27 12.6 57.9V51.38H51.37H51.38Z',
  'M12.62 12.62L25.2 0H45.29C48.66 0 51.39 2.73 51.39 6.1V12.62H12.62Z',
  'M100.99 28.93L91.76 27.8C88.5 27.41 87.19 26.58 87.19 25.1C87.19 23.45 89.98 22.49 94.29 22.49C99.38 22.49 102.43 23.36 104.17 26.58L111.61 24.27C108.65 17.87 102.08 16 94.98 16C85.1 16 78.7 19.31 78.7 25.97C78.7 31.02 82.49 33.81 90.28 34.76L98.68 35.8C102.29 36.24 103.3 37.19 103.3 38.5C103.3 40.24 100.64 41.46 95.59 41.46C89.41 41.46 87.01 40.2 85.31 37.02L77.52 39.33C80.31 45.77 86.92 47.95 95.07 47.95C105.17 47.95 111.88 44.55 111.88 37.72C111.88 32.84 108.53 29.84 101 28.93H100.99Z',
  'M132.73 22.66C137 22.66 140.87 24.01 142.7 28.54L150.49 26.67C148.79 20.66 142.3 16.05 132.6 16.05C121.41 16.05 113.44 22.23 113.44 31.98C113.44 41.73 121.41 48 132.6 48C142.31 48 148.8 43.3 150.49 37.29L142.7 35.42C140.87 39.95 137 41.3 132.73 41.3C126.94 41.3 122.24 38.38 122.24 32.42V31.55C122.24 25.59 126.94 22.67 132.73 22.67V22.66Z',
  'M161.51 34.89H179.58V28.71H161.51V22.97H181.54V16.52H152.8V47.43H181.84V40.99H161.51V34.89Z',
  'M208.71 33.85H208.67L193.86 16.52H184.94V47.43H193.04V27.49H193.08L210.15 47.43H216.81V16.52H208.71V33.85Z',
  'M252.25 26.8C252.25 20.14 248.07 16.52 239.84 16.52H220.77V47.43H229.48V37.5H236.62L242.63 47.43H252.56L245.55 36.37C249.9 34.8 252.25 31.62 252.25 26.79V26.8ZM243.54 27.32C243.54 29.98 242.06 31.28 239.06 31.28H229.48V22.96H239.06C242.06 22.96 243.54 24.27 243.54 26.88V27.32Z',
  'M263.79 16.52H255.08V47.43H263.79V16.52Z',
];

/** Every sentence the page can say, server-rendered or set by its script. */
export const CODE_PAGE_COPY = {
  title: 'Enter your code',
  where: 'It is on the computer running Scenri, in Settings, Phone and tablet.',
  label: '6-digit code',
  open: 'Open Scenri',
  opening: 'Opening',
  foot: 'Scenri runs on your computer. The code keeps it to your devices.',
  wrong: 'That code did not work. Try again.',
  locked: 'Too many tries. Wait a few minutes.',
  short: 'Enter all 6 digits.',
  offline: 'Could not reach Scenri. Is this device on the same Wi-Fi?',
} as const;

const symbolIcon = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>path{fill:#0a0a0a}@media(prefers-color-scheme:dark){path{fill:#f5f5f5}}</style>${LOCKUP_PATHS.slice(
    0,
    4,
  )
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const STYLE = `
:root {
  color-scheme: light dark;
  --page: #f6f6f6; --card: #ffffff; --ink: #0a0a0a; --on-ink: #ffffff; --soft: #666666; --faint: #767676;
  --line: #e8e8e8; --field: #f4f4f4; --field-line: #e4e4e4; --ring: rgba(10, 10, 10, 0.08);
  --off: #e6e6e6; --off-ink: #9a9a9a; --red: #d93025; --green: #188038;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #0d0d0d; --card: #141414; --ink: #f5f5f5; --on-ink: #0a0a0a; --soft: #9a9a9a; --faint: #858585;
    --line: #262626; --field: #1a1a1a; --field-line: #2e2e2e; --ring: rgba(245, 245, 245, 0.1);
    --off: #262626; --off-ink: #6e6e6e; --red: #ff6b62; --green: #4ade80;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0; background: var(--card); color: var(--ink);
  font: 16px/1.45 var(--font); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
}
.shell {
  min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center;
  padding: max(44px, calc(env(safe-area-inset-top) + 28px)) max(24px, env(safe-area-inset-right))
    max(28px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
}
.lockup { display: block; width: auto; height: 22px; margin: 0 0 40px; color: var(--ink); }
.card { width: 100%; max-width: 380px; text-align: center; }
h1 { margin: 0; font-size: 26px; line-height: 1.15; font-weight: 700; letter-spacing: -0.025em; }
.where { margin: 10px auto 30px; max-width: 29ch; color: var(--soft); font-size: 15px; text-wrap: balance; }
.vh {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.otp { position: relative; }
.slots {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 12px repeat(3, minmax(0, 1fr));
  gap: 8px; max-width: 344px; margin: 0 auto;
}
.slot {
  position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 5;
  border: 1px solid var(--field-line); border-radius: 12px; background: var(--field);
  font-size: 28px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink);
  transition: border-color 0.14s ease, box-shadow 0.14s ease, background-color 0.14s ease;
}
.slot[data-on] { border-color: var(--ink); box-shadow: 0 0 0 3px var(--ring); background: var(--card); }
.slot[data-on]:empty::after {
  content: ""; width: 2px; height: 28px; border-radius: 1px; background: var(--ink);
  animation: blink 1.06s steps(1, end) infinite;
}
.sep { align-self: center; justify-self: center; width: 10px; height: 2px; border-radius: 1px; background: var(--field-line); }
.otp[data-state="error"] .slot { border-color: var(--red); box-shadow: none; }
.otp[data-state="error"] .slots { animation: shake 0.36s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
.otp[data-state="ok"] .slot { border-color: var(--green); }
.otp[data-state="busy"] .slot { opacity: 0.55; }
/* the real field, drawn by the boxes: transparent over them, so any box can be tapped */
.js .otp input {
  position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; padding: 0;
  border: 0; outline: 0; background: transparent; color: transparent; -webkit-text-fill-color: transparent;
  caret-color: transparent; font-size: 16px; text-indent: -9999px; cursor: text;
  -webkit-appearance: none; appearance: none;
}
.js .otp input::selection { background: transparent; }
.js .otp input:-webkit-autofill { transition: background-color 600000s 0s, color 600000s 0s; }
/* without script: a plain field that still takes the code and submits */
.nojs .slots { display: none; }
.nojs .otp input {
  display: block; width: 100%; max-width: 344px; height: 60px; margin: 0 auto; padding: 0 16px;
  border: 1px solid var(--field-line); border-radius: 12px; background: var(--field); color: var(--ink);
  font: 600 28px/1 var(--font); letter-spacing: 0.3em; text-align: center; font-variant-numeric: tabular-nums;
}
.msg { min-height: 20px; margin: 12px 0 16px; color: var(--red); font-size: 14px; line-height: 20px; }
.go {
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; max-width: 344px;
  height: 52px; margin: 0 auto; border: 0; border-radius: 999px; background: var(--ink); color: var(--on-ink);
  font: 600 16px/1 var(--font); letter-spacing: -0.01em; cursor: pointer; touch-action: manipulation;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
/* its own colours when it cannot be pressed yet, never a faded ink */
.go:disabled { background: var(--off); color: var(--off-ink); cursor: default; }
.otp[data-state="busy"] ~ .go:disabled, .otp[data-state="ok"] ~ .go:disabled { background: var(--ink); color: var(--on-ink); }
.go:active:not(:disabled) { transform: scale(0.985); }
.go:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.spin {
  width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.foot {
  display: flex; align-items: flex-start; justify-content: center; gap: 8px; max-width: 34ch;
  margin: 36px auto 0; color: var(--faint); font-size: 13px; line-height: 18px; text-align: left;
}
.foot svg { flex: none; width: 14px; height: 14px; margin-top: 2px; }
@keyframes blink { 50% { opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shake {
  10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); }
  30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); }
}
/* a phone with its keyboard up (Android resizes the page for it): everything moves up */
@media (max-height: 560px) {
  .shell { padding-top: max(20px, calc(env(safe-area-inset-top) + 12px)); }
  .lockup { height: 18px; margin-bottom: 18px; }
  h1 { font-size: 22px; }
  .where { margin: 6px auto 18px; font-size: 14px; }
  .foot { display: none; }
}
/* a tablet or a computer: the same content, on a card in the middle of the page */
@media (min-width: 560px) and (min-height: 600px) {
  body { background: var(--page); }
  .shell { justify-content: center; padding-bottom: max(10vh, 28px); }
  .lockup { margin-bottom: 32px; }
  .card {
    max-width: 420px; padding: 40px 36px 32px; border: 1px solid var(--line); border-radius: 20px;
    background: var(--card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 16px 40px -16px rgba(0, 0, 0, 0.14);
  }
  .foot { margin-top: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .slot, .go { transition: none; }
  .slot[data-on]:empty::after, .otp[data-state="error"] .slots { animation: none; }
  .spin { animation-duration: 1.6s; }
}
@media (forced-colors: active) {
  .slot { border-color: CanvasText; }
  .slot[data-on] { outline: 2px solid Highlight; }
}
`;

/**
 * The script: sanitises what arrives (typed, pasted, autofilled), draws the
 * boxes, and checks the code with a quiet request so a wrong one shakes in
 * place rather than reloading. The right one lands where the person was going.
 */
const SCRIPT = (copy: typeof CODE_PAGE_COPY) => `
(function () {
  var LEN = 6, COPY = ${JSON.stringify({ open: copy.open, opening: copy.opening, wrong: copy.wrong, locked: copy.locked, short: copy.short, offline: copy.offline })};
  var form = document.getElementById('form'), input = document.getElementById('code');
  var otp = document.getElementById('otp'), msg = document.getElementById('msg'), go = document.getElementById('go');
  var slots = Array.prototype.slice.call(document.querySelectorAll('.slot'));
  var busy = false;
  input.maxLength = LEN;
  function digits(s) { return String(s || '').replace(/\\D/g, '').slice(0, LEN); }
  function fromPaste(s) { var m = /[?&]t=([^&#\\s]+)/.exec(s || ''); return digits(m ? m[1] : s); }
  function toEnd() { var n = input.value.length; try { input.setSelectionRange(n, n); } catch (e) {} }
  function paint() {
    var v = input.value, on = document.activeElement === input && !busy;
    for (var i = 0; i < LEN; i++) {
      slots[i].textContent = v.charAt(i);
      if (on && i === Math.min(v.length, LEN - 1)) slots[i].setAttribute('data-on', '');
      else slots[i].removeAttribute('data-on');
    }
    go.disabled = busy || v.length !== LEN;
  }
  function state(s, text) {
    otp.removeAttribute('data-state');
    void otp.offsetWidth;
    if (s) otp.setAttribute('data-state', s);
    msg.textContent = text || '';
    input.setAttribute('aria-invalid', s === 'error' ? 'true' : 'false');
  }
  function label(busyNow) {
    go.textContent = busyNow ? COPY.opening : COPY.open;
    if (!busyNow) return;
    var s = document.createElement('span');
    s.className = 'spin'; s.setAttribute('aria-hidden', 'true');
    go.insertBefore(s, go.firstChild);
  }
  function fail(kind, clear) {
    busy = false; label(false); state('error', COPY[kind]);
    if (navigator.vibrate) navigator.vibrate(40);
    if (clear) setTimeout(function () { input.value = ''; paint(); input.focus(); }, 420);
    paint();
  }
  function submit() {
    var code = digits(input.value);
    if (busy) return;
    if (code.length !== LEN) { state('error', COPY.short); input.focus(); return; }
    busy = true; state('busy', ''); label(true); paint();
    fetch('/api/phone?t=' + code, { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        if (res.ok) {
          state('ok', '');
          var u = new URL(location.href); u.searchParams.delete('t');
          location.replace(u.pathname + u.search + u.hash);
          return;
        }
        return res.json().catch(function () { return {}; }).then(function (b) {
          fail(b && b.error === 'too many tries' ? 'locked' : 'wrong', true);
        });
      })
      .catch(function () { fail('offline', false); });
  }
  input.addEventListener('input', function () {
    var clean = digits(input.value);
    if (clean !== input.value) input.value = clean;
    if (otp.getAttribute('data-state') === 'error') state('', '');
    toEnd(); paint();
    if (clean.length === LEN) submit();
  });
  input.addEventListener('paste', function (e) {
    var text = e.clipboardData ? e.clipboardData.getData('text') : '';
    e.preventDefault();
    input.value = fromPaste(text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ['focus', 'blur', 'click', 'select', 'keyup'].forEach(function (t) {
    input.addEventListener(t, function () { if (t !== 'blur') toEnd(); paint(); });
  });
  // a form will not submit itself while its button is disabled, so Enter is heard here
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    busy = false; input.value = ''; label(false); state('', ''); paint();
  });
  if (msg.textContent) state('error', msg.textContent);
  paint();
  input.focus();
})();
`;

const LOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.75"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"/></svg>`;

export function codePage(problem: CodeProblem): string {
  const c = CODE_PAGE_COPY;
  const note = problem ? c[problem] : '';
  const slot = '<span class="slot"></span>';
  return `<!doctype html>
<html lang="en" class="nojs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0d0d" media="(prefers-color-scheme: dark)">
<meta name="format-detection" content="telephone=no">
<title>Open Scenri</title>
<link rel="icon" href="${symbolIcon()}">
<script>document.documentElement.className = 'js';</script>
<style>${STYLE}</style>
</head>
<body>
<main class="shell">
<svg class="lockup" viewBox="0 0 263.79 64" fill="currentColor" role="img" aria-label="Scenri">${LOCKUP_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
<section class="card" aria-labelledby="title">
<h1 id="title">${c.title}</h1>
<p class="where" id="where">${c.where}</p>
<form id="form" method="get" action="" novalidate>
<div class="otp" id="otp">
<label class="vh" for="code">${c.label}</label>
<input id="code" name="t" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="one-time-code" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" autofocus required aria-describedby="where msg" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other">
<div class="slots" aria-hidden="true">${slot.repeat(3)}<span class="sep"></span>${slot.repeat(3)}</div>
</div>
<p class="msg" id="msg" role="alert">${note}</p>
<button type="submit" class="go" id="go">${c.open}</button>
</form>
</section>
<p class="foot">${LOCK}<span>${c.foot}</span></p>
</main>
<script>${SCRIPT(c)}</script>
</body>
</html>
`;
}
