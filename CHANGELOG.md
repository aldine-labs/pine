# Changelog

All notable changes to Pine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Coalesced redundant sandbox file operations so Windows read/write calls launch one file worker
  and edit calls launch two, without weakening path authorization or final-file checks.

### Known issues

- Windows sandboxed file workers still have roughly 1.7 seconds of measured startup latency per
  process; persistent file workers require a follow-up design before sub-second file tools are possible.

## [0.2.1] - 2026-09-13

### Added

- Windows x64 desktop distribution with Squirrel installation and update support.

### Changed

- Windows startup now completes required sandbox provisioning before opening the main window.

### Fixed

- Prevented repeated Windows sandbox setup prompts and access-denied process launches by granting
  the sandbox broker read and execute access while keeping its runtime directory protected.
- Kept Windows title-bar controls aligned with Pine's custom layout.
- Kept macOS sandbox control sockets on a short system path so deeply nested project temporary
  directories no longer break shell commands and file tools.

## [0.2.0] - 2026-09-13

### Added

- Structured user questions: the agent can present multiple-choice questions with options,
  descriptions, and previews, answered directly from the conversation.
- Each conversation now remembers its own model and provider selection.

### Fixed

- Refined the presentation of question cards and tool-call markers in the transcript.

## [0.1.2] - 2026-09-12

### Added

- A titlebar button that closes the active project and returns to the project list.

### Changed

- Sidebar conversations are grouped into past three days, past week, past month, and older sections.
- Conversation rows no longer show a date, leaving the full row width to titles.

## [0.1.1] - 2026-09-12

### Fixed

- Preserved Electron's built-in SQLite module in production bundles so projects can open correctly.
- Removed a blocked remote font request and kept the bundled Inter variable font as the UI font source.

## [0.1.0] - 2026-09-10

### Added

- A local-first Electron workspace for project-scoped AI agent sessions.
- Project file browsing and previews for text, image, PDF, Word, Excel, and PowerPoint files.
- Review, auto-approve, and unrestricted execution modes with visible tool activity.
- Configurable model providers, custom models, themes, localization, and persistent sessions.
- Reproducible main-branch artifacts and a manually gated production release workflow.
- R2-backed update discovery, verified downloads, and in-app macOS replacement updates.

[Unreleased]: https://github.com/phosphoros-works/pine/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/phosphoros-works/pine/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/phosphoros-works/pine/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/phosphoros-works/pine/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/phosphoros-works/pine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/phosphoros-works/pine/releases/tag/v0.1.0
