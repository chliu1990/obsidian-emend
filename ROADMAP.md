# Emend roadmap

Emend aims to be the most predictable and privacy-conscious way to chat with and edit Obsidian notes—not the plugin with the most AI features. Safe Operations-based editing, explicit user actions, local data control, and reliable provider behavior come before feature count.

Features have no fixed deadlines. Each independently reviewable behavior gets its own focused PR, and feature PRs remain separate from release PRs.

## Now

Maintain Emend 2.10.0 with bug fixes, security updates, documentation, and provider compatibility. Feature and documentation PRs do not advance the released version.

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
| Public chat-view test seam | Real view instances cover the scoped session, modification, streaming, and dismissed-menu behaviors through public methods and DOM/provider/store boundaries. Eighteen cases migrated; unrelated legacy tests remain without new private-prototype retrofitting. | [Stage 54](devel_docs/54-public-chat-view-test-seam.md) |
| Resolved edit-target flow | One maintained target drives display, capacity, quick actions, and one-time capture; real note changes reset automatic targeting, vanished Selection fails closed, Markdown lookup is pure, and existing writer contracts remain separate. | [Stage 55](devel_docs/55-edit-target-flow.md) |
| Shared edit freshness | Full-note and Selection edits require exact saved-note, captured-editor, and every-open-editor equality with the captured complete note. Full-note retains guarded vault writes; Selection retains synchronous native replacement and undo. | [Stage 56](devel_docs/56-edit-freshness.md) |
| Shared Markdown scanning | Lossless lines and named lexical projections are shared through Selection-only context scanning and edit-only guard scanning. Selection expansion, conservative edit policies, diagnostics, and writers remain separate and unchanged. | [Stage 57](devel_docs/57-markdown-scanner.md) |
| Modification controller | Stateless, request-scoped Edit-only dispatch, reasoning/retry forwarding, and concise applied/no-op result formatting are extracted from the view. Capture, Chat/Web, lifecycle, persistence, freshness, correction, and writers retain their existing owners. | [Stage 58](devel_docs/58-modification-controller.md) |
| Actionable in-token rejection | In current 2.11 scope, a changed Selection candidate strictly inside a pending tracked change fails after the initial request with actionable Track Changes recovery and no impossible correction, freshness read, or write. Valid no-op behavior and other correction paths remain unchanged. [#88](https://github.com/chliu1990/obsidian-emend/issues/88) closes only when the PR merges; pending-card merging remains deferred. | [Stage 59](devel_docs/59-actionable-in-token-rejection.md) |
| Review-change attribution | In current 2.11 scope, every new insertion, deletion, substitution, and comment uses fixed `Emend` authorship. Supported bare and other-author markup remains byte-exact; new output has no dates, configurable author, or comment discussions. Writers, freshness, correction, and pending-card exclusions are unchanged. [#44](https://github.com/chliu1990/obsidian-emend/issues/44) closes only when the PR merges; companion changes and follow-up merging remain separate. | [Stage 60](devel_docs/60-emend-authorship.md) |
| Track Changes compatibility | Current 2.11 scope records durable bare/`Emend` fixtures against Track Changes 2.3.0 while keeping each table text Operation within one existing cell and structural Operations fail-closed. Structural-card evidence uses only a local, unmerged, unreleased companion branch; overall presentation compatibility remains false. `Refs #36`, which stays open. PR 09 remains blocked until a companion change is merged and its integrated compatible version/commit is declared. | [Stage 61](devel_docs/61-track-changes-compatibility.md) |

Earlier shipped Operations editing, grounded Web retrieval, capacity safeguards, and edit summaries remain current; see the [architecture contract and stage index](IMPLEMENTATION_PLAN.md) and [CHANGELOG.md](CHANGELOG.md).

Track Changes remains a separate companion plugin and Emend's only CriticMarkup review surface. Automatic installation and bundling are not planned ([#36](https://github.com/chliu1990/obsidian-emend/issues/36)). Any missing-plugin detector or explicit user-clicked installation affordance requires a separate runtime design and review; it is not part of the documentation PR.

## Next

The public-launch path remains independent content PRs plus the normal separate release PR, which contains only CHANGELOG, version metadata, and release-only status/installation documentation and verification updates:

1. **Public launch — released:** the redesigned entry points and five public guides, contributor/technical documentation, six current visuals, and concise evidence-backed launch copy are integrated. Emend 2.10.0 is tagged and published with synchronized version metadata and packaged-install verification ([Stage 53](devel_docs/53-2-10-release.md)). Any announcement and Community Directory submission remain separate explicit decisions. Follow [publication and distribution](devel_docs/publication.md).

## Later

- **Edit-failure feedback and bounded retry ([#48](https://github.com/chliu1990/obsidian-emend/issues/48)):** the shipped baseline already makes exactly one automatic same-provider correction request for a correctable candidate-validation failure, with the unchanged original request, the invalid candidate, and bounded diagnostic feedback, and a second invalid candidate is terminal ([Stage 37](devel_docs/37-minimal-edit-ranges.md)). Still deferred: a configurable retry count beyond that single correction, an explicit user-driven retry with different feedback, and partial application when independent positions fail. Any change needs visible cost/latency disclosure, no silent retries, and a separate safety design because partial application conflicts with atomic fail-closed editing. See [future edit and chat workflows](devel_docs/future-edit-and-chat-workflows.md).
- **Vision inputs:** embedded vault images with strict provider, file-type, size, and capability checks, starting with one provider/model family.
- **Automatic context compression:** separate, default-off behavior built on the Stage 42 accounting, with an explicit configurable threshold (proposed 75%), privacy/cost disclosure for the extra provider request, and safe full-note/selection fallbacks. Not included in Stage 42, which adds accounting, visibility, and hard safeguards only.
- **File structures and automatic TOCs:** an explicit mode or action for bounded, read-only file-structure/title discovery and TOC generation, without background vault scans or writes to discovered files.
- **Automatic linked/folder context:** evaluate any default-off automatic inclusion or recursive expansion separately from the implemented explicit All/Links/folder snapshots in [Stage 45](devel_docs/45-related-notes-explorer.md). Preserve visible paths, deduplication, bounded read-only snapshots, consistent path privacy, and no new write path; no background discovery is approved.
- **Insert-only text enrichment:** an explicit addition action that inserts useful new text at a precise anchor without replacement or deletion, using existing Operations and Track Changes targets.
- **Follow-up edits to unaccepted suggestions ([#37](https://github.com/chliu1990/obsidian-emend/issues/37)):** deterministic merging into existing CriticMarkup without implicit accept/reject, nested or ambiguous markup, or loss of unaffected suggestions; preserve exact accept/reject bytes and Stage 38 structural safeguards.
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

- **`chat-view.ts` decomposition ([#76](https://github.com/chliu1990/obsidian-emend/issues/76)):** only the modification submission/review interaction extraction has landed ([Stage 58](devel_docs/58-modification-controller.md)). Issue #76 remains open for session/thread lifecycle, request/abort identity, streaming render/scroll generations, composer draft/capacity, Web draft/review state, and control synchronization. The remaining split is still a broad behavior-preserving refactor, not part of the controller PR or a later feature approval.
- **`provider-stream.ts` split ([#80](https://github.com/chliu1990/obsidian-emend/issues/80)):** transport, SSE parsing, tool assembly, the per-fetch capacity guard, and caller-kind flags such as `allowToolOnlyResponse` share one module.
- **`deepseek-web.ts` split ([#81](https://github.com/chliu1990/obsidian-emend/issues/81)):** Search/Fetch clients, retry policy, loop orchestration, citation registration, and cap fitting share one module.
- **Related-notes explorer layout cost ([#82](https://github.com/chliu1990/obsidian-emend/issues/82)):** the floating panel uses fixed body positioning with no resize/scroll tracking, and an All/Links refresh performs O(vault) metadata probes. The explicit manual Refresh keeps current behavior correct and cheap at ordinary vault sizes. Link discovery can also be incomplete while Obsidian is still indexing metadata; there is no body-scan fallback by design.
- **Aggregate lifecycle on note rename or delete ([#83](https://github.com/chliu1990/obsidian-emend/issues/83)):** a rename re-points the open view but does not migrate the chat aggregate, and deleting a note leaves its saved conversation behind.
- **Instruction caching ([#84](https://github.com/chliu1990/obsidian-emend/issues/84)):** `instructions-loader.ts` re-reads vault instructions and skills on every request with no cross-request cache; only the 20,000-character cap bounds the work.
- **`saveSettings` double invocation ([#85](https://github.com/chliu1990/obsidian-emend/issues/85)):** a function updater is invoked twice, which is safe only while every updater stays pure.
- **Dead CSS ([#86](https://github.com/chliu1990/obsidian-emend/issues/86)):** `styles.css` still carries rules for removed header controls (mode buttons, the shortcut list, and the retired refresh-model icon).
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
