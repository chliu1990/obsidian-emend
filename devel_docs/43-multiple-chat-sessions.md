# Stage 43: Multiple chat sessions per note

## Status and scope

Multiple chat sessions are implemented on `feat/multiple-chat-sessions`. Each note keeps an ordered set of independent conversations in its existing hashed local chat file. The session row directly after capacity and before messages provides New, Switch, Rename, and Delete controls; drafts and provider history are scoped to the exact `{notePath, sessionId}` identity. PR #53 feedback removed Move controls and the view reorder path, deferring reorder to a future management page while preserving pure/store helpers. Original product implementation was based at `f66d80b`; the verification sanitizer fix was `1780799` (`fix: strip unknown persisted message artifacts`).

This stage adds no AI-generated titles, AI session summaries, management tab, note-rename history migration, cross-note moves, session search, cross-vault sharing, background request, new writer, or change to provider transports, capacity formulas, edit protocols, or permission paths. Automatic titles are derived locally from the successful exchange's prompt.

## Schema 3 and invariants

`ConversationStore` writes one schema-3 aggregate per note under `<configDir>/emend/chats/`:

```ts
interface ChatConversation {
	version: 3;
	lastActiveSessionId: string | null;
	sessions: ChatSession[];
}

interface ChatSession {
	id: string;
	title: string;
	titleSource: 'auto' | 'manual';
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}
```

The JSON field names are exactly `version`, `lastActiveSessionId`, `sessions`, `id`, `title`, `titleSource`, `createdAt`, `updatedAt`, and `messages` at the aggregate/session levels. Message fields retain the shared ready-message serializer.

- IDs are nonempty and unique within a note. New IDs use `crypto.randomUUID()`; the one legacy session uses stable ID `legacy`.
- Manual array order is preserved; no timestamp sort is applied. A nonempty aggregate's active ID must exist. Only an empty aggregate has `lastActiveSessionId: null`.
- Runtime fallback is the first session when the runtime selection is unavailable. Deleting an active session selects its next sibling, otherwise its previous sibling; deleting the last session persists an empty aggregate and exposes a runtime-only New chat.
- Duplicate/missing IDs, invalid titles/sources/timestamps/message containers, or invalid active references make schema 3 malformed. Loads never repair those bytes.
- Invalid and non-ready message entries are filtered. Valid ready entries are normalized through the exact-field shared serializer, which also removes unknown artifacts and sanitizes Web metadata.
- Session timestamps are finite numbers. Legacy timestamps are the minimum/maximum ready-message timestamps, or zero for an empty legacy thread. Message append and rename update `updatedAt`; set-active and reorder do not.
- Note deletion leaves the aggregate intact. Note-rename migration remains deferred.

## Titles and ready-message cadence

Titles are trimmed, single-line, whitespace-collapsed, nonempty strings of at most 80 Unicode code points. Automatic derivation uses the first 79 code points plus `…` when over the limit. Empty automatic input produces `New chat`. Manual input follows the same normalization but rejects over-length input rather than truncating it.

A new session starts as `{title: 'New chat', titleSource: 'auto'}`. A legacy session derives its automatic title from its first ready user message, or uses `New chat` when none exists. Only a successfully persisted assistant completion supplies `titlePrompt`; the assistant append and automatic title update share one `updatedAt` and one atomic write. Manual titles never change automatically. Initial user persistence, provider errors, capacity failures, pre-commit Stop/abort/stale failures, and management actions do not derive titles.

## Loading and lazy migration

`loadConversation(notePath)` waits for earlier queued mutations, then returns one of `schema3`, `legacy`, `missing`, `malformed`, or `unsupported` with an in-memory aggregate.

- Missing files return an empty aggregate without creating a file or directory.
- Schema 1/2 messages load losslessly through the shared serializer as one stable `legacy` session. No eager write occurs.
- Schema 3 loads validated/sanitized sessions without a write.
- Malformed JSON/schema preserves bytes, warns without secrets, and opens an empty runtime aggregate.
- Unsupported numeric versions preserve bytes, warn, and open an empty runtime aggregate.

