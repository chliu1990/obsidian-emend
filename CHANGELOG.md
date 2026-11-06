# Changelog

All notable changes to Emend are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- DeepSeek-only **Web: Off / Review / Auto** controls for Ask, Discuss, and Brainstorm with `deepseek-flash` and `deepseek-v4-pro`; Off remains the default, and Review permits editing each proposed search/fetch batch.
- Model-directed multi-round `web_search`/`web_fetch` with sequential calls, a configurable default limit of 8 calls (1–20), a 40,000-character shared retrieval budget, and a 12,000-character per-fetch limit.
- Stable result-backed source IDs, safe citation rendering/copying, all-round provider-or-estimated usage, and conversation schema 2 persistence for ready Web badges and sanitized citations with version 1 loading.
- Disclosure that model-generated retrieval arguments may contain note-derived text and that successful DeepSeek search/fetch calls may be billed separately.
- Folded ready-message Web activity with sanitized query/URL/outcome persistence, latest-message following during streaming and final Markdown layout, and reader-position preservation when not following latest.
- Search-returned bounded page content before Fetch, explicit unread-page degradation for expected Fetch failures, and fatal handling for credential/account/request errors.

### Fixed

- Moved Web privacy disclosure into the selector tooltip and removed the large bottom block to leave more room for chat content.

### Security

- Kept web retrieval inside writer-free read-only modes, treated retrieved content as untrusted data, and rejected Kimi/custom providers and unsupported models without silent fallback to unsearched chat.

## [2.4.0] - 2026-11-05

### Added

- Explicit additional-note pickers in chat and Modify Selection with visible paths, remove/clear controls, and per-target selections for the current plugin session.
- Bounded read-only additional-note snapshots with fair combined source budgets, exact omission markers, and consistent note-path privacy.
- Live target rename handling, deleted/missing-note safeguards, picker owner cleanup, and prompt fences that preserve embedded Markdown code fences.

### Security

- Kept additional notes outside every write path; context-only anchors fail validation while full-note and selection Operations still apply only to their captured targets.

## [2.3.1] - 2026-11-01

### Fixed

- Preserved per-message mode, historical permission, and origin in provider history so local Edit confirmations are not confused with model claims.
- Matched annotation-aware token estimates and standard role/content provider messages while keeping current-mode permissions unchanged.

## [2.3.0] - 2026-11-01

### Added

- Compact accessible `refresh-cw` control for provider model discovery, replacing the wide text button.

### Fixed

- Preserved native 24×24 icon sizing at narrow settings widths and readable nonspinning pending state without changing discovery behavior.

## [2.2.0] - 2026-11-01

### Added

- Chat-header display of default Ask/Edit/send/newline shortcuts with platform-aware labels and distinct key badges.
- Build identity beside the Emend title: manifest version for release builds and short commit hash for untagged builds.
- Responsive shortcut groups and build-time identity injection with explicit release-workflow selection.

## [2.1.0] - 2026-10-31

### Added

- Explicit **Refresh models** discovery for DeepSeek, Kimi Code, and custom OpenAI-compatible providers.
- Persistent per-provider model ID/display-name caches with custom-model preservation and scoped base-URL/API-key invalidation.

### Security

- Discovery occurs only on explicit user action, uses SecretStorage credentials, prevents overlapping/stale updates, and omits raw response bodies from errors.

## [2.0.0] - 2026-10-31

### Added

- Streamed Ask, Discuss, and Brainstorm chat with DeepSeek, Kimi Code, and custom OpenAI-compatible providers.
- Guarded full-note and selection editing through closed insert/remove/replace/comment Operations and Track Changes review.
- Shared quick actions, keyboard shortcuts, smart selection context, and native undo.
- Per-note persistent conversations, multi-turn request isolation, and provider/estimated token usage.
- Vault-root `AGENTS.md` and skill loading.
- API-key storage in Obsidian SecretStorage with plaintext migration.
- GitHub Actions CI and release workflows, installable release ZIP, and BRAT/manual installation guides.

### Security

- Strict provider error redaction and bounded error output.
- Validated anchors, ambiguity/overlap rejection, stale-source/target checks, and abort/unload protection for note writes.

[Unreleased]: https://github.com/chliu1990/obsidian-emend/compare/2.4.0...HEAD
[2.4.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.4.0
[2.3.1]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.3.1
[2.3.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.3.0
[2.2.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.2.0
[2.1.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.1.0
[2.0.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.0.0
