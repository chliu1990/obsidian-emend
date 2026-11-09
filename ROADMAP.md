# Emend roadmap

Emend aims to be the most predictable and privacy-conscious way to chat with and edit Obsidian notes—not the plugin with the most AI features. Safe Operations-based editing, explicit user actions, local data control, and reliable provider behavior come before feature count.

Features have no fixed deadlines. Each independently reviewable behavior gets its own focused PR, and feature PRs remain separate from release PRs.

## Now

- Maintain Emend 2.7.0 with bug fixes, security updates, documentation, and provider compatibility.
- **Web retrieval budget diagnostics ([#45](https://github.com/chliu1990/obsidian-emend/issues/45)):** current behavior distinguishes the 1–20 model-requested call limit from the independent 40,000-character content budget and adds one persistent ready-answer warning when shared-budget truncation or a skipped call omits evidence. Ordinary per-result/per-fetch truncation alone does not trigger it; retrieval remains read-only and bounded without retry or fallback. See [Stage 40](devel_docs/40-web-content-budget-diagnostics.md).
- Additional-note context is current behavior: explicit per-target selections, visible paths, session-only lifetime, bounded read-only snapshots, and consistent path privacy. See [Stage 35](devel_docs/35-additional-notes-context.md).
- DeepSeek online search is current behavior for read-only Ask, Discuss, and Brainstorm with `deepseek-flash` and `deepseek-v4-pro`: default-off Off/Review/Auto controls, model-directed multi-round search/fetch, bounded calls/content, and result-backed citations. Kimi/custom adapters remain unsupported. See [Stage 36](devel_docs/36-deepseek-online-search.md).
- Minimal edit ranges are current behavior for full-note Edit and Modify Selection: bounded Unicode word/segment-level Track Changes hunks, typed diagnostics, and exactly one same-provider candidate-validation correction with transient feedback and all-round full-note usage. Conservative Operations validation and terminal provider/stale/write failures are unchanged. See [Stage 37](devel_docs/37-minimal-edit-ranges.md) and issue [#23](https://github.com/chliu1990/obsidian-emend/issues/23).
- Structural Markdown safeguards preserve reviewable inline code and single-cell table edits, reject unreviewable fenced-code/review-shadow and table-structure changes, and validate actual composed candidates before either writer runs. See [Stage 38](devel_docs/38-markdown-edit-safeguards.md).
- Easier selected-text editing is current behavior: the composer **Edit target** control defaults to **Selection** for usable selected text, retains an explicit **Full note** override, and routes typed and quick-action edits through the existing native selection writer with concise usage-bearing chat results. See [Stage 39](devel_docs/39-easier-selection-editing.md) and issue [#24](https://github.com/chliu1990/obsidian-emend/issues/24).

## Next

The public-launch path is three independent content PRs plus the normal separate release PR, which contains only CHANGELOG and version updates:

1. **Public documentation and promotional launch materials:** refresh the current README, quick start, and installation guides; add a user-facing privacy/write-safety explainer, a supported platform/provider matrix, current screenshots with a short demo, and concise evidence-backed announcement/showcase copy. Keep Community Directory submission a separate explicit decision. Follow [publication and distribution](devel_docs/publication.md).
2. **Post-edit change summaries ([#35](https://github.com/chliu1990/obsidian-emend/issues/35)):** concise bullet summaries derived from the final successfully applied Operations, with correct no-op/failure behavior and sanitized persistence; keep model-generated additional suggestions as a separate follow-up rather than adding a hidden provider call or exposing raw edit protocols.
3. **Compact composer controls:** move quick actions and additional-note controls into smaller icon buttons and dropdown menus beside the composer, preserving the existing safeguards: accessible labels, selected-note paths and remove/clear behavior, shared submission paths, pending/disabled states, target-note isolation, and point-of-action privacy details. Keep this as a separate UI PR.

## Later

- **Vision inputs:** embedded vault images with strict provider, file-type, size, and capability checks, starting with one provider/model family.
- **Context accounting:** per-provider capacity/output reserve and labelled category estimates, without compression.
- **Automatic context compression:** separate, default-off behavior using the accounting work, with explicit privacy/cost disclosure and safe edit fallbacks.
- **File structures and automatic TOCs:** an explicit mode or action for bounded, read-only file-structure/title discovery and TOC generation, without background vault scans or writes to discovered files.
- **Linked-document context toggle:** default-off inclusion of outgoing and/or reverse-linked documents with visible paths, deduplication, bounded read-only snapshots, and consistent path privacy.
- **Folder-based document selection:** explicit folder scopes for opening/including documents, with clear recursion rules, bounded results, and no new write path.
- **Multiple chat sessions per note ([#41](https://github.com/chliu1990/obsidian-emend/issues/41)):** explicit new, switch, rename, delete, and reorder controls; latest-session-by-default restore; a versioned persistence migration that preserves existing threads; deterministic pending-request and load guards; and sanitized session summaries only on explicit request, with no hidden provider calls.
- **Insert-only text enrichment:** an explicit addition action that inserts useful new text at a precise anchor without replacement or deletion, using existing Operations and Track Changes targets.
- **Follow-up edits to unaccepted suggestions ([#37](https://github.com/chliu1990/obsidian-emend/issues/37)):** deterministic merging into existing CriticMarkup without implicit accept/reject, nested or ambiguous markup, or loss of unaffected suggestions; preserve exact accept/reject bytes and Stage 38 structural safeguards.
- **Track Changes dependency strategy ([#36](https://github.com/chliu1990/obsidian-emend/issues/36)):** evaluate the documented upstream limitations and whether a focused fork or custom renderer is justified, without bundling that research into edit workflow features.
- **Review-change attribution ([#44](https://github.com/chliu1990/obsidian-emend/issues/44)):** identify Emend-generated review comments and, where the representation permits, modifications deterministically so Track Changes labels them Emend rather than a default author. Investigate Track Changes author-presentation constraints before choosing a representation, preserve exact CriticMarkup accept/reject bytes and Stage 38 structural safeguards, and never add nested markup or a second review UI. Any later user discussion or guidelines extension needs a separate design with no hidden provider calls.
- **Regenerate or delete the latest exchange ([#31](https://github.com/chliu1990/obsidian-emend/issues/31)):** regenerate the latest assistant response or remove its user/assistant pair from both the visible thread and provider history, with persistence and pending-request guards.
- **Independent search and fetch providers ([#32](https://github.com/chliu1990/obsidian-emend/issues/32)):** opt-in third-party retrieval settings, such as Exa, with independent Search/Fetch selection, SecretStorage credentials, bounded results, verifiable citations, and provider-specific privacy review.
- **Streaming investigation on macOS:** investigate a report that responses appear all at once on Mac, distinguishing provider/SSE delivery from Emend's web-round and final-response buffering, with real Obsidian measurements before changing behavior.
- **Permission-grouped modes ([#25](https://github.com/chliu1990/obsidian-emend/issues/25)):** evaluate read-only, file-modify, and file-create groups without weakening current permission checks or independent feature PR boundaries.
- **Bilingual translation ([#12](https://github.com/chliu1990/obsidian-emend/issues/12)):** an explicit language-pair action with two modes. File mode creates exactly one new target-language Markdown file only after complete validated output, rejects collisions, and never modifies the source or overwrites an existing destination. Inline mode inserts translated blocks below each original paragraph in the active note through the existing guarded Operations/Track Changes path, preserving the originals and relying on native undo and stale checks rather than a new writer. Both modes send complete source text with empty chat history and preserve Markdown, code, links, and existing CriticMarkup.
- **Same-device API-key sharing research ([#13](https://github.com/chliu1990/obsidian-emend/issues/13)):** default-off OS-backed encrypted sharing with migration confirmation and no plaintext or cross-device claims.
- **Other-provider online search:** independent Kimi and custom-provider adapters with their own capability contracts, privacy disclosures, citations, tests, and reviews; no universal schema or silent fallback.
- **Toolchain maintenance:** adopt TypeScript 7 when typescript-eslint peer support exists, migrate to eslint-plugin-obsidianmd 0.4 scanner rules, align Vite 8/Vitest 5 with esbuild and the Node engine floor in one tested upgrade, and upgrade checkout/setup-node/release actions through a workflow-authorized PR. These migrations are not launch blockers unless they become security- or release-breaking, and they must not be bundled with launch features.
- Additional multimodal file types and provider-specific capabilities.
- Broader community and contributor workflows when maintenance capacity allows.

## Non-goals

- Autonomous or scheduled background AI requests.
- Hidden telemetry, vault scans, uploads, or context sharing.
- A universal provider schema for search, vision, or other advanced capabilities.
- Large PRs that bundle unrelated features.
- Community Directory submission at this time; any submission remains a separate explicit decision.

## Detailed designs

- [Context management](devel_docs/future-context-management.md)
- [Remaining web-search work](devel_docs/future-web-search.md)
- [Provider and context improvements](devel_docs/future-provider-and-context-features.md)
- [Discovery and workflow improvements](devel_docs/future-discovery-and-workflows.md)
- [Publication and distribution](devel_docs/publication.md)

These designs guide future work but do not commit the project to every feature. See [CHANGELOG.md](CHANGELOG.md) for shipped behavior and [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process.
