# Emend roadmap

Emend aims to be the most predictable and privacy-conscious way to chat with and edit Obsidian notes—not the plugin with the most AI features. Safe Operations-based editing, explicit user actions, local data control, and reliable provider behavior come before feature count.

Features have no fixed deadlines. Each independently reviewable behavior gets its own focused PR, and feature PRs remain separate from release PRs.

## Now

Maintain Emend 2.9.0 with bug fixes, security updates, documentation, and provider compatibility. The 2.10 documentation work does not advance the release version.

### Recently shipped

| Area | Current status | Canonical record |
| --- | --- | --- |
| Unified Chat, sessions, and compact composer | Writer-free Chat, per-note sessions, maintained Chat/Edit targets, Edit-only quick actions, and draft-preserving controls are implemented. | [Stage 43](devel_docs/43-multiple-chat-sessions.md), [Stage 44](devel_docs/44-compact-composer.md) |
| Related notes | Explicit All/Links/folder snapshots, metadata-only discovery, visible read-only selections, and manual Refresh are implemented. Automatic inclusion and background indexing remain deferred. | [Stage 35](devel_docs/35-additional-notes-context.md), [Stage 45](devel_docs/45-related-notes-explorer.md) |
| Composer models | Local provider/model/reasoning controls use existing SecretStorage keys and queued sanitized settings saves; discovery remains Settings-only. | [Stage 46](devel_docs/46-composer-model-controls.md) |
| Live Selection | The current nonempty editor Selection remains highlighted while chat has focus, without I/O or editor mutation. | [Stage 47](devel_docs/47-selection-highlight.md) |
| Response continuity | Ready and stopped answers keep synchronous text through final Markdown rendering, with an initial Web research status. | [Stage 48](devel_docs/48-web-response-transition.md) |
| Selection focus and context | Chat Selection has a read-only focus; full-note Selection context never expands the native edit target. | [Stage 49](devel_docs/49-selection-focus-and-context.md) |
| Native menu activation | Writing/Web and model/reasoning items survive Obsidian's native hide-before-click ordering without weakening stale guards. | [Stage 50](devel_docs/50-native-menu-activation.md) |
| 2.10 stabilization | Cross-cutting writer, persistence, lifecycle, credential, Web, and concurrency hardening is merged; remaining deferrals and evidence limits are recorded separately. | [Stage 51](devel_docs/51-2-10-stabilization.md) |
| Web draft streaming | Supported Web rounds show labelled provisional content, reset before tools, and promote only the terminal answer; draft artifacts remain transient. | [Stage 52](devel_docs/52-web-draft-streaming.md) |

Earlier shipped Operations editing, grounded Web retrieval, capacity safeguards, and edit summaries remain current; see the [architecture contract and stage index](IMPLEMENTATION_PLAN.md) and [CHANGELOG.md](CHANGELOG.md).

Track Changes remains a separate companion plugin and Emend's only CriticMarkup review surface. Automatic installation and bundling are not planned ([#36](https://github.com/chliu1990/obsidian-emend/issues/36)). Any missing-plugin detector or explicit user-clicked installation affordance requires a separate runtime design and review; it is not part of the documentation PR.

## Next

The public-launch path remains independent content PRs plus the normal separate release PR, which contains only CHANGELOG, version metadata, and release-only status/installation documentation and verification updates:

1. **Public documentation and promotional launch materials — integrated:** the redesigned entry points and five public guides, contributor/technical documentation, six current visuals, and concise evidence-backed launch copy are integrated. The separate release PR, packaged-install verification, and any announcement remain pending. Keep Community Directory submission a separate explicit decision. Follow [publication and distribution](devel_docs/publication.md).

## Later

