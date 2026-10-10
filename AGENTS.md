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
bun run test:e2e   # Playwright suite under tests/e2e (`bunx playwright install chromium firefox` once)
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
- When adding a new effect: give it a file in `src/lib/effects/catalog/` exporting its
  `definition` and its GLSL `shader` (set `animated: true` if it uses `u_time` for
  animation — `ANIMATED_EFFECTS` is derived automatically, no separate registration needed;
  shared GLSL and uniform setters are in `gl/shader-lib.ts`), list it in `catalog/index.ts`
  where it should sit in the effects panel, and give it a stage, family and amount param in
  `src/lib/effects/curation.ts` (the Curated mosh style needs it; a test fails without it)
  unless it's `moshable: false`.
- Write user-facing UI copy (hints, tooltips, toasts, empty states) through the `/humanizer`
  skill, the same as changelog text.
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
- A saved timeline is read through `readSeqEntry` (`lib/editor/seq-entry.ts`). Each past format
  has a fixture in `lib/editor/fixtures/seq-entry/`, built with that version's own code. Bumping
  `SEQ_ENTRY_VERSION` adds a fixture; never regenerate an old one.
- A project file (`.openmosh`) is a stored zip: `project.json` plus the pool, songs and fonts.
  It has its own `PROJECT_VERSION` in `lib/project-file/manifest.ts`, separate from
  `SEQ_ENTRY_VERSION`; a change to either gets a fixture. The zip writer and reader
  (`lib/project-file/zip.ts`) have no dependency and store entries rather than deflating them,
  so an archive is built from the media blobs without copying them through memory.
- A backup (`.openmosh-backup`, `lib/backup/backup.ts`) is the same stored zip holding every
  IndexedDB record and the `openmosh*` localStorage keys, with its own `BACKUP_VERSION`.
  Loading one merges: records keep their ids and replace same-keyed ones; proxies stay out.
- Chain-clip behavior (fill/mosh/clear/static/auto) lives once in `lib/editor/chain-clip.ts`;
  `media/chain.ts` and `fx-lanes.ts` are thin wrappers. New chain-editing paths go through
  `chain-fanout.ts`, or a multi-selection edits only the primary clip. An auto clip rolls a
  fresh mosh per tick and runs its own chain, freely editable, after it; saves before
  `SEQ_ENTRY_VERSION` 4 keep only their held effects on load.
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
- 3D models (`lib/mesh/`) are editor-only and stay live meshes, drawn every frame by
  `MeshPass` inside `GlRenderer`. A model clip's 3D Transforms become its camera and run first,
  wherever they sit in the chain; `mesh/camera.ts` mirrors the shader, and a test holds them
  together. No baked turntable clips. Animated GLB/FBX are skinned on the GPU from a bone
  texture; the pose comes from the clip's `sourceTime` and loops. FBX textures must be embedded.
  The unit-sphere fit is folded into the bone matrices and sampled across the whole clip.
  A model's layer box is its own footprint, not the frame: the front view fits the frame like an
  image, and turning or zooming resizes the box around it at that scale (`modelFootprint`).
- The upload demo is only 3D worlds (`lib/demo/worlds/`), raymarched GLSL scenes drawn by
  `gl/scene-pass.ts`, not meshes. A scene is marched once with element ids and once without its
  elements; each element, and the backdrop, becomes its own layer with its own mosh. Shader loops
  start at `ZERO`: on Windows, Direct3D unrolls constant loops and a world takes seconds to
  compile. The next world compiles halfway through the current one, except in Firefox: it never
  shipped `KHR_parallel_shader_compile` and a compile freezes the page, so there every world
  compiles before the demo first shows.
  Devices under 40fps on the 3D worlds (`demo/demo-quality.ts` measures the first seconds) cut
  to flat 2D worlds (`lib/demo/flat-worlds/`) with single-pass effects, and start on them for a
  week. Touch devices always run the flat worlds. Same scene contract, no marching.
  In dev, `?world=<id>` holds one world, `?bare` drops the mosh and `?flat` starts on 2D.
- Area masking is the Mask effect (`effects/catalog/mask.ts`), not a per-effect toggle. It
  limits the effects above it, back to the previous Mask or the top of its own chain (an FX
  lane's chain too), and blends the rest back to how that scope began. Moshes, clears and
  rolls never touch a Mask. Presets drop its painting. On a media clip it paints in the
  layer's box.
- Code-split only what sits behind an `{#if}` that starts false, via `lib/lazy.ts`. Inline
  controls stay eager.
- The site is `openmosh.com`; `www` redirects to it. Never switch those around: each address
  keeps its own saves. `open-mosh.vercel.app` keeps serving the app with a moved notice
  (`lib/site.ts`) and is never redirected, since early users' projects are stored there.
- `/about` (`about/index.html`) is plain HTML, so crawlers read it without running JS; the app
  stays hash-routed on `/`. A new static page goes in `PAGES` in `vite.config.ts`, the build
  inputs and `public/sitemap.xml`. A test holds the effect count in it and the README.
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

- Never commit to `main`; it only takes PRs. A hook in `.githooks/pre-commit` refuses it
  locally; installing with bun sets `core.hooksPath` to it. PRs are rebase-merged (squash is
  off), so every commit on a branch lands on `main` as-is and becomes its own changelog line.
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
  commit. CI runs on PRs only (release PRs skip it), and the ruleset requires a PR to be up to
  date with `main`, so what merges is exactly what was tested.
- Don't open a PR until I ask for one: I test by hand first. Then rebase the branch on current
  `main`, push, and open it with `gh pr create`. The title just names the batch; the body lists
  the commits in a few lines, each starting with its short hash
  (`git log --reverse --format='%h %s' origin/main..HEAD`). I merge PRs, not you. Afterwards
  switch to `main`, pull, and delete the local branch.
- `gh pr edit` fails on this repo; edit PR bodies with
  `gh api -X PATCH repos/zivavu/OpenMosh/pulls/N -f body=...`.
- No "🤖 Generated with [Claude Code]" line (or any other attribution) in PR bodies, commits,
  release notes or anywhere else.
