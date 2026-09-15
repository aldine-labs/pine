# Pine Computer Use third-party notice

Pine Computer Use includes a modified copy of
[`munim-computer-use`](https://github.com/munimtechnologies/munim-computer-use)
version 0.3.0, commit `85b3ded9057c9d8fc0c5cd435cdd539f15c93178`.

Copyright 2026 Munim, Inc. The upstream work is licensed under the Apache
License 2.0; see `LICENSE.upstream`.

Pine's modifications are limited to integration and branding:

- the MCP server is built from source and packaged as `pine-computer-use`;
- visible MCP server, browser extension, native messaging host, tab group, and
  diagnostic names use Pine branding;
- browser bridge sockets/pipes, cursor overlay identifiers, and application
  support paths use a Pine namespace so the upstream extension can coexist;
- the Chrome extension uses Pine artwork and its own stable extension key/id;
- the agent pointer keeps Munim's geometry and motion but uses Pine's warm
  olive palette across native overlays and the browser page overlay;
- build and packaging scripts place the native server and extension inside the
  Pine application instead of downloading a release binary at runtime.
- one stale Rust history test now matches the implementation's documented
  privacy rule that an ordinary link must not replace the current page URL.

The vendored source remains under `vendor/munim-computer-use/`. The surrounding
Pine integration is licensed under Pine's project license.