- **Edit-failure feedback and bounded retry ([#48](https://github.com/chliu1990/obsidian-emend/issues/48)):** the shipped baseline already makes exactly one automatic same-provider correction request for a candidate-validation failure, with the unchanged original request, the invalid candidate, and bounded diagnostic feedback, and a second invalid candidate is terminal ([Stage 37](devel_docs/37-minimal-edit-ranges.md)). Still deferred: a configurable retry count beyond that single correction, an explicit user-driven retry with different feedback, and partial application when independent positions fail. Any change needs visible cost/latency disclosure, no silent retries, and a separate safety design because partial application conflicts with atomic fail-closed editing. See [future edit and chat workflows](devel_docs/future-edit-and-chat-workflows.md).
- **Vision inputs:** embedded vault images with strict provider, file-type, size, and capability checks, starting with one provider/model family.
- **Automatic context compression:** separate, default-off behavior built on the Stage 42 accounting, with an explicit configurable threshold (proposed 75%), privacy/cost disclosure for the extra provider request, and safe full-note/selection fallbacks. Not included in Stage 42, which adds accounting, visibility, and hard safeguards only.
- **File structures and automatic TOCs:** an explicit mode or action for bounded, read-only file-structure/title discovery and TOC generation, without background vault scans or writes to discovered files.
- **Automatic linked/folder context:** evaluate any default-off automatic inclusion or recursive expansion separately from the implemented explicit All/Links/folder snapshots in [Stage 45](devel_docs/45-related-notes-explorer.md). Preserve visible paths, deduplication, bounded read-only snapshots, consistent path privacy, and no new write path; no background discovery is approved.
- **Insert-only text enrichment:** an explicit addition action that inserts useful new text at a precise anchor without replacement or deletion, using existing Operations and Track Changes targets.
- **Follow-up edits to unaccepted suggestions ([#37](https://github.com/chliu1990/obsidian-emend/issues/37)):** deterministic merging into existing CriticMarkup without implicit accept/reject, nested or ambiguous markup, or loss of unaffected suggestions; preserve exact accept/reject bytes and Stage 38 structural safeguards.
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

### Deferred from the 2.10 stabilization round

The 2.10 bug hunt closed every release blocker but deliberately deferred the following items. Each is recorded in [Stage 51](devel_docs/51-2-10-stabilization.md) with its evidence and risk and has its own tracking issue; none is a shipping blocker, and none changes current behavior.

- **`chat-view.ts` decomposition ([#76](https://github.com/chliu1990/obsidian-emend/issues/76)):** the class owns rendering, sessions, capture, capacity, Web, persistence, and request state (more than 2,300 lines and six state machines), and its tests re-implement private contexts to exercise it. A split is a broad behavior-preserving refactor that would collide with a release branch.
- **One edit-freshness model ([#77](https://github.com/chliu1990/obsidian-emend/issues/77)):** `note-writer.ts` checks disk bytes plus every open editor while `selection-editor.ts` checks only its captured editor. Unifying them behind one `EditFreshness` view must preserve the Stage 51 fail-closed checks.
- **One edit-target representation ([#78](https://github.com/chliu1990/obsidian-emend/issues/78)):** `edit-target.ts` choices, `displayedEditTarget`, per-submission draft-capture conversions, and a mutating `getTargetMarkdownView()` encode the same target three ways.
- **One Markdown structure scanner ([#79](https://github.com/chliu1990/obsidian-emend/issues/79)):** `selection-context.ts` and `markdown-edit-guards.ts` implement divergent frontmatter, fence, and table scans; any consolidation must preserve the Stage 38 conservative boundaries and exact diagnostics.
- **`provider-stream.ts` split ([#80](https://github.com/chliu1990/obsidian-emend/issues/80)):** transport, SSE parsing, tool assembly, the per-fetch capacity guard, and caller-kind flags such as `allowToolOnlyResponse` share one module.
- **`deepseek-web.ts` split ([#81](https://github.com/chliu1990/obsidian-emend/issues/81)):** Search/Fetch clients, retry policy, loop orchestration, citation registration, and cap fitting share one module.
- **Related-notes explorer layout cost ([#82](https://github.com/chliu1990/obsidian-emend/issues/82)):** the floating panel uses fixed body positioning with no resize/scroll tracking, and an All/Links refresh performs O(vault) metadata probes. The explicit manual Refresh keeps current behavior correct and cheap at ordinary vault sizes. Link discovery can also be incomplete while Obsidian is still indexing metadata; there is no body-scan fallback by design.
- **Aggregate lifecycle on note rename or delete ([#83](https://github.com/chliu1990/obsidian-emend/issues/83)):** a rename re-points the open view but does not migrate the chat aggregate, and deleting a note leaves its saved conversation behind.
- **Instruction caching ([#84](https://github.com/chliu1990/obsidian-emend/issues/84)):** `instructions-loader.ts` re-reads vault instructions and skills on every request with no cross-request cache; only the 20,000-character cap bounds the work.
- **`saveSettings` double invocation ([#85](https://github.com/chliu1990/obsidian-emend/issues/85)):** a function updater is invoked twice, which is safe only while every updater stays pure.
- **Dead CSS ([#86](https://github.com/chliu1990/obsidian-emend/issues/86)):** `styles.css` still carries rules for removed header controls (mode buttons, the shortcut list, and the retired refresh-model icon).
- **Public chat-view test surface ([#87](https://github.com/chliu1990/obsidian-emend/issues/87)):** tests assert private prototypes and hand-built contexts rather than a public view contract, which is why several 2.10 defects stayed green.
- **Actionable in-token selection rejection ([#88](https://github.com/chliu1990/obsidian-emend/issues/88)):** a selection edit strictly inside an existing pending tracked change is intentionally rejected, but the notice is still the generic compiled-markup message and the request still spends its one correction round; a terminal, actionable notice (accept or reject first, or select the whole change) needs its own copy and UX review.
- **Uniform capacity announcement policy ([#89](https://github.com/chliu1990/obsidian-emend/issues/89)):** chat updates the capacity summary live region synchronously while the Modify Selection textarea defers it by 500 ms; choosing one policy needs a real screen-reader session.
- **Tool-client configuration degradation ([#90](https://github.com/chliu1990/obsidian-emend/issues/90)):** a `DeepSeekConfigurationError` aborts the Web loop from a tool-client guard that the chat transport's identical configuration check makes effectively unreachable; deciding whether to delete that guard or define a degradation contract needs a deliberate decision.
- **Platform and provider verification gaps ([#91](https://github.com/chliu1990/obsidian-emend/issues/91)):** macOS, Windows, physical keyboards, screen readers, popout edge cases, other Obsidian versions, and real DeepSeek/Kimi accounts remain unverified; current evidence is Linux/Xvfb with loopback mocks and dummy credentials.

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
- [Edit and chat workflow improvements](devel_docs/future-edit-and-chat-workflows.md)
- [Publication and distribution](devel_docs/publication.md)

These designs guide future work but do not commit the project to every feature. See [CHANGELOG.md](CHANGELOG.md) for shipped behavior and [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process.
