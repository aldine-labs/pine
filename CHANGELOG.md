# Changelog

All notable changes to Pine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Starting with 0.4.4, release notes are written in both Chinese and English.
从 0.4.4 起，发布记录使用中英双语。

## [Unreleased]

## [0.4.8] - 2026-09-18

### 新增 / Added

- 新增了通过拖拽的方式将对话归类到分组的功能。Added the ability to categorize conversations into groups via drag-and-drop.

### 修复 / Fixed

- 修复了自定义提供商和自定义模型无法被用户编辑或者删除的问题。Fixed an issue where custom providers and custom models could not be edited or deleted by the user.

### 变更 / Changed

- 更换了部分图标，优化视觉。Replaced some icons and optimized the visual design.

## [0.4.7] - 2026-09-17

### 修复 / Fixed

- 保留向下滚动意图下的跟随模式。Preserved follow mode on downward scroll intent.

## [0.4.6] - 2026-09-17

### 变更 / Changed

- 新增会话分组管理能力。Added session group management.

### 修复 / Fixed

- 解码 Markdown 图片路径中的百分号编码。Decode percent-encoded Markdown image paths.
- 要求明确意图后才能停止思考跟随。Require explicit intent before stopping thinking follow.

## [0.4.5] - 2026-09-17

### 修复 / Fixed

- 修复从 transcript outline 首次点击较早消息时无法完成跳转的问题，并让弹出的消息列表自动定位到当前用户消息。Fixed transcript outline navigation so the first click reaches earlier messages, and keep the popup list aligned with the current user message.

## [0.4.4] - 2026-09-16

### 新增 / Added

- 图片、HTML 等可视预览支持触控板缩放，并可平移放大后的图片。Visual previews such as images and HTML now support trackpad zoom, with panning for enlarged images.
- 新会话背景增加更均衡的图标布局和办公任务图标候选，并优化带轻微模糊的入场动画。The new-session background gains a more balanced icon layout, office-task icon candidates, and a refined entrance with subtle blur.

### 修复 / Fixed

- 切回正在流式输出的会话时，自动刷新到最新内容。Returning to a streaming session now refreshes it to the latest content automatically.
- 关闭标签页时保留横向滚动缓动和标签补位动画，并修复顶栏部分空白区域无法拖动窗口的问题。Closing tabs now preserves horizontal scroll easing and tab movement; empty title-bar areas remain draggable.
- 修复消息流式输出、窗口缩放和思考内容展开时的滚动跟随与动画。Fixed scroll following and animation during streamed messages, window resizing, and thinking expansion.
- 发送消息后，新会话背景图标立即消失。The new-session background icons now disappear immediately when a message is sent.

## [0.4.3] - 2026-09-16

### Added

- Added an expandable file tree accordion with parallax and flickering-grid visuals.

### Changed

- Refined project session presentation and thinking markers.

## [0.4.2] - 2026-09-16

### Fixed

- Render markdown inline images: remote URLs load directly and local absolute or `file://` paths are served through the validated `pine-attachment://` protocol.

### Changed

- Contain offscreen transcript layout and batch streamed updates at 120ms, ending sustained high CPU during long streaming sessions; new stream deltas fade in so the sparser cadence still reads as continuous typing.
- Render thinking blocks through the markdown pipeline with a compact, muted panel variant.

## [0.4.1] - 2026-09-16

### Changed

- Improved streamed update handling across agent messages and runtime state.
- Refined the skill manager dialog layout.

## [0.4.0] - 2026-09-15

### Added

- Global and project skills, with localized skill activity in the transcript.
- Persistent approval state and execution cache-hit reporting.
- Native dragging of project files into Pine.

### Changed

- Optimized streaming transcript rendering and preserved project library order.

### Fixed

- Improved file presentation summaries and handling of missing Computer Use parameters.

## [0.3.1] - 2026-09-14

### Fixed

- macOS packages now receive a complete ad-hoc signature whose identity is
  bound to Pine's bundle metadata, so the computer-use helper resolves the
  same Accessibility permission entity that System Settings grants.

## [0.3.0] - 2026-09-14

### Added

- Native computer-use controls with visible review flow and bundled platform
  runtimes for macOS and Windows.
- Background file presentation, reusable attention flashes, and clearer agent
  execution-resource and user-question guidance.
- A discrete reasoning-effort slider with animated thumb/range movement and
  thumb-anchored warning tooltips.

### Changed

- Project opening now disables the project library until loading and navigation
  finish, preventing competing interactions during the transition.
- Opening a project that is already owned by another Pine window focuses that
  window instead of creating a duplicate project runtime.
- Computer Use activation now persists for the full session, including when a
  saved session is reopened.

### Fixed

- CI desktop packaging now builds the native computer-use runtime before
  Electron Forge packages the application.

## [0.2.2] - 2026-09-14

### Added

- Bundled Sarasa Gothic SC CJK subsets as the global UI fallback after Inter,
  with Regular, SemiBold, and Bold weights.
- Documented platform support levels for macOS, Windows, and Linux.

### Changed

- Coalesced redundant sandbox file operations so Windows read/write calls launch one file worker
  and edit calls launch two, without weakening path authorization or final-file checks.
- Windows startup now completes required sandbox provisioning before opening the main window.

### Fixed

- Prevented repeated Windows sandbox setup prompts and access-denied process launches by granting
  the sandbox broker read and execute access while keeping its runtime directory protected.
- Kept Windows title-bar controls aligned with Pine's custom layout.
- Kept macOS sandbox control sockets on a short system path so deeply nested project temporary
  directories no longer break shell commands and file tools.

### Known issues

- Windows sandboxed file workers still have roughly 1.7 seconds of measured startup latency per
  process; persistent file workers require a follow-up design before sub-second file tools are possible.

## [0.2.1] - 2026-09-13

### Added

- Windows x64 desktop distribution with Squirrel installation and update support.

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

[Unreleased]: https://github.com/phosphoros-works/pine/compare/v0.4.8...HEAD
[0.4.8]: https://github.com/phosphoros-works/pine/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/phosphoros-works/pine/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/phosphoros-works/pine/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/phosphoros-works/pine/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/phosphoros-works/pine/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/phosphoros-works/pine/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/phosphoros-works/pine/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/phosphoros-works/pine/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/phosphoros-works/pine/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/phosphoros-works/pine/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/phosphoros-works/pine/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/phosphoros-works/pine/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/phosphoros-works/pine/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/phosphoros-works/pine/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/phosphoros-works/pine/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/phosphoros-works/pine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/phosphoros-works/pine/releases/tag/v0.1.0
