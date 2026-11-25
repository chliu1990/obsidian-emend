# Implementation Plan: Emend

## Status and documentation ownership

This file is the current architecture contract and numbered index for the implemented Emend rewrite. It is not unfinished pseudocode, a second user guide, or an archive of verification narration.

Documentation has separate owners:

- [README.md](README.md), [docs/README.md](docs/README.md), and the focused public guides own current user behavior and task flows.
- [AGENTS.md](AGENTS.md) owns durable operational rules for contributors and coding agents; it is not an exhaustive behavior specification.
- This architecture contract owns technical boundaries and links to their detailed records.
- Numbered stage records own exact behavior, design decisions, verification matrices, historical evidence, and limitations. Historical records remain unchanged.
- [ROADMAP.md](ROADMAP.md) owns recently shipped status, deferred work, and non-goals. [CHANGELOG.md](CHANGELOG.md) owns versioned release history.

Files beginning `devel_docs/future-` describe deferred designs, not current behavior or approval. Stage 42 implements capacity accounting and hard safeguards; Stages 44–50 implement the compact composer, explicit Related notes, local model controls, live Selection, response continuity, Selection context, and native menu activation. Stage 51 records stabilization, and Stage 52 implements provisional Web drafts. Stage 53 records the 2.10.0 release, Stage 54 establishes the public chat-view behavioral test seam, Stage 55 resolves Edit-target flow and makes Markdown target lookup pure, and Stage 56 gives Full-note and Selection edits one exact disk/every-editor freshness contract while preserving their separate writers. Stage 57 consolidates lossless Markdown lexical scanning behind separate Selection-context and edit-guard projections while retaining their policy modules and behavior. Stage 58 extracts only request-scoped Edit dispatch, callback forwarding, and concise result formatting into the modification controller while leaving the other `chat-view.ts` state machines and issue #76 open. Stage 59 makes only strict in-token composed Selection rejection non-correctable while preserving valid no-op results, every other correction path, and existing freshness and writer ownership. Stage 60 parses and preserves supported bare and attributed CriticMarkup while emitting fixed `Emend` authorship on every new insertion, deletion, substitution, and comment, without dates, an author setting, comment discussions, or changes to raw-token matching, writers, freshness, correction, or pending-card exclusions. Automatic compression, automatic linked/folder inclusion, background discovery, and automatic TOCs remain deferred.

## Architecture contract

### Runtime and provider boundaries

- Emend is desktop-only and requires Obsidian 1.11.4 or newer. DeepSeek `deepseek-flash`, Kimi `k3.1-pro`, and custom HTTP(S) endpoints use one OpenAI-compatible streaming `fetch` transport with Server-Sent Events. Preset URLs and models remain editable. See [Stage 05](devel_docs/05-streaming-provider.md) and [Stage 19](devel_docs/19-provider-metadata.md).
- Chat and Chat Selection have no note writer. Default-off Web Review/Auto is supported only for DeepSeek `deepseek-flash` and `deepseek-v4-pro`; unsupported providers and models fail without silent unsearched fallback. Search/Fetch is model-directed, bounded, and reviewable. The answering model receives actual source metadata plus verified claims with exact quotes, or quotes-only evidence, never raw retrieval. See [Stage 36](devel_docs/36-deepseek-online-search.md) and [Stage 40](devel_docs/40-web-content-budget-diagnostics.md).
- Ready and stopped answer text is seeded synchronously before asynchronous Markdown rendering. Web submissions begin with transient research status. Provisional Web content is labelled `Draft answer — research may continue`, resets before tool review/execution, and promotes once to the terminal answer. Draft text and its transient flag never enter copy, history, or persistence. See [Stage 48](devel_docs/48-web-response-transition.md) and [Stage 52](devel_docs/52-web-draft-streaming.md).
- Provider credentials use Obsidian SecretStorage; sanitized settings keep `apiKey` fields empty. Credential-bearing base URLs are rejected before requests and userinfo is redacted in errors. See [Stage 21](devel_docs/21-secret-storage.md) and [Stage 51](devel_docs/51-2-10-stabilization.md).

### Context, sessions, and composer boundaries