The first valid mutation rereads and migrates the latest legacy data inside the per-note queue. A malformed original is copied exactly to the reusable `.corrupt` file only when a valid replacement is about to write. Every mutation against an unsupported version rejects before directory creation, backup, temp write, rename, process, or remove.

Opening an empty/missing/malformed/unsupported aggregate creates or reuses one runtime-only New chat. Merely opening a note does not persist it. The per-note transient cache preserves its exact ID, draft association, ready user messages left by a failed save, and transient error/stopped content across note switches in the same view lifetime. Actual plugin/Obsidian reload clears this runtime state.

New from a sole empty transient materializes/replaces that session and transfers its draft instead of creating an invisible second empty session. If that transient has ready user messages from a failed initial save, New first recovers it and then creates/activates an empty session in a second mutation. Rename materializes a transient with a manual title. Transient Delete only replaces local runtime state and never rewrites missing, malformed, or future-version bytes. A successful first submission materializes the transient with its ready user; later assistant append cannot recreate a deleted ID. Every successful transient `createSession` immediately clears that exact session ID and removes the per-note cache entry only if it still points to that ID, regardless of request/UI currentness. Visible metadata and rendering remain identity-guarded.

## Exact-ID queued store API

The public mutation surface is:

```ts
loadConversation(notePath): Promise<LoadedChatConversation>;
createSession(notePath, session, options?: { activate?: boolean }): Promise<ChatSession>;
appendReadyMessage(notePath, sessionId, message, options?: {
	titlePrompt?: string;
	now?: number;
	signal?: AbortSignal;
}): Promise<ChatSession>;
setActiveSession(notePath, sessionId): Promise<void>;
renameSession(notePath, sessionId, title, options?: { now?: number }): Promise<ChatSession>;
deleteSession(notePath, sessionId): Promise<{ activeSessionId: string | null }>;
reorderSessions(notePath, orderedIds): Promise<void>;
```

Each operation snapshots its arguments at invocation and enters the existing per-note queue. The queued operation performs read → inspect/migrate → validate → exact-ID mutate → atomic temp/rename or `DataAdapter.process` fallback. No caller-supplied whole aggregate is written. Create rejects duplicate IDs. Append requires a ready message and an existing ID; a deleted/missing ID rejects without resurrection. Reorder requires the exact current ID set with no duplicate, missing, unknown, or length-mismatched entry. Returned sessions are persisted snapshots. Loads and independent operations on other notes retain the existing behavior.

## Controls and runtime identity

The compact row directly after the context capacity display and directly before messages contains a native `select[aria-label="Chat session"]` and icon buttons labelled **New chat session**, **Rename chat session**, and **Delete chat session**. It is outside the header; mode controls remain before capacity. Rename validates its modal input; Delete names the target as plain text and requires confirmation. All session controls disable while sending, thread-loading, or mutating; Stop remains available. Management actions call no provider. Move up/down controls and the view callback/method path were removed by PR #53 feedback; reordering is deferred to a future session management page, while the pure/store reorder operations remain available to that deferred surface.

The view tracks `{notePath, sessionId, generation}` for each active request. Generation increments on actual note/session transitions and close. Currentness requires an open view plus exact path, session ID, and generation; request cleanup also compares the active request object identity. Stale loads, stream callbacks, completions, save Notices, and cleanup cannot replace or release newer view/request state.

Drafts use nested maps keyed by exact note path and session ID, never concatenated keys. Switching saves the old draft and restores only the target draft; Delete removes the deleted draft. Drafts never persist. Same-note session transitions preserve selected mode, Web mode, explicit/automatic Edit-target choice, and additional-note selections. Actual note transitions retain the previous mode/Web behavior and reset Edit target to automatic. Capacity estimates and quick-action blocking recompute from the target session's draft and ready history.

Provider history comes only from the originating session's ready messages before the new user/loading pair, using the configured `historyMessageLimit`. Full-note and Selection results, usage, reasoning, Web warnings/badges/citations/activity, and automatic title updates append only to that originating session. Management operations serialize through `isSessionMutating` as well as the store queue, and failures leave the current visible persisted state intact.

