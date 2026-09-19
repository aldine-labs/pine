# Pi Extension Boundary

## Context

Pine embeds `@earendil-works/pi-agent-core` and supplies its own Electron host and Vue UI. The locally installed Pi CLI is `@earendil-works/pi-coding-agent` 0.80.3, while Pine currently resolves `pi-agent-core` 0.80.6.

Before implementing behavior related to Pi, first check whether it belongs in a reusable Pi extension. Prefer an extension when the behavior is useful inside Pi itself and can be expressed through its public extension lifecycle without replacing host UI.

## Session search decision

Pi extensions can:

- register an alternative command such as `/pine-resume`;
- list sessions with `SessionManager.list()`;
- switch through the supported `ctx.switchSession()` command API;
- observe or cancel `session_before_switch` and rebuild state during `session_start`.

Pi extensions cannot non-invasively replace the built-in `/resume` selector. In Pi 0.80.3, interactive mode handles the exact `/resume` input before extension command dispatch. A same-name extension command is reported as a built-in conflict and omitted from autocomplete. The `session_before_switch` event runs only after the built-in selector has already chosen a target.

Pine therefore owns its Electron Session Search Overlay and session switching at the host boundary. It keeps Pi JSONL sessions as the source of truth and uses `JsonlSessionRepo` rather than introducing a second session format.

Opening a workspace initializes the session repository and search index without creating a Pi session. The runtime keeps a nullable active-session slot and creates a persistent session atomically when the first message needs one. Resuming an existing session fills the same slot without creating an empty session first.

Empty Pi sessions are excluded from the derived search index and deleted through `JsonlSessionRepo`. Sessions created or resumed by the current runtime are protected from cleanup while live, preventing a concurrent history refresh from racing the first message write. An abandoned empty session is removed the next time the workspace is opened and its history is refreshed.

The SQLite FTS5 database under `.pine/cache/` is a derived, disposable index. It uses the trigram tokenizer for Latin and CJK substring search, stores source modification times for incremental refresh, and can be rebuilt entirely from Pi JSONL files.

If CLI integration is needed later, extract the search engine behind a shared package and add a thin `/pine-resume` Pi extension adapter. Do not patch or shadow the built-in `/resume` command.

## Media generation decision

Image generation is a Pine-native tool pair: `activate_media_generation` is always visible, and activating it exposes `generate_image` for the rest of the session. Activation is recorded as a session entry so resumed sessions keep the tool, and the tool set is recomputed through the same `toolNamesFor*State` narrowing as Computer Use and Skill authoring. The indirection exists because more media tools are expected later; each new one joins `MEDIA_GENERATION_DYNAMIC_TOOL_NAMES` instead of widening the always-visible tool set.

Generation itself uses pi-ai's image surface (`ImagesModels`) rather than the chat/stream APIs, with OpenRouter as the aggregating provider. The OpenRouter credential comes from the same `auth.json` that authenticates chat models, so no separate key is stored. The selected image model is a Pine setting (`pine-settings.json`) chosen in the settings dialog's Harness section, where the shared model picker lists pi-ai's image catalog instead of Pine's chat models. That setting is also the only way to choose an image model: the tools take no model argument, so a call always runs on the user's selection, falling back to Pine's default when the user never picked one.

Image generation leaves the project sandbox, so calls pass through the approval gate like other privileged actions, and generated files are written into the project's temporary directory unless the model names a path inside a folder shared with Pine.