- Ordinary Chat uses bounded note context. Chat Selection sends the complete note plus a separate complete read-only focus Selection and fails closed without a usable Selection. Full-note Edit sends the complete note. Selection Edit sends the complete Selection with Default Smart/Symmetric or explicit full-note supporting context; context never expands the edit target. See [Stage 39](devel_docs/39-easier-selection-editing.md) and [Stage 49](devel_docs/49-selection-focus-and-context.md).
- `markdown-scanner.ts` owns lossless source lines and named lexical projections only. `selection-context.ts` consumes only `scanMarkdownContext` and retains Selection containment/expansion, budgets, and omission markers; it never computes edit-only projections. See [Stage 57](devel_docs/57-markdown-scanner.md).
- The composer offers Chat, Chat Selection, Edit Selection, Edit Selection with full-note context, and full-note Edit. Chat-only Web choices are disabled in Edit without discarding the retained Chat choice. Edit quick actions reuse the maintained target and submission path. Compact Writing/Web and model/reasoning menus preserve drafts, caret, focus, sessions, capacity, and pending/stale guards, including native hide-before-click activation. See [Stage 44](devel_docs/44-compact-composer.md), [Stage 46](devel_docs/46-composer-model-controls.md), and [Stage 50](devel_docs/50-native-menu-activation.md).
- One maintained `EditTargetState` drives Edit display, capacity, quick actions, and submission. Only real note changes reset the choice to automatic, initially as Full note without eager host I/O before the normal maintained refresh; same-note session and Chat/Edit switches preserve targeting. Capture the existing `CapturedDraftTarget` synchronously once before the initial save. Explicit or maintained automatic Selection that vanishes fails closed without Full-note fallback. Markdown lookup only reads the active, remembered still-open, or first open view; explicit lifecycle tracking alone updates last-active memory. See [Stage 55](devel_docs/55-edit-target-flow.md).
- After the initial ready-user save and active-request check, the view constructs a stateless `ModificationController` for Edit only. It receives the captured target, frozen history and additional-note paths, signal, and view-owned callbacks; Chat, Chat Selection, and Web Review/Auto never enter it. The view retains capture, request identity, sessions, drafts, capacity, streaming, Web state, abort/stale handling, rendering, and saves. See [Stage 58](devel_docs/58-modification-controller.md).
- Related notes are explicit, per-target, session-only, read-only Markdown selections. All/Links/folder discovery uses paths and metadata without body scans or background indexing. Fresh content is read only at submission within a separate fair source budget and never becomes an edit target. See [Stage 35](devel_docs/35-additional-notes-context.md) and [Stage 45](devel_docs/45-related-notes-explorer.md).
- Vault-root `AGENTS.md` and directly referenced skills load at request time, with skills before agent instructions and a bounded combined instruction budget. Paths are shared only when explicitly enabled. See [Stage 04](devel_docs/04-instructions-skills.md).
- Each provider has optional context-window/output-reserve settings. Effective input is window minus reserve; the reserve is local and never sent as `max_tokens`. Character-based estimates are not tokenization or billing data. Submission preflight and every provider fetch enforce valid capacity terminally, without compression, silent truncation, partial answers, or writes. See [Stage 42](devel_docs/42-context-accounting-capacity.md).
- Ready conversations persist as schema-3 ordered per-note session aggregates with exact IDs, manual order, last-active restore, and automatic/manual titles. Schema 1/2 migrates lazily; malformed data is preserved and unsupported versions refuse mutation. Only ready sanitized content/metadata persists in the originating session. Drafts, request bodies, snapshots, raw retrieval, transient Web artifacts, and full edit responses do not. See [Stage 43](devel_docs/43-multiple-chat-sessions.md).
- Provider history uses only the originating session's configured ready-message window. Requests for one note are serialized across sessions and Modify Selection; different notes are independent. Note/session/generation, abort, target, and freshness guards reject stale work. Session management and automatic titles make no provider calls.
- Chat-view behavioral tests use real `EmendChatView` instances through public lifecycle, submission, session, target, and refresh methods, with observations at the rendered DOM and provider/conversation-store boundaries. New tests must not retrofit private prototypes or hand-built view contexts. The explicitly unmigrated legacy suite remains without expansion, and later work migrates any legacy case it touches. See [Stage 54](devel_docs/54-public-chat-view-test-seam.md).
- Live Selection highlighting is a focused CodeMirror decoration over normalized current ranges. It performs no I/O, persistence, focus change, selection/document mutation, provider request, or note write. See [Stage 47](devel_docs/47-selection-highlight.md) and [Stage 49](devel_docs/49-selection-focus-and-context.md).

