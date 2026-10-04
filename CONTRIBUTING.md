# Contributing to OpenMosh

Issues and pull requests are welcome. For a bug or an effect idea, open an issue first; the templates ask for what makes it quick to act on.

## Setup

```bash
bun install
bun dev            # http://localhost:5173
bun check          # TypeScript + Svelte type-check
bun test           # unit tests
bun run test:e2e   # Playwright; run `bunx playwright install chromium firefox` once first
```

## Conventions

- bun, not npm or yarn. Svelte 5 runes only.
- Unit tests sit next to what they cover and run under `bun:test`, for pure logic only. Anything that needs a browser API goes in the Playwright suite under `tests/e2e`.
- Run `bun check` and both test suites before opening a PR. `bunx playwright install chromium firefox` once, first time. CI runs the same checks, plus formatting and the build, and a PR can't merge until they pass.
- A new effect is one file in `src/lib/effects/catalog/` exporting its `definition` and its GLSL `shader` (the other files there show the shape), a line in `catalog/index.ts` placing it in the effects panel, and an entry in `src/lib/effects/curation.ts` (where it sits in the chain for the Curated mosh style), unless it's `moshable: false`. A unit test catches a missing entry.
- `bun dev` also serves a shader lab at `/lab/` for auditioning open-source ISF shaders on real footage before porting one. It's dev-only and not part of the build; see `lab/README.md`.

## Pull requests and releases

Everything reaches `main` through a pull request. Branch off `main`; one PR can carry several changes. PRs are rebase-merged, so every commit on the branch lands on `main` as it is. Tidy the branch before it goes in: fold fixups into the commit they fix.

Each commit message also becomes a line in the changelog, so write it for the people using the app. It has to be a [conventional commit](https://www.conventionalcommits.org/) with a capitalized subject, and a check on the PR holds every commit to that:

```
feat: Lock effects so moshing leaves them alone
fix: The playhead stays put when the mix changes
```

`feat`, `fix` and `perf` go into the changelog. `refactor`, `docs`, `test`, `ci`, `build`, `chore` and `style` stay out of it. Don't mark a commit as breaking with `!`: every release is a patch bump until 1.0. If a change affects saved projects, say so in its message.

Leave `version` in `package.json` and `CHANGELOG.md` alone. [release-please](https://github.com/googleapis/release-please) keeps a release PR open that bumps both. Merging it tags the version, publishes the GitHub Release and deploys it to [openmosh.com](https://openmosh.com/). Until then, merged work shows up only on Vercel preview deployments.

## Effects inspired by PhotoMosh

PhotoMosh's code is proprietary. Match an effect by how it looks and moves, from screenshots or a recording, never by copying its source. Ports from openly licensed shader collections are fine; credit them in the README.
