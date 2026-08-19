# Privacy

scenri is a local application. This page says exactly what it stores and what
it sends, so the claim "local-first" is checkable rather than decorative.

## Where your work lives

Everything you make stays on your machine, in `$SCENRI_HOME` (default
`~/.scenri`): brands, images, shot history, settings, and provider keys, in a
SQLite database and an image folder. There is no scenri account, no scenri
server, and no copy of your work anywhere else. Deleting that folder deletes
everything.

The browser side keeps only interface state (theme, drafts, bookmarks, layout
preferences) in localStorage. On a normal local run scenri sets no cookies. The
optional LAN mode sets one strictly functional session cookie so the access
token can leave the address bar; it identifies the session to your own server
and nothing else.

## What scenri sends on its own behalf

Exactly two requests, both disclosed in the terminal the first time they run,
and both optional:

1. **A version check** against the npm registry (name and version numbers only,
   nothing about you), at most once a day, so updates can announce themselves.
   Off switch: `SCENRI_NO_UPDATE_CHECK=1` or Settings.
2. **A one-time download of the library imagery archive** from this
   repository's GitHub Releases, cached locally forever after. Off switch:
   `SCENRI_NO_CONTENT_FETCH=1`.

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
policy, not by scenri. scenri never sees it, proxies it, or stores it anywhere
but your own disk.

The website importers (brand kit from a URL, product catalog import) fetch the
URLs you paste, directly from your machine.

## Your keys

Provider keys are stored in the local database, sent only to their own
provider, and never returned by the API: the settings endpoint answers with a
boolean, not the value. `.brand` exports and library exports never contain
credentials. scenri never reads or stores your ChatGPT credential; the Codex
sign-in happens in your own browser with the official CLI.

## The short version

Your work stays home. Two version-and-imagery requests, both disclosed and both
switchable. Generation goes straight to the provider you chose. Nothing about
you is collected, because there is nowhere to collect it to.
