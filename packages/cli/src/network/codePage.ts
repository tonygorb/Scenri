/**
 * What a phone sees when it opens Scenri without the code: someone typed the
 * address instead of scanning, or the link lost its code on the way. One
 * field, one button, the same words the computer shows beside the QR code.
 * Self-contained on purpose: no script, no stylesheet or font to fetch,
 * because nothing else on this server answers a device without the code.
 */

export type CodeProblem = 'wrong' | 'locked' | null;

const MESSAGES: Record<Exclude<CodeProblem, null>, string> = {
  wrong: 'That code did not work. Check it on your computer and try again.',
  locked: 'Too many tries. Wait a few minutes, then enter the code again.',
};

export function codePage(problem: CodeProblem): string {
  const note = problem ? `<p class="note" role="alert">${MESSAGES[problem]}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Open Scenri</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --ink: #161616; --soft: #5f5f5f; --line: #dcdad4; --warn: #9a3b1f; }
@media (prefers-color-scheme: dark) { :root { --bg: #121212; --card: #1c1c1c; --ink: #f2f2f2; --soft: #a3a3a3; --line: #333; --warn: #f0a080; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px; }
h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0 0 20px; color: var(--soft); }
label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
input { width: 100%; height: 48px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--ink); font: 600 22px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.18em; text-transform: uppercase; }
button { width: 100%; height: 48px; margin-top: 12px; border: 0; border-radius: 10px; background: var(--ink); color: var(--card); font: 600 16px/1 inherit; cursor: pointer; }
.note { margin: 16px 0 0; color: var(--warn); font-size: 14px; }
</style>
</head>
<body>
<main>
<h1>Open Scenri</h1>
<p>Enter the code shown in Scenri on your computer, under Settings, General.</p>
<form method="get" action="/">
<label for="t">Code</label>
<input id="t" name="t" required autofocus maxlength="12" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text">
<button type="submit">Open</button>
</form>
${note}
</main>
</body>
</html>
`;
}