The existing pending-path registry remains per **note**, not per session. Session A therefore excludes session B and Modify Selection for the same note with exactly `Wait for the current Emend request to finish.`; different notes remain independent. Note/session transitions abort the active request and close Web review. Initial user-save failure prevents the provider request. Final assistant-save failure retains transient error content without a ready-history or title update. Pre-commit abort guards prevent assistant/title persistence, and uncommitted Stop/error/abort states never persist. Once the final atomic append commits, its ready assistant and exact title/timestamps are authoritative in the originating runtime session even if Stop/note-switch/close raced the save. Stop on the same current session may render that durable answer; note-switch/close suppress rendering into another note or closed view. No compensating rollback or overwrite is performed.

## Persistence and privacy

Ready messages may include mode, source path, timestamp, main reasoning, provider/estimated usage, ready Review/Auto user badges, sanitized citations and activity, and ordinary Edit result content (header, target, optional model summary, sanitized bullets). Source-less legacy usage loads as provider-reported. Unknown message artifacts are discarded through the same exact-field serializer used for new writes.

Drafts, loading/error/stopped messages, request artifacts, raw operation candidates/envelopes/correction feedback, note or selection snapshots, additional-note selections/snapshots/content, raw tool arguments/results, retrieval content, extractor/verifier/refine payloads/evidence/reasoning/rounds, transient Web activity, activity failure reasons, failure HTTP statuses, attempt counts, credentials, and buffered full edit responses are not persisted. Ordinary completed/failed/skipped activity outcome status and warnings that are ordinary ready assistant content remain persistable. API keys remain in SecretStorage with empty `apiKey` fields in plugin `data.json`.

AI session summaries and AI naming are not implemented. There is no hidden management or summarization provider operation. Note-rename history migration, cross-note session movement, and session search remain deferred.

## Automated verification and RED→GREEN fix

The product-fix gate passed `npm test` with **46 Vitest files and 1,526 tests**, `npm run lint`, strict TypeScript plus production esbuild through `npm run build`, and `git diff --check`. This increased the pre-verification baseline from 1,522 to 1,526 tests.

The final documentation gate then passed the complete required sequence `npm ci && npm test && npm run lint && npm run build && git diff --check`: clean installation of 354 packages, **46 files and 1,526 tests**, clean ESLint, strict TypeScript plus production esbuild, and a clean diff check. `npm ci` reported **13 moderate-severity dependency advisories**; no unrelated audit fix was applied.

Real-Obsidian scenario 5 confirmed that unknown fields on an already persisted schema-3 message survived the next valid mutation. A focused test was added first to `tests/conversation-session-mutations.test.ts`: it seeded `rawReaderArtifact` and `snapshot.selectedText`, called `setActiveSession`, and required exact sanitized messages.

- **RED:** `npx vitest run tests/conversation-session-mutations.test.ts` failed 1 of 28 tests; both unknown fields remained in the written aggregate.
- **GREEN:** `normalizeLoadedMessage` now delegates to the existing exact-field `toPersistedMessage` serializer before usage-source normalization. The focused command passed, the three conversation/session suites passed **114 tests**, and the full gate passed **1,523 tests**, lint, build, and diff check.
- The fix was committed separately as `1780799` before the passing loopback run. No assertion was weakened to hide the defect.

The final transient-materialization review added delayed-create Stop and A→B→A regressions. **RED:** four tests failed with 11 assertion failures, including duplicate submit/New/Rename and local-only Delete. **GREEN:** one shared successful-create path now clears the exact transient ID and same-ID cache immediately, independent of UI currentness; the focused chat-view suite passed **188 tests**, and the full gate passed **1,526 tests**, lint, build, and diff check.

The combined-release consistency review changed final-save regressions to require runtime/disk agreement after a successful post-abort commit. **RED:** four tests returned stopped runtime instead of the durable ready exchange. **GREEN:** only the post-commit identity throw was removed; pre-commit and initial-save guards remain, the focused suite passed **188 tests**, and the full gate passed **1,526 tests**, lint, build, and diff check.

## Real-Obsidian loopback evidence