### Edit and review boundaries

- Operations are the only model-facing edit protocol: a closed bare array or `{summary, operations}` envelope with exact original-snapshot anchors. Validation is atomic and rejects ambiguity, overlap, out-of-target ranges, structural violations, and invalid composed markup. Deterministic replacement minimization compiles valid Operations into CriticMarkup. A correctable candidate-validation failure permits exactly one same-provider correction; provider, abort, stale, capacity, and write failures do not. See [Stage 16](devel_docs/16-operation-based-editing.md), [Stage 37](devel_docs/37-minimal-edit-ranges.md), [Stage 38](devel_docs/38-markdown-edit-safeguards.md), and [Stage 59](devel_docs/59-actionable-in-token-rejection.md).
- `critic-markup.ts` parses the five existing token kinds in supported bare or Track Changes 2.3.0-attributed form. One shared renderer emits `author="Emend"` on every new insertion, deletion, substitution, and comment, including replacement minimization and guard projections; it emits no dates, configurable author, comment discussions, or new highlight tokens. Supported original bare and other-author tokens are preserved byte-for-byte and in order through raw-token equality, not normalized metadata matching. Attributed delimiter injection and nesting remain invalid. Writers, freshness, correction, strict in-token rejection, and pending-card exclusions retain their existing contracts. See [Stage 60](devel_docs/60-emend-authorship.md).
- Only after composed complete-note CriticMarkup rejection, a nonempty Selection strictly inside raw `token.start`/`token.end` for any existing insertion, deletion, substitution, comment, or highlight throws `in-token-selection` with `correctionEligible: false`. The initial request still occurs; the terminal path skips only that impossible correction, continuation, retry callback, freshness reads, and writes. Every other candidate-validation failure retains correction. Source-valid `[]` and unchanged replacements remain ordinary successful no-ops with usage and no freshness reads or writes, while delimiter source validation remains authoritative. This does not merge pending cards; users resolve the pending change in Track Changes and make a fresh Selection. See [Stage 59](devel_docs/59-actionable-in-token-rejection.md).
- Edit guards use `scanMarkdown` plus `scanMarkdownEditStructure`, never the Selection-context projection. `markdown-edit-guards.ts` retains Operation intersection/containment, first-violation ordering, payload and affected-row review-view checks, and diagnostics. Shared scanning does not relax Stage 38 conservative guards or change separate Track Changes compatibility shadows, targets, freshness, or writers. See [Stage 57](devel_docs/57-markdown-scanner.md).
- Full-note Edit and Selection Edit share one asynchronous freshness guard requiring exact disk, captured-editor, and every-open-editor equality with the complete captured note, plus active-target and abort checks. An absent or empty open-editor list permits disk-only comparison but never bypasses the independent target check; no line-ending, Unicode, or whitespace normalization is allowed. Full-note Edit alone then rechecks Edit permission and abort before guarded `vault.modify`. Selection Edit and Modify Selection revalidate the composed complete note, recheck Edit permission and abort, and synchronously call only native `editor.replaceRange` on the captured range, preserving native undo. See [Stage 08](devel_docs/08-full-note-editing.md), [Stage 09](devel_docs/09-selection-editing.md), [Stage 51](devel_docs/51-2-10-stabilization.md), [Stage 55](devel_docs/55-edit-target-flow.md), and [Stage 56](devel_docs/56-edit-freshness.md).
- `modification-controller.ts` selects exactly one existing Full-note or Selection Edit dependency, forwards reasoning/retry callbacks without adding policy, and returns only concise applied/no-op content, applied status, and usage. It owns no target capture, request identity, Web, persistence, freshness, correction, rendering, or writer behavior; the existing coordinators, correction loop, freshness guard, and writers retain those contracts. Command-palette Modify Selection remains outside the controller. See [Stage 58](devel_docs/58-modification-controller.md).
- Raw candidates, full annotated responses, rejected-attempt reasoning, and correction feedback remain private. Chat stores only the concise applied/no-op result, optional validated model summary, sanitized line-based bullets, successful-attempt reasoning, and all-round usage. The summary never enters the note. The Command Palette Selection modal remains notice-only. See [Stage 41](devel_docs/41-post-edit-change-summaries.md).
- Track Changes is a separate companion plugin and the only CriticMarkup review surface. Emend has no in-plugin diff or Apply/Reject UI, does not bundle or automatically install Track Changes, and requires separate design for any missing-plugin runtime affordance.

