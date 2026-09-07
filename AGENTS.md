# Working in this repository

Instructions for coding agents (Claude Code, Codex, Cursor) and for people working beside them.
The human guide is `CONTRIBUTING.md`; this file is only the conduct that keeps parallel checkouts
from colliding.

## Where work happens

Every task runs in its own git worktree under `../scenri-worktrees/<slug>/`, one branch per
worktree, made with `pnpm worktree add <branch>` and removed with `pnpm worktree remove <slug>`
after the merge. The primary checkout stays on `main` and is never edited: it runs the maintainer's
server (4747), Vite (5173) and library (`~/.scenri`), and it is where worktrees are created, listed
and removed.

## In every session

1. Know where you are before anything else: `git rev-parse --git-dir` (a worktree's is under
   `.git/worktrees/`), `git branch --show-current`, `git worktree list`. Say it once.
2. Stay inside your checkout. Never `cd` into, edit, or run `git` in the primary or in another
   worktree. An absolute path that leaves the checkout is a bug.
3. One worktree, one branch, for its whole life. Never `git checkout` or `git switch` to another
   branch. Create and remove worktrees only with `pnpm worktree`, and only when asked.
4. Servers: `pnpm dev` and `pnpm dev:ui`, then read the URLs they print. In a worktree they run on
   that worktree's own lane. Never assume 4747 or 5173, never set `SCENRI_PORT`, `SCENRI_HOME` or
   `SCENRI_API` by hand, never stop a server you did not start, and never use Shut down in a
   studio you did not start.
5. Data: a worktree's library is its own `.scenri-home/`, a copy made at creation. `~/.scenri`
   belongs to the primary and is never pointed at from a worktree.
6. Browser tooling shares one Chrome. Open your own page; never navigate a tab you did not open.
7. Shipping: conventional commits (the prefix is the version), `git push -u origin <branch>`, a
   draft pull request, mark it ready when done. Merging a pull request and cutting a release are
   the maintainer's decisions, asked for each one; nothing merges or releases on an agent's own
   initiative.
8. `pnpm install --frozen-lockfile`. `pnpm test:visual` and the performance rig run in the primary
   only.
9. Claude Code: do not create worktrees with its own worktree tool; `pnpm worktree add` is the
   convention, and entering a worktree that already exists by its path is fine.

Everything else, from setup to what CI runs, is in `CONTRIBUTING.md`.