- Date: 2026-11-12, Asia/Shanghai; final consistency evidence summary generated `2026-11-12T09:19:10.055Z` after the clean-gate build.
- Tested tree: `6269636d2e63298faab426ae0d29568940552abc` plus the final-save consistency fix in this branch; the ignored `test_vault/emend-selection-chat-verify/verify.mjs --sessions` harness is not committed.
- Runtime: official Obsidian **1.15.0** AppImage under isolated Xvfb `:101`, CDP `19224`, synthetic notes only.
- Provider: loopback OpenAI-compatible SSE mock at `127.0.0.1:18766` and loopback Fetch endpoint, with a dummy SecretStorage credential. No real account, external network, or paid call.
- Commands: `npm run build`; `node test_vault/emend-selection-chat-verify/verify.mjs`; `node test_vault/emend-selection-chat-verify/verify.mjs --sessions`; `sha256sum main.js`.
- Results: the full matrix passed **27/27 scenarios and 547/547 assertions**, and the sessions matrix passed **9/9 scenarios and 156/156 assertions**. Combined wall time about 105 seconds.
- Root and runtime-vault loaded bundle SHA-256: `8ff390bb38357617a7bcf91c9a3a610d77d31e45fdfbb5c4827f2cf117b4d69a`. The harness asserts byte equality before startup, and the paths were checked again after completion.

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Missing/transient first Ask | 12 | Missing history created no file; transient identity/draft survived note switches; first Ask wrote schema 3, an automatic title, two ready messages, and usage; no note write. |
| 02 Three-session drafts/history | 16 | Three IDs, exact per-session drafts, retained mode/Web/Edit-target/additional notes, actual wire histories isolated to the active session, and zero management provider calls. |
| 03 Manual/auto/stopped/error titles | 11 | Manual pinning across later success, stopped/error title nonupdates and transient exclusion, successful retry cadence, and no writes. |
| 04 Delete/reload | 12 | Move-control absence, mode → capacity → session controls → messages placement outside the header, confirmation Cancel, zero management requests, actual reload order/active restore, inactive delete, next/previous fallback, and empty aggregate/runtime New chat. |
| 05 Actual reload and sanitized restore | 12 | Ready Edit and Web content, usage, reasoning, Auto badge, safe citation/activity restore, and removal of non-ready/unknown/credentialed/transient fields. |
| 06 Schema 1/2/malformed/future matrix | 19 | Lossless lazy schema 1/2 migration, exact malformed backup, transient-delete nonwrite, and all six future-version mutations rejected with unchanged bytes/no temp or backup. |
| 07 Stop/retry/abort/pending locks | 15 | Sole-transient New semantics, same-note and Modify Selection exclusion, different-note independence, modal retry state, Stop retry history, note-switch abort without late ready response/title. |
| 08 Full-note/Selection edits | 14 | Originating-session summaries/history/usage/titles, one guarded full-note write, one native Selection replacement, exact native undo/redo, and Track Changes markup. |
| 09 Capacity/Web/privacy/narrow/keyboard | 45 | Active-history estimate changes, blocked keyboard submission, Web warning/activity/usage persistence, transient/raw exclusion, 240 px controls, trusted CDP native New/Rename keyboard operation, and a 13-file privacy audit. |

Every scenario asserted its intended note/persistence/request behavior. Management actions added zero provider requests; no scenario produced an unintended note write. Request logs contained no headers or dummy credential.

## Unverified items and limitations

- Linux only. Windows, macOS, and mobile were not exercised; mobile support is not declared.
- Keyboard checks used trusted CDP `Input.dispatchKeyEvent` for native controls and CDP-dispatched live-composer events, not physical OS-level typing. Ctrl/Linux behavior was exercised; Cmd/macOS was not.
- No real provider/account/credential/external network/paid call was used. Provider compatibility, real retrieval, and billing behavior are not claimed.
- Narrow layout was checked geometrically with widths and bounding boxes, not by reviewing every glyph on every platform/theme.
- Unit tests cover the broader malformed schema-3 invariant matrix, queued races, title Unicode boundaries, atomic fallback, stale close/load/request identities, and management failure paths that are impractical to enumerate in one real-Obsidian run.
- Independent whole-branch review and publication are separate controller steps; this record does not claim PR/CI/release verification.
