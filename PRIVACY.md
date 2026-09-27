# Privacy

Scenri is a local application. This page says exactly what it stores and what
it sends, so the claim "local-first" is checkable rather than decorative.

## Where your work lives

Everything you make stays on your machine, in `$SCENRI_HOME` (default
`~/.scenri`): brands, images, shot history, settings, and provider keys, in a
SQLite database and an image folder. There is no Scenri account, no Scenri
server, and no copy of your work anywhere else. Deleting that folder deletes
everything.

The browser side keeps only interface state (theme, drafts, bookmarks, layout
preferences) in localStorage. Scenri sets no cookies in this computer's own
browser. A phone or tablet that opens Scenri with its access code gets one
strictly functional cookie, kept for 400 days so it stays signed in, which
carries that code to your own server and nothing else.

A phone talks straight to your computer over your own network. To show the
right address, Scenri asks the operating system which network its default
route uses, by opening a UDP socket toward `192.0.2.1`, a documentation
address no host answers. No packet is sent: the question never leaves the
machine.

## What Scenri sends on its own behalf

Exactly two requests, both disclosed in the terminal the first time they run,
and both optional:

1. **A version check** against the npm registry (name and version numbers only,
   nothing about you), every six hours while Scenri runs, so updates can announce themselves.
   When it finds a newer version, Scenri also downloads that release from npm
   and stages it locally, the same request installing the package made;
   restarting into it is always your choice. Off switch for both:
   `SCENRI_NO_UPDATE_CHECK=1` or Settings.
2. **The download of the library imagery archive** from this repository's
   GitHub Releases, cached locally. It happens once for each archive a Scenri
   version pins, so an update that brings new imagery downloads it again.
   Off switch: `SCENRI_NO_CONTENT_FETCH=1`.

Both carry no identifier, no telemetry, and no user data. Like any HTTP
request, they expose your IP address to the server that answers them (npm and
GitHub respectively), the same as installing the package did.

There is no analytics, no crash reporting, no tracking of any kind, and no
scenri-operated server to send anything to.

## What you choose to send to a provider

When you generate an image, your brief (and any reference images it carries)
goes directly from your machine to the provider you configured: OpenRouter,
Replicate, or fal, using your own key, or the local Codex CLI, using your own
ChatGPT session. That data is governed by that provider's terms and privacy
policy, not by Scenri. Scenri never sees it, proxies it, or stores it anywhere
but your own disk.

With Codex connected, Scenri also reads each product's real size once from
its first photo, so shots draw it at scale. That photo goes to Codex like a
generation's references do, the answer is kept in your library, and you can
correct it on the product's page.

The website importers (brand kit from a URL, product catalog import) fetch the
URLs you paste, directly from your machine.

## Your keys

Provider keys are stored in the local database, sent only to their own
provider, and never returned by the API: the settings endpoint answers with a
boolean, not the value. `.brand` exports and library exports never contain
credentials. Scenri never reads or stores your ChatGPT credential; the Codex
sign-in happens in your own browser with the official CLI. Two things Scenri
does touch in Codex's own folder: it reads the names (never the values) of the
MCP servers and plugins in `~/.codex/config.toml`, so its runs can switch them
off, and once a picture Codex drew is safe in your library, it deletes Codex's
byte-identical copy, so a shot you delete in Scenri does not live on there.

## The short version

Your work stays home. The update check with its staged download, and the
imagery archive, both disclosed and both switchable. Generation goes straight
to the provider you chose. Nothing about you is collected, because there is
nowhere to collect it to.
