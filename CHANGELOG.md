# Changelog

All notable changes to Emend are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/chliu1990/obsidian-emend/compare/2.3.0...HEAD
[2.3.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.3.0
[2.2.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.2.0
[2.1.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.1.0
[2.0.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.0.0
