# Changelog

All notable changes to Emend are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.9.0] - 2026-11-12

### Added

- Multiple persisted chat sessions per note with New, Switch, Rename, and Delete controls directly between the context capacity bar and chat messages, deterministic local titles, independent drafts and provider history, and last-active restoration after reload.
- Conversation schema 3 with ordered session aggregates and lazy, lossless schema 1/2 migration while preserving malformed-file backup and unsupported-version refusal.
- Optional model-written explanations after Edit, plus a `Target: Full note.` or `Target: Selection.` disclosure and bounded deterministic line-level change summaries.
- Configurable chat history from 0–50 ready messages, applied to read-only, full-note Edit, and composer Selection requests while the Command Palette selection modal remains history-free.
- Optional per-provider context-window and output-reserve settings with explicit documented defaults for supported DeepSeek and Kimi preset models.
- Compact chat-header and selection-modal capacity bars with per-category floating details, remaining input/output estimates, and known over-capacity submission blocking.

### Changed

- Session persistence now uses exact-ID queued atomic mutations, with deleted-session resurrection protection, invocation-time snapshots, and stale-generation request guards.
- Composer Selection now includes the configured recent ready history from its originating session instead of always sending empty history.
- Session reordering controls are deferred to a future session management page; current chat keeps a compact New/Rename/Delete control set.

### Fixed

- Capacity preflight now covers freshly assembled instructions and additional notes, and every later Web, extraction, verifier, refine, and Edit-correction provider call is guarded before fetch.
- Unknown, transient, and raw fields can no longer survive later valid conversation mutations.
- Successful atomic assistant saves now reconcile the originating runtime session to the same ready response and title after reload, even when Stop, note switch, or close races the commit; pre-commit aborts still prevent persistence.

### Security

- Session management and local title derivation make no provider calls, and drafts, stopped/error/loading content, request bodies, snapshots, raw retrieval/reader artifacts, and unknown message fields remain transient.
- Full-note and Selection writers, native undo, Track Changes, per-note request exclusion, additional-note read-only boundaries, and credential handling remain guarded and unchanged.

## [2.8.0] - 2026-11-11

### Added

- DeepSeek-only per-query Web extraction for Ask, Discuss, and Brainstorm, still default Off: every readable Search/Fetch result now runs a bounded extractor plus same-provider verifier loop that produces compact, question-focused claims backed by exact verbatim quotes, with up to two refine rounds for rejected claims.
- A configurable per-call Web output cap (default 20,000 characters, range 1,000–100,000) applied independently to every Search/Fetch payload, replacing the former shared retrieval pool.
- Reviewable extraction goals on every Search/Fetch call; Review permits editing each goal together with its query or URL.
- One immediate Search/Fetch retry for transient failures, a non-fatal `search_failed` outcome with a ready warning when Search still fails, and explicit unread-page handling for Fetch.
- Failure diagnostics in tool results (`reason`, `httpStatus`, and `attempts`) plus folded activity labels for HTTP status, reader failure kind, and retry attempts.
- Cap-fitting omission warnings, `truncated`/`omitted` markers, and graceful local-call overflow with `local_call_limit_reached` instead of discarding an extraction.

### Changed

- Replaced verbatim-only extraction and shared truncation with claims plus verified quotes; verification failure falls back to exact quotes or `no_relevant_evidence` rather than failing the whole retrieval.
- Reader, correction, verifier, and refine requests now use JSON mode, with tolerant parsing for fenced or prose-wrapped output and individual invalid claims/quotes dropped.
- The answering model receives only actual source metadata plus verified claims with their quotes, or quotes-only evidence, never raw retrieval or unverified AI-generated facts.

### Fixed

- Search extraction no longer fails when the extractor reads all five default results in one round; the reader allows 8 local calls per round and 24 total with recoverable overflow.
- Invented summaries, labels, and extra fields no longer reach the answering model.
- Malformed local reader calls, format failures, and verification failures now degrade or correct instead of silently discarding inspected evidence.
- Retry attempts and failure causes are visible instead of collapsing into one opaque error string.

