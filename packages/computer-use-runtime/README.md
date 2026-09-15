# @pine/computer-use-runtime

Native Computer Use sidecar and Chrome extension used by Pine. The native code
is vendored from Munim Computer Use v0.3.0 and built locally; Pine never invokes
the upstream npm launcher's runtime download path.

Run `bun run build` to create the platform-specific `pine-computer-use/`
bundle consumed by Electron Forge. The bundle contains the native executable,
the Pine-branded unpacked Chrome extension, and the upstream license/notice.

See `NOTICE.md`, `LICENSE.upstream`, and `README.upstream.md` for attribution and
upstream documentation.