## Numbered stage records

1. [Testing and CI](devel_docs/01-testing-and-ci.md) — Vitest, Obsidian mocks, CI, and evidence conventions.
2. [Emend identity and settings](devel_docs/02-emend-identity-settings.md) — clean plugin identity and normalized settings.
3. [Modes and permissions](devel_docs/03-modes-permissions.md) — deterministic modes and write permissions.
4. [Instructions and skills](devel_docs/04-instructions-skills.md) — vault instruction and skill loading.
5. [Streaming provider](devel_docs/05-streaming-provider.md) — OpenAI-compatible streaming transport.
6. [Read-only chat](devel_docs/06-read-only-chat.md) — streamed chat without note writes.
7. [CriticMarkup engine](devel_docs/07-critic-markup-engine.md) — parsing and sequential validation.
8. [Full-note editing](devel_docs/08-full-note-editing.md) — guarded whole-note writes.
9. [Selection editing](devel_docs/09-selection-editing.md) — exact-range native replacement.
10. [Conversation persistence](devel_docs/10-conversation-persistence.md) — historical versioned per-note threads; Stage 43 supersedes the single-thread model.
11. [Multi-turn edits](devel_docs/11-multi-turn-edits.md) — sequential edits and per-note isolation.
12. [Quick actions](devel_docs/12-quick-actions.md) — shared guarded Edit submission.
13. [Keyboard shortcuts](devel_docs/13-keyboard-shortcuts.md) — composer and mode shortcuts.
14. [Token usage](devel_docs/14-token-usage.md) — provider usage and labelled estimates.
15. [Smart selection context](devel_docs/15-smart-selection-context.md) — structural context without target expansion.
16. [Operation-based editing](devel_docs/16-operation-based-editing.md) — validated closed JSON Operations.
17. [Release candidate](devel_docs/17-release-candidate.md) — compatibility review and release evidence.
18. [Chat presentation](devel_docs/18-chat-presentation.md) — streamed Markdown presentation.
19. [Provider metadata](devel_docs/19-provider-metadata.md) — provider presets and publication metadata.
20. [Operations-only editing and Selection actions](devel_docs/20-operations-selection-actions.md) — one protocol and shared Selection actions.
21. [SecretStorage API keys](devel_docs/21-secret-storage.md) — credential migration, resolution, and sanitized persistence.
22. [Release verification](devel_docs/22-release-verification.md) — hardened-release review and verification evidence.
35. [Additional notes as context](devel_docs/35-additional-notes-context.md) — explicit bounded read-only snapshots and path privacy.
36. [DeepSeek online search](devel_docs/36-deepseek-online-search.md) — writer-free Web controls, retrieval, grounded evidence, and citations.
37. [Minimal edit ranges](devel_docs/37-minimal-edit-ranges.md) — bounded replacement hunks, diagnostics, and one correction round.
38. [Markdown edit safeguards](devel_docs/38-markdown-edit-safeguards.md) — inline-code, fence, table, and composed-candidate guards.
39. [Easier selected-text editing](devel_docs/39-easier-selection-editing.md) — composer targets and native Selection edits.
40. [Per-query Web extraction](devel_docs/40-web-content-budget-diagnostics.md) — independent Web limits, extraction, verification, and failure handling.
41. [Post-edit change summaries](devel_docs/41-post-edit-change-summaries.md) — optional summaries and sanitized applied-change results.
42. [Context accounting and capacity guards](devel_docs/42-context-accounting-capacity.md) — local estimates, capacity UI, and terminal preflight/fetch guards.
43. [Multiple chat sessions per note](devel_docs/43-multiple-chat-sessions.md) — schema-3 sessions, migration, titles, and runtime identity.
44. [Compact composer](devel_docs/44-compact-composer.md) — compact controls, Edit targets, quick actions, and draft preservation.
45. [Related-notes explorer](devel_docs/45-related-notes-explorer.md) — explicit snapshots, hierarchy, helpers, and manual Refresh.
46. [Composer model controls](devel_docs/46-composer-model-controls.md) — provider/model/reasoning selection and queued settings updates.
47. [Live Selection highlight](devel_docs/47-selection-highlight.md) — current-range decoration with no I/O or mutation.
48. [Web terminal-response continuity](devel_docs/48-web-response-transition.md) — seeded terminal text and initial research status.
49. [Selection focus and shared Selection context](devel_docs/49-selection-focus-and-context.md) — Chat Selection and full-note supporting context.
50. [Native menu item activation](devel_docs/50-native-menu-activation.md) — native hide-before-click acceptance and stale guards.
51. [2.10 bug hunt and stabilization](devel_docs/51-2-10-stabilization.md) — cross-cutting fixes, deferrals, review, and current evidence limits.
52. [Web draft streaming](devel_docs/52-web-draft-streaming.md) — labelled provisional content, reset-before-tools, and terminal promotion.
53. [2.10.0 release](devel_docs/53-2-10-release.md) — release-only changelog, version metadata, and packaged-install verification.
54. [Public chat-view behavioral test seam](devel_docs/54-public-chat-view-test-seam.md) — real-instance public tests, scoped legacy migration, and characterization evidence.
55. [Resolved edit-target flow and pure target lookup](devel_docs/55-edit-target-flow.md) — one maintained/captured target, fail-closed Selection, pure lookup, and preserved writer contracts.
56. [Shared edit freshness with native Selection writes](devel_docs/56-edit-freshness.md) — exact disk/captured/every-editor equality, fail-closed abort/target checks, and separate guarded/native writers.
57. [Shared Markdown lexical scanning](devel_docs/57-markdown-scanner.md) — lossless named context/edit projections with separate Selection and edit-violation policies.
58. [Stateless modification controller](devel_docs/58-modification-controller.md) — request-scoped Edit dispatch, callback forwarding, concise results, and remaining issue #76 ownership.
59. [Actionable in-token Selection rejection](devel_docs/59-actionable-in-token-rejection.md) — terminal strict raw-token composed Selection rejection, actionable Track Changes recovery, preserved no-op/correction boundaries, and current evidence.
60. [Emend authorship](devel_docs/60-emend-authorship.md) — supported attributed parsing and preservation, fixed `Emend` emission on every new suggestion/comment, unchanged edit safety contracts, and current evidence.

