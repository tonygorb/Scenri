# Contextual feedback (alpha builds only)

`npx scenri@alpha` carries a feedback layer that `npx scenri` does not. This
page says exactly what it collects, what it never collects, and how to check
that for yourself — because scenri promises no telemetry in three places, and a
promise that is not checkable is not worth much.

## It is not telemetry

Telemetry is automatic and continuous. This is neither.

- Nothing is collected until you press **Feedback** and pick something.
- Nothing leaves your machine until you press **Send**.
- **Send does not upload anything.** It copies a report to your clipboard and
  opens a GitHub issue form. You read it, you paste it, you decide to submit.
- There is no background collection, no beacon, no queue that retries later,
  and no network request to any scenri-operated server. There is no
  scenri-operated server.

The Settings row that says *"Telemetry — there is none"* stays true in the
alpha build, and it is not reworded, because it is still accurate.

## What a report contains

**Written by you:** your comment.

**Where you were:** the route pattern (`/:brandSlug/create/shots/:shotId`), the
path, which dialog was open, and the surface you clicked, named from the CSS
class chain — `Shot tile ← Shot feed ← Create canvas`. Plus the element's tag,
role, accessible name and on-screen box.

**Which shot, if you reported one:** the shot id, which variant, and the image
content hash. Reports on a generated image also include **the compiled prompt**
for that shot — it is the single most useful field for fixing generation bugs,
and it is shown to you, in full, in the composer before you send.

**Catalog ids** for the scenes, presenters and demo products involved. These are
filenames in `templates/` and exist on every machine, so the maintainer can open
the same thing you saw.

**Your own ids** — brand, project, shot, product — as UUIDs. They mean nothing
on anyone else's machine and are there so the maintainer can ask you a precise
question, not so they can look anything up. The report prints them under a
heading that says so.

**Environment:** build id, browser and OS name, phone/tablet/desktop, viewport
size, pixel ratio, theme, online state, language.

**Recent errors:** up to 25, from this session only, held in memory and never
written to disk. Each is a method, a status, a path and a message.

**A screenshot only if you attach one yourself.** scenri captures no pixels. If
the problem is visual, take a screenshot with your own OS shortcut and paste it
into the issue. Automatic capture was tried and removed — see below.

## What it never contains

- Any API key. scenri cannot read your saved keys back: `GET /api/settings`
  answers with booleans, not values.
- Request or response headers, request or response bodies, or the `sc_access`
  cookie.
- Anything from `localStorage`.
- Your access token. `?t=` is stripped from every URL in the report.
- Your home directory path. `/Users/you` and `/home/you` become `~`, because
  provider and `npm` errors quote absolute paths and those carry your username.
- Screenshots you did not take.

Every string in a finished report is passed through a scrubber that redacts
provider key shapes (`sk-…`, `r8_…`, `fal_…`, `ghp_…`) and any long opaque
token, while deliberately preserving the three shapes worth keeping: content
hashes, UUIDs, and catalog slugs. That rule is unit-tested against every id in
`templates/`, so it cannot start silently eating scene names.

## Why there is no automatic screenshot

The first design captured the viewport with DOM-to-image. Measured on the real
app it cost 2.5s on a phone-sized Create screen, 4.6s on a desktop one, and
**47 seconds on Home** — with a single 10-second blocked frame — because the
cost is roughly quadratic in DOM node count. Every mitigation failed:
restricting the copied CSS properties strips the `--sc-*` custom properties the
design system is built on and the page renders blank, and disabling font
embedding rewraps every label.

Pasting your own screenshot is instant, pixel-accurate, and means scenri never
handles your pixels at all.

## Checking this yourself

The layer is compiled out of the public build, not merely switched off:

```sh
pnpm --filter @scenri/studio build
grep -c "installFeedback\|scrubDeep\|areaChain" apps/studio/dist/assets/*.js   # 0
```

`__SC_ALPHA__` is substituted as the literal `false` there, so the bundler drops
the branch and everything only it reaches — including the feedback repo URL.

The code is in [`apps/studio/src/feedback/`](../apps/studio/src/feedback/).
`scrub.ts` is the redaction rule, `payload.ts` is everything a report can
contain, and `markdown.ts` is what gets written to your clipboard. Its tests
are in `apps/studio/test/feedback*.test.ts`.

## Where reports go

A private GitHub repository the maintainer owns, as an issue filed from your own
GitHub account. Nowhere else.
