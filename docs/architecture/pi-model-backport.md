# Pi Model Backport

## Why this exists

Pine reads Pi's model lists straight out of `@earendil-works/pi-ai`: the chat and
image model pickers, the runtime that talks to providers, and `generate_image`
all resolve models through the catalogs that ship inside the package. Those
catalogs are **generated data committed upstream at release time**, not a live
lookup, so npm only sees them at the next release.

The gap is measured in weeks:

| Snapshot                                                   | Source | OpenRouter image models                              |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------- |
| `@earendil-works/pi-ai` 0.85.1 (npm, published 2026-09-05) | npm    | 52                                                   |
| upstream `main` (`bdee230f`, 2026-09-16)                   | GitHub | 54 (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`) |

`bun run backport:models` closes that gap by copying the newest generated
catalogs onto the npm-installed package.

## The npm baseline is deliberate

Pine runs the **released** Pi packages, exactly as `bun.lock` pins them, and this
script never changes that. An earlier version of this mechanism rebuilt the whole
Pi runtime from upstream `main`; it was removed because tracking an unreleased
monorepo in a shipping desktop app is a bad trade:

- Upstream `main` is not an API contract. While it was enabled, `pi-ai` moved its
  stream entry point to the new `TranscriptContext` and a required compaction
  field appeared — and because only part of the runtime was overlaid, the agent
  silently started sending requests **with no tools and no system prompt**.
  Nothing threw; the model just answered that it had no tools.
- "Newer and worse" is invisible to a build. Verification and rollbacks catch
  crashes, not regressions.
- Reproducibility matters more than freshness for a desktop app users install.

So the base stays npm, and only the data that actually lags is refreshed.

## What the backport moves

Only generated catalog files inside `node_modules/@earendil-works/pi-ai`:

| Path                             | Contents                                  |
| -------------------------------- | ----------------------------------------- |
| `dist/image-models.generated.js` | the OpenRouter image catalog              |
| `dist/models.generated.js`       | the aggregator over per-provider catalogs |
| `dist/providers/*.models.js`     | one chat catalog per provider             |
| `dist/providers/data/*.json`     | the provider data those catalogs import   |

No JavaScript that Pine or Pi executes is replaced, `.d.ts` files stay as npm
shipped them, and package versions and `bun.lock` stay untouched. The file set is
safe because these files are pure data plumbing: `models.generated.js` imports
only the per-provider `*.models.js` files, those import only `./data/*.json` and
`../model-catalog.js`, and npm 0.85.1's `model-catalog.js` is byte-identical to
the one on `main`.

## Commands

| Command                               | Behavior                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bun run backport:models`             | Build the catalogs from upstream `main` and apply them                                                     |
| `bun run backport:models --ref <ref>` | Take them from a tag or commit instead of `main`                                                           |
| `bun run backport:models --check`     | Report what is installed and how many models it has                                                        |
| `bun run backport:models --restore`   | Put the released files back (works offline)                                                                |
| `bun run backport:models --force`     | Re-apply even when the recorded commit is unchanged                                                        |
| `bun run verify:pi`                   | Boot a real agent against a mock provider and assert the request still carries the system prompt and tools |

The first backport copies the released files into `.pi-backport-backup/`
(gitignored) before overwriting anything, which is what makes `--restore` work
without network access. A `.pine-model-backport.json` marker inside the package
records the upstream commit, so `--check` can tell a backported tree from a
released one.

Nothing runs automatically: `bun run dev` and `bun run build` use exactly what
`bun.lock` resolved. A packaged build bakes in whatever is in `node_modules`, so
run the backport before `bun run build` when a release should carry the newest
model lists.

```sh
bun run backport:models          # take upstream main's catalogs
bun run check                    # types and tests still pass
bun run backport:models --check  # what is installed now
bun run backport:models --restore
```

## When to run it, and what to check

Run it when a model is missing from Pine's pickers but present in OpenRouter, and
when preparing a release that should advertise the newest models. After applying,
`bun run check` plus a quick look at the pickers is enough; the script itself
imports both catalogs before reporting success, so a catalog that no longer
loads fails the command instead of the app.

If a future `pi-ai` release changes the generator layout (for example the
provider data stops being plain imports), `--restore` returns the tree to the
released state; the script also warns when the installed version is not the one
its file list was written for.

## Catalogs are not the whole contract

Refreshing the catalogs makes new models _selectable_, which is not the same as
making them _work_. `openai/gpt-image-2.5-flare` arrived through the backport and
then failed with:

```
404: openai/gpt-image-2.5-flare is an image generation model and cannot be used
with the chat/completions endpoint. Use the /api/v1/images endpoint instead.
```

The model list was current; the released generation code was not. OpenRouter now
routes pure image models through `/api/v1/images`, while pi-ai 0.85.1 only speaks
`chat/completions`. Pine covers that gap in its own media layer instead of
patching the package: see [Two OpenRouter transports](./pi-extension-boundary.md#two-openrouter-transports).

So when a freshly backported model fails, check the shape of the provider error
before assuming the catalog is stale. Anything that reads like a routing or
endpoint complaint belongs in Pine's transport code, not in this script.