## Verification and release process

Run the clean local gate from the repository root:

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

Real-Obsidian verification uses only ignored `test_vault/`, synthetic notes, local OpenAI-compatible chat and DeepSeek Search/Fetch mocks with CORS, and dummy credentials. Never use real accounts, paid calls, private notes, or other vaults. Exercise actual requests/writes and record root/loaded bundle identity where supported.

The stage records are canonical for focused scenarios, test totals, bundle identities, screenshots, and platform/provider limits. Start with [release verification](devel_docs/22-release-verification.md), the [Selection and composer records](devel_docs/49-selection-focus-and-context.md), [Web draft streaming](devel_docs/52-web-draft-streaming.md), and the cross-cutting [2.10 stabilization record](devel_docs/51-2-10-stabilization.md). Do not repeat their historical matrices here or claim real-provider smoke coverage.

GitHub Actions runs lint, tests, and the production build through `.github/workflows/ci.yaml` on `ubuntu-latest` with Node 24. Provider, persistence, write-path, credential, and CI/workflow changes require independent code/security review.

Release work stays separate from feature and documentation PRs. `npm version <patch|minor|major>` synchronizes `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`; update `CHANGELOG.md` in the same release PR. Create or dispatch a tag exactly matching `manifest.json`, without a leading `v`.

After clean install, lint, tests, and a release build, `.github/workflows/release.yaml` publishes these GitHub release assets:

- `main.js`
- `manifest.json`
- `styles.css`
- `emend-<version>.zip`, containing those three files under `emend/`

The ZIP is a convenience package of the same verified release files, not a separate build or an automatic installation mechanism.
