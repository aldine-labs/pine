# Pi Source Sync

## Why this exists

Pine reads Pi's model catalog straight out of `@earendil-works/pi-ai`: the model
pickers, the chat runtime, and `generate_image` all resolve models through
`builtinImagesModels()` / the built-in provider catalog. That catalog is a
**generated snapshot committed to the Pi monorepo at build time**, not a live
lookup. `pi-ai` re-runs its generator and commits the result on `main`, and npm
only sees it at the next release.

The gap is measured in weeks, not hours:

| Snapshot | Source | OpenRouter image models |
| --- | --- | --- |
| `@earendil-works/pi-ai` 0.85.1 (npm, published 2026-09-05) | npm | 52 |
| upstream `main` (`bdee230f`, 2026-09-16) | GitHub | 54 (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`) |

Waiting for the next release therefore means shipping a stale image model list
for as long as upstream sits on the change. `sync:pi` closes that gap by
building `pi-ai` from the upstream repository and installing the result into
`node_modules`.

## What it does

`bun run sync:pi` (implemented in
`apps/desktop/scripts/sync-pi.mjs`):

1. Keeps a shallow clone of `https://github.com/earendil-works/pi` in `.pi-src/`
   (gitignored) and fast-forwards it to `main`, or to `--ref` / `PI_REF`.
2. Skips everything when the checkout already matches the recorded commit and
   the installed overlay is intact, so a no-op sync costs one `git fetch`.
3. Installs the upstream build toolchain (`npm install --ignore-scripts` in the
   clone) and runs each package's own `npm run build` in dependency order:
   chord, pi-tui, pi-telemetry, pi-ai, pi-agent-core, pi-coding-agent.
4. Copies each built `dist/` and `package.json` into
   `node_modules/@earendil-works/<package>`, together with the dependency
   versions that build declares. Those dependencies are installed **inside** the
   package directory (`node_modules/@earendil-works/pi-ai/node_modules/...`) so
   Pi gets the versions it was compiled against while the rest of the app keeps
   the versions it resolved.
5. Drops a `.pine-pi-sync.json` marker (upstream commit, ref, timestamp) into
   the package and records the same state in `.pi-src/pi-sync-state.json`.
6. Boots a real agent session against a local mock provider
   (`verify-pi-agent.mjs`) and asserts the outgoing request still carries the
   system prompt and the tool definitions. Only then is the commit recorded as
   good.

Because `pi-ai`'s package version on `main` is still the released `0.85.1`, the
install stays compatible with `bun.lock`: **`bun install` does not remove the
overlay**, and the overlay is replaced automatically the day a real release
bumps the version.

## Scope: the whole runtime closure, never a subset

The script rebuilds every Pi package Pine loads: chord, pi-tui, pi-telemetry,
pi-ai, pi-agent-core, pi-coding-agent. Partial overlays are not a smaller version
of this mechanism, they are a broken one, and the failure is silent.

Observed on 2026-09-19: overlaying only `pi-ai` from `main` under the released
`pi-coding-agent` left the agent with **no tools and no system prompt**. Nothing
threw. `main` had moved the stream entry point to the new `TranscriptContext`
while the released `pi-coding-agent` still called it with the old `Context`, so
every request went out with the user message alone and the model truthfully
answered that it had no tools. Type checks, imports, and the model catalog all
looked healthy.

`verify-pi-agent.mjs` is the guard for that class of breakage; it is why the
scope can be `main` at all.

Tracking the closure has a second cost: upstream API changes reach our typecheck
as soon as they land upstream. Both errors seen on 2026-09-19 were small —
`CompactionSettings` grew per-model `modelOverrides`, so Pine now types its
cached value as `ReturnType<SettingsManager["getCompactionSettings"]>`, and a
computer-use test read a property the result type no longer exposes — but they
have to be fixed in the same change that syncs, which is what `bun run check`
and `--strict` are for.

## Failure handling

1. Build or verification fails for the requested commit → the script rebuilds the
   last commit that passed verification and records that instead.
2. No verified overlay exists (first run, or the fallback fails too) → the script
   removes the overlays and reinstalls the published releases, so the app keeps
   working on npm.
3. `--strict` (used by `prebuild`) turns the failure into a non-zero exit after
   the fallback, so a release never ships an unverified overlay silently.

## Commands and hooks

| Command | Behavior |
| --- | --- |
| `bun run sync:pi` | Sync to `main`; warn and continue if it fails |
| `bun run sync:pi --strict` | Same, but fail the command when the sync fails |
| `bun run sync:pi --force` | Rebuild even when the recorded commit is unchanged |
| `bun run sync:pi --check` | Verify the installed overlay offline, exit non-zero when missing |
| `bun run sync:pi --verbose` | Stream every `git` / `npm` / `bun` command |
| `bun run verify:pi` | Run the agent verification on its own (mock provider, no network) |
| `bun run dev` | `predev` syncs first (tolerant), then starts Electron Forge |
| `bun run build` | `prebuild` syncs first with `--strict`, then packages the app |

| Environment variable | Effect |
| --- | --- |
| `PI_SYNC=off` | Skip the sync entirely; the hooks become no-ops |
| `PI_REF=<ref>` | Build a branch, tag, or commit instead of `main` |
| `PI_SYNC_REPO=<url>` | Clone from a fork or mirror |
| `PI_SYNC_DIR=<dir>` | Keep the clone outside `.pi-src` |

`bun run check` deliberately does **not** sync: format, lint, typecheck, and the
test suite have to stay runnable from a fresh `bun install` with no network, and
Pine is written against the published `pi-ai` API that `main` still satisfies.
A synced checkout is checked against `main` anyway, because the overlay is what
`node_modules` resolves.

## Working on it

```sh
bun run sync:pi                 # latest main, tolerant
bun run sync:pi --check         # what is installed right now
PI_REF=v0.85.1 bun run sync:pi  # build a released tag instead of main
PI_SYNC=off bun run dev         # ignore the mechanism for one command
```

Going back to the npm release:

```sh
rm -rf node_modules/@earendil-works/pi-ai && bun install
```

(Deleting the directory first is required: `bun install` alone leaves the
overlay in place, because the version in the manifest still matches the
lockfile.) Re-running `bun run sync:pi` reinstalls the overlay.

When an upstream build fails, the script prints the failing command and the last
lines of its output. `--verbose` streams everything. `PI_SYNC=off` is the escape
hatch when GitHub or the upstream dependency install is unreachable and you
still need to start the app.

## What it cannot do

- **It needs network.** The `pi-ai` build hydrates provider model data from public
  endpoints (`models.dev`, OpenRouter, and friends); no API keys are involved,
  but an unreachable network fails the sync.
- **It cannot make upstream safe.** `main` can be broken for reasons only the
  Verifier or the app itself notices. `PI_REF=<tag|sha>` pins a commit, and
  `PI_SYNC=off` drops the overlay entirely.
- **Packaging copies whatever is installed.** `forge.config.ts` bakes the agent
  runtime dependency closure from `node_modules` into the app, so a packaged
  build ships the overlaid Pi when one is present and the npm releases when it is
  not. `bun run build` syncs with `--strict` first, so release builds are never a
  surprise.
