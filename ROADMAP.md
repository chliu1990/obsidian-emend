# Emend roadmap

Emend aims to be the most predictable and privacy-conscious way to chat with and edit Obsidian notes—not the plugin with the most AI features. Safe Operations-based editing, explicit user actions, local data control, and reliable provider behavior come before feature count.

Features have no fixed deadlines. Each independently reviewable behavior gets its own focused PR, and feature PRs remain separate from release PRs.

## Now

- Maintain Emend 2.6.0 with bug fixes, security updates, documentation, and provider compatibility.
- Additional-note context is current behavior: explicit per-target selections, visible paths, session-only lifetime, bounded read-only snapshots, and consistent path privacy. See [Stage 35](devel_docs/35-additional-notes-context.md).
- DeepSeek online search is current behavior for read-only Ask, Discuss, and Brainstorm with `deepseek-flash` and `deepseek-v4-pro`: default-off Off/Review/Auto controls, model-directed multi-round search/fetch, bounded calls/content, and result-backed citations. Kimi/custom adapters remain unsupported. See [Stage 36](devel_docs/36-deepseek-online-search.md).
- Minimal edit ranges are current behavior for full-note Edit and Modify Selection: bounded Unicode word/segment-level Track Changes hunks, typed diagnostics, and exactly one same-provider candidate-validation correction with transient feedback and all-round full-note usage. Conservative Operations validation and terminal provider/stale/write failures are unchanged. See [Stage 37](devel_docs/37-minimal-edit-ranges.md) and issue [#23](https://github.com/chliu1990/obsidian-emend/issues/23).
- Structural Markdown safeguards preserve reviewable inline code and single-cell table edits, reject unreviewable fenced-code/review-shadow and table-structure changes, and validate actual composed candidates before either writer runs. See [Stage 38](devel_docs/38-markdown-edit-safeguards.md).

## Next

1. **Easier selected-text editing ([#24](https://github.com/chliu1990/obsidian-emend/issues/24)):** a direct composer checkbox for selection edits that defaults appropriately when text is selected and reuses the existing guarded path.
2. **Post-edit change summaries ([#35](https://github.com/chliu1990/obsidian-emend/issues/35)):** concise bullet summaries derived from the final successfully applied Operations, with correct no-op/failure behavior and sanitized persistence; keep model-generated additional suggestions as a separate follow-up rather than adding a hidden provider call or exposing raw edit protocols.
3. **Vision inputs:** embedded vault images with strict provider, file-type, size, and capability checks, starting with one provider/model family.
4. **Context accounting:** per-provider capacity/output reserve and labelled category estimates, without compression.
5. **Automatic context compression:** separate, default-off behavior using the accounting work, with explicit privacy/cost disclosure and safe edit fallbacks.

## Later

- **File structures and automatic TOCs:** an explicit mode or action for bounded, read-only file-structure/title discovery and TOC generation, without background vault scans or writes to discovered files.
- **Linked-document context toggle:** default-off inclusion of outgoing and/or reverse-linked documents with visible paths, deduplication, bounded read-only snapshots, and consistent path privacy.
- **Folder-based document selection:** explicit folder scopes for opening/including documents, with clear recursion rules, bounded results, and no new write path.
- **Compact composer controls:** move quick actions and additional-note controls into smaller icon buttons and dropdown menus beside the composer, with accessible labels, pending states, and point-of-action privacy details. Keep this as a separate UI PR.
- **Insert-only text enrichment:** an explicit addition action that inserts useful new text at a precise anchor without replacement or deletion, using existing Operations and Track Changes targets.
- **Follow-up edits to unaccepted suggestions ([#37](https://github.com/chliu1990/obsidian-emend/issues/37)):** deterministic merging into existing CriticMarkup without implicit accept/reject, nested or ambiguous markup, or loss of unaffected suggestions; preserve exact accept/reject bytes and Stage 38 structural safeguards.
- **Track Changes dependency strategy ([#36](https://github.com/chliu1990/obsidian-emend/issues/36)):** evaluate the documented upstream limitations and whether a focused fork or custom renderer is justified, without bundling that research into edit workflow features.
- **Regenerate or delete the latest exchange ([#31](https://github.com/chliu1990/obsidian-emend/issues/31)):** regenerate the latest assistant response or remove its user/assistant pair from both the visible thread and provider history, with persistence and pending-request guards.
- **Independent search and fetch providers ([#32](https://github.com/chliu1990/obsidian-emend/issues/32)):** opt-in third-party retrieval settings, such as Exa, with independent Search/Fetch selection, SecretStorage credentials, bounded results, verifiable citations, and provider-specific privacy review.
- **Streaming investigation on macOS:** investigate a report that responses appear all at once on Mac, distinguishing provider/SSE delivery from Emend's web-round and final-response buffering, with real Obsidian measurements before changing behavior.
- **Permission-grouped modes ([#25](https://github.com/chliu1990/obsidian-emend/issues/25)):** evaluate read-only, file-modify, and file-create groups without weakening current permission checks or independent feature PR boundaries.
- **Bilingual full-note translation ([#12](https://github.com/chliu1990/obsidian-emend/issues/12)):** an explicit language-pair action that creates one suffixed Markdown file, preserves the source, and has safe collision/stale/abort behavior.
- **Same-device API-key sharing research ([#13](https://github.com/chliu1990/obsidian-emend/issues/13)):** default-off OS-backed encrypted sharing with migration confirmation and no plaintext or cross-device claims.
- **Other-provider online search:** independent Kimi and custom-provider adapters with their own capability contracts, privacy disclosures, citations, tests, and reviews; no universal schema or silent fallback.
- Additional multimodal file types and provider-specific capabilities.
- Broader community and contributor workflows when maintenance capacity allows.

## Non-goals

- Autonomous or scheduled background AI requests.
- Hidden telemetry, vault scans, uploads, or context sharing.
- A universal provider schema for search, vision, or other advanced capabilities.
- Large PRs that bundle unrelated features.
- Community Directory submission at this time.

## Detailed designs

- [Context management](devel_docs/future-context-management.md)
- [Remaining web-search work](devel_docs/future-web-search.md)
- [Provider and context improvements](devel_docs/future-provider-and-context-features.md)
- [Discovery and workflow improvements](devel_docs/future-discovery-and-workflows.md)
- [Publication and distribution](devel_docs/publication.md)

These designs guide future work but do not commit the project to every feature. See [CHANGELOG.md](CHANGELOG.md) for shipped behavior and [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process.