### Security

- Web remains writer-free in Ask, Discuss, and Brainstorm and unavailable in Edit, quick actions, and Modify Selection.
- Raw retrieval, reader reasoning, failure reasons/statuses/attempts, and reader artifacts remain transient; schema 2 persists only sanitized ready content, citations, activity status, and usage.
- Failure payloads exclude credentials, headers, provider messages, and page URLs beyond the existing activity target.

Web retrieval remains default Off and available only for DeepSeek `deepseek-flash` and `deepseek-v4-pro`; failed calls count toward the configured 1–20 call limit.

## [2.7.0] - 2026-11-07

### Added

- Composer **Edit target** selection defaults to **Selection** for usable selected text and **Full note** otherwise, with an explicit Full note override.
- Typed Edit requests and the Fix grammar, Make concise, and Add examples quick actions now edit the captured selection through the existing guarded native writer, preserving native Obsidian undo.
- Concise selection-edit chat results include successful-attempt reasoning and token usage across all attempted rounds.

### Fixed

- Empty, whitespace-only, or vanished selections fail closed before messages, saves, or provider requests, without falling back to the full-note writer.
- Quick actions keep the visible mode controls and internal Edit intent consistent after failed Selection capture while preserving the composer draft.

### Security

- Preserved the guarded full-note and native-selection writer boundary, read-only modes and additional notes, exact selection targeting, and existing privacy and persistence limits.

## [2.6.0] - 2026-11-07

### Added

- Deterministic Unicode word/segment-level multi-hunk replacement ranges with bounded fallback, precise targeting prompts, and actionable Operation diagnostics.
- Exactly one same-provider correction round for candidate-validation failures in full-note Edit and Modify Selection, with aggregated full-note usage and successful-attempt-only persisted reasoning.
- Structural Markdown safeguards for inline code, fenced code and Track Changes review shadows, and single-cell table editing with actual composed-candidate validation.

### Fixed

- Kept inline-code replacements reviewable so Accept All no longer leaves hidden CriticMarkup behind.
- Rejected table-structure, delimiter-escape, and fenced-code edits that could corrupt accepted Markdown or produce unreviewable suggestions.
- Prevented rejected-attempt reasoning and raw correction artifacts from entering ready persisted chats.

### Security

- Limited correction feedback to bounded allowlisted diagnostics without source excerpts or Operation payloads, and preserved terminal provider, abort, stale-target, permission, and write failures.
- Kept invalid candidates and correction feedback transient, with no new background requests, telemetry, credential handling, or write paths.

## [2.5.0] - 2026-11-06

### Added

- DeepSeek-only **Web: Off / Review / Auto** controls for Ask, Discuss, and Brainstorm with `deepseek-flash` and `deepseek-v4-pro`; Off remains the default, and Review permits editing each proposed search/fetch batch.
- Model-directed multi-round `web_search`/`web_fetch` with sequential calls, a configurable default limit of 8 calls (1–20), a 40,000-character shared retrieval budget, and a 12,000-character per-fetch limit.
- Stable result-backed source IDs, safe citation rendering/copying, all-round provider-or-estimated usage, and conversation schema 2 persistence for ready Web badges and sanitized citations with version 1 loading.
- Disclosure that model-generated retrieval arguments may contain note-derived text and that successful DeepSeek search/fetch calls may be billed separately.
- Folded ready-message Web activity with sanitized query/URL/outcome persistence, bottom following during streaming, start-of-response alignment after completion, and reader-position preservation on unrelated re-renders.
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

[Unreleased]: https://github.com/chliu1990/obsidian-emend/compare/2.8.0...HEAD
[2.8.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.8.0
[2.7.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.7.0
[2.6.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.6.0
[2.5.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.5.0
[2.4.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.4.0
[2.3.1]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.3.1
[2.3.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.3.0
[2.2.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.2.0
[2.1.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.1.0
[2.0.0]: https://github.com/chliu1990/obsidian-emend/releases/tag/2.0.0
