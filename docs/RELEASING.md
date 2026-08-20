# How a release happens

Releases are automated; the version number is decided by commit messages, not
by hand.

`main` is the only long-lived branch. Work happens on a branch named for the
work, which reaches `main` through a pull request; there is no staging branch
in between, because the release pull request below already plays that part.

1. **Commits** follow Conventional Commits. `fix:` bumps the patch, `feat:`
   bumps the minor (this project is pre-1.0), and a breaking change is called
   out in the footer.
2. **release-please** watches `main` and maintains a release PR that
   accumulates changes and proposes the next version.
3. **The What's New record** in `packages/cli/src/release/notes.data.ts` must
   carry an entry for the proposed version, written by a person. A test
   (`releaseNotes.test.ts`) keeps the release PR red until it exists, on
   purpose: a release with no human sentence attached does not ship.
4. **Merging the release PR** creates the tag and the GitHub release. Like
   every runtime PR it runs the full pipeline, browser suite included, and
   cannot merge until the required "CI gate" check is green.
5. **Publishing** runs on the release event: the workflow rebuilds everything,
   stages the exact npm package, runs the test suite against that staged
   surface, prints the tarball's file list, and publishes to npm via trusted
   publishing (OIDC, no tokens). Provenance is attached automatically.

A contributor never needs to do any of this. Land a conventionally-named
commit through a PR and the pipeline does the rest. If your PR is part of a
release and CI asks for release notes, that entry is written by the maintainer
at release time.
