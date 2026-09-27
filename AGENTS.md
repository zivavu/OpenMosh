This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Memory

I work on this repo from several devices and agents, so this file is the only memory. Don't write
to or rely on a tool's own memory store (Claude's `memory/` directory and the like). When a
decision should outlast the session, add a line or two here, in the section it belongs to.

## Commands

```bash
bun install        # Install dependencies
bun dev            # Start dev server (Vite)
bun run build      # Production build
bun preview        # Preview production build
bun check          # TypeScript + Svelte type-check (svelte-check + tsc)
bun test           # Unit suite (bun:test)
bun run test:e2e   # Playwright suite under tests/e2e (`bunx playwright install chromium` once)
```

Unit tests sit next to what they cover as `*.test.ts` and cover pure logic only.

Keep the local Bun on the version `.github/workflows/ci.yml` pins (`bun --version`). Older Bun
can't `structuredClone` a Blob, so the storage tests fail locally while CI passes.

## Verification

I test changes by hand in my own dev server. Don't drive the app in a browser (the `/verify`
skill's harness, ad-hoc Playwright scripts) unless I ask, or a bug can't be diagnosed any other
way, and say so first. When I do ask for screenshots, take one or two at the end, not one per
edit: they eat context fast.

## Key Conventions

- Svelte 5 runes only — use `$state`, `$derived`, `$effect`, `$props`, `$bindable`; use `mount()`
  not `new App()`; use `$state.snapshot()` when you need a plain object copy.
- Package manager: **bun** — always use `bun`, not `npm` or `yarn`.
- No MP4 or GIF export — both were intentionally removed; do not re-add either. (GIF files are supported as _input_; they animate.)
- When adding a new effect: add its `EffectDefinition` to `definitions.ts`, add its GLSL +
  `EffectShaderDef` to `effect-shaders.ts` (set `animated: true` if it uses `u_time` for
  animation — `ANIMATED_EFFECTS` is derived automatically, no separate registration needed),
  and give it a stage, family and amount param in `src/lib/effects/curation.ts` (the Curated
  mosh style needs it; a test fails without it) unless it's `moshable: false`.
- Never gate motion on `prefers-reduced-motion`. Windows ships with animations off by default, so
  honoring it flattened every animation, glitch effects included.
- PhotoMosh's code is proprietary: match its effects by how they look and behave, never by
  transcribing its source.

## Architecture decisions

- The editor mode (`#editor`) is still called `sequence` in code on purpose: storage keys,
  `SessionMode` and the `lastMode` setting use that word, and renaming them would orphan saved
  projects. `#sequence` still routes to the editor.
- Single, sequence and slideshow modes never share a per-track storage key.
- The editor has no primary source and no segment lane. The base is blank, media layers are the
  picture and FX lanes run on top. Don't bring back a base-media or gapless-segment concept;
  `legacy-segments.ts` converts old saves on load. The slideshow's `TimelineSegments` still uses
  the segment modules.
- Chain-clip behavior (fill/mosh/clear/static/auto) lives once in `lib/editor/chain-clip.ts`;
  `media/chain.ts` and `fx-lanes.ts` are thin wrappers. New chain-editing paths go through
  `chain-fanout.ts`, or a multi-selection edits only the primary clip.
- Undo: `createSnapshotHistory` stores the state _before_ each change. Push before mutating, pass
  the live state to `undo`/`redo`, and keep a coalesce key for one gesture only. Ctrl+Z goes to
  the stack with the newest edit, not the selected one.
- Preview and export share the "what's on screen at time t" resolvers; only sampler management
  (decoder keys, LRU cap, latch) is duplicated. Keep both sides feeding the same source times.
- Source edits (crop, chroma key, erase) are keyed on the source's own media time, not timeline
  time, and are sampled inside `GlRenderer`. An erase key holds a complete shape, like
  rotoscoping, and doesn't add to earlier keys. I chose that over cumulative erasing.
- Editor sound goes through the `lib/mix/` mixer; single mode and slideshow stay on
  `AudioManager`.
- Anything that reads a media layer's texture goes through `mediaLayerSides()`: transitions give
  each lane two textures.
- Code-split only what sits behind an `{#if}` that starts false, via `lib/lazy.ts`. Inline
  controls stay eager.
- Chrome never grants `navigator.storage.persist()` on `localhost`, and code can't fix that. Use
  `127.0.0.1`.

## Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release.yml`). Every merge to `main` updates an open "chore(main): release"
PR that bumps `version` in `package.json`, writes the new `CHANGELOG.md` section from the commit
messages merged since the last release and updates the README's Status version line. Merging that PR is the release: it tags
`vX.Y.Z`, publishes the GitHub Release and moves the `production` branch to the tag, which is
what Vercel serves. `main` itself only deploys as a Vercel preview.

- Never bump the version or edit `CHANGELOG.md` by hand; tidy the release PR's changelog instead.
  release-please rebuilds its PR only when the notes change, so a tidy means: `git fetch origin`
  first, rebuild the branch on current `main` as one commit, force-push it, and edit the PR body
  too, since the body is what becomes the GitHub Release notes. Do it after everything else for
  the release has merged; a later merge can overwrite it.
- Keep the commit (and PR) links release-please puts after each changelog line. 0.9.2 went out
  without them only because its lines all came from one override on a single commit.
- Run changelog text through the `/humanizer` skill before it goes in: the release PR's
  changelog, release notes, and `feat`/`fix`/`perf` commit messages, since those become
  changelog lines.
- Versioning: every release is a patch bump (0.9.2, 0.9.3, …) until I call 1.0.0, even when saved
  data changes shape. So never use `!` or `BREAKING CHANGE` (release-please would bump the minor);
  say what happens to old projects in the commit message or the release PR's changelog instead.
- Keep the README current in the PR that changes it: the effect count under "How to use it" and
  any credits a port owes.
- I merge release PRs. When a batch of work has landed, ask me whether it's time for one.
- Rolling back: Vercel's Instant Rollback, or `git push -f origin vX.Y.Z^{commit}:production`.

## Comments

- When adding comments - keep them very consise, or even better - write the code so descriptive that they are not needed.

## Git

- Never commit to `main`; it only takes PRs. PRs are rebase-merged (squash is off), so every
  commit on a branch lands on `main` as-is and becomes its own changelog line.
- Work goes on a batch branch, `batch/<slug>` (`batch/editor-polish`), from an up-to-date `main`:
  one branch collects several tasks, one commit each. Keep adding to the batch branch until its
  PR is opened; after that, start the next batch from it (or from `main` once it has merged) and
  rebase onto `main` before that batch's PR.
- A tweak to a change already committed on the branch is part of that commit: amend it, or fold it
  in with a fixup and an autosquash rebase. `main` should never see "fix the thing from before".
- Stage files by name, never `git commit -a` or `git add .`, and check
  `git diff --cached --name-only` before every commit: the tree often holds my own unrelated work
  in progress, and it may already be staged.
- Commit messages are conventional commits, ultra short, with the subject capitalized:
  `feat: Lock effects through moshes`. No body and no "Co-Authored-By" trailer. `feat`, `fix`
  and `perf` subjects are changelog lines, so write them for users. CI checks every subject.
- Types: `feat` (something a user can do or see), `fix`, `perf` reach the changelog;
  `refactor`, `test`, `docs`, `ci`, `build`, `chore`, `style` don't.
- Don't push after every commit: each push is a Vercel preview build and a CI run. Push when I
  ask, when a PR is due, or at the end of a session so the work is backed up.
- Before opening a PR, run what CI runs and fix what fails: `bun run check`,
  `bun run format:check` (`bun run format` fixes it), `bun run test` and `bun run build`, plus
  `bun run test:e2e` when a change touches a flow `tests/e2e` covers (drops, the timeline,
  export, persistence). A `main` ruleset requires `check`, `e2e` and `conventional` to pass, so a
  red e2e blocks the merge; when a behavior change breaks a spec, update the spec in the same
  commit.
- Don't open a PR until I ask for one: I test by hand first. Then rebase the branch on current
  `main`, push, and open it with `gh pr create`. The title just names the batch; the body lists
  the commits in a few lines, each starting with its short hash
  (`git log --reverse --format='%h %s' origin/main..HEAD`). I merge PRs, not you. Afterwards
  switch to `main`, pull, and delete the local branch.
- `gh pr edit` fails on this repo; edit PR bodies with
  `gh api -X PATCH repos/zivavu/OpenMosh/pulls/N -f body=...`.
- No "🤖 Generated with [Claude Code]" line (or any other attribution) in PR bodies, commits,
  release notes or anywhere else.
