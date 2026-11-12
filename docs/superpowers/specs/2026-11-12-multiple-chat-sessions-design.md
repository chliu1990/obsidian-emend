# Multiple chat sessions per note — technical design

Status: proposed for review, 2026-11-12

## Intent

Emend currently persists one ready-message thread per note. Long-lived notes need independent conversations that can be created, revisited, named, deleted, and reordered without mixing provider history or allowing a late response/save to affect the visible conversation.

This design implements the core of issue #41 while preserving the existing per-note file location, ready-message sanitization, per-note request exclusion, guarded note writers, native selection undo, Track Changes review, and Stage 42 capacity accounting.

## Goals

- Persist multiple ordered chat sessions for each note in one schema-3 aggregate.
- Restore the last explicitly active session, with deterministic runtime fallback.
- Load schema 1/2 threads losslessly and migrate lazily on the first valid mutation.
- Provide New, Switch, Rename, Delete, Move up, and Move down controls in the chat title region.
- Keep drafts and provider history scoped to `{notePath, sessionId}`.
- Update an `auto` title only after a successful assistant completion, in the same atomic mutation as that assistant message.
- Make every persisted mutation operate on an exact session ID inside the existing per-note queue.
- Prevent stale loads, streams, completions, and request cleanup from affecting a newer note/session/view state.
- Exercise migration, persistence, controls, races, and cross-feature behavior in real Obsidian with loopback providers only.

## Non-goals

- AI-generated titles, AI session summaries, a session-summary provider operation, or a separate management tab.
- Note-rename history migration, cross-note session moves, session search, or cross-vault sharing.
- Persisting drafts, loading/error/stopped messages, request artifacts, or additional-note selections.
- Changing provider transports, history-limit settings, capacity formulas, edit protocols, or writer permission paths.
- Automatic context compression or any background provider request.

## Anti-goals and failure conditions

- A late save recreates a deleted session or overwrites another session's messages, title, order, or active selection.
- Switching sessions changes the note, additional-note selection, mode/Web/Edit-target choices, or native undo behavior.
- Opening a legacy thread rewrites it before a valid mutation.
- A malformed or future-version file is overwritten without the existing backup/refusal behavior.
- A management or naming action calls a provider.
- A stale request clears `isSending`, replaces the composer, renders content, or shows an error in a newer session.

## Chosen approach and alternatives

### Chosen: schema-3 aggregate with exact-ID queued mutations

Keep the existing hashed per-note JSON file. Every mutation enters the existing per-note promise queue, reads and validates the latest file, migrates a legacy thread in memory when necessary, applies one exact-ID operation, and performs the existing atomic temp-write/rename or `DataAdapter.process` fallback. Invocation snapshots contain only the operation's session/message data, never a whole aggregate intended to overwrite newer state.

This is the approach selected by the user and required by the governing PR4 plan.

### Rejected: revisioned whole-session snapshots

Whole-session revision checks could reject some stale writes, but they would require a conflict/retry policy and would make independent queued title/order/active updates harder to compose. They also leave deletion-resurrection semantics less direct than exact-ID mutations.

### Rejected: one file per session plus an index

Separate files would isolate message bytes but add session-path lifecycle, index atomicity, cleanup, and migration complexity. They would not provide a single atomic aggregate for order plus active-session state.

## Modules and responsibilities

### `src/chat-sessions.ts`

A pure TypeScript domain module with no Obsidian, vault, network, DOM, or provider dependency. It owns:

- Session/aggregate types and title-source values.
- Title normalization, automatic-title derivation, ID/session construction, active-session resolution, exact-ID reorder validation, and deletion fallback.
- Schema-3 aggregate validation and legacy-thread-to-session conversion.
- Shared persisted-message serialization/loading helpers moved without behavioral changes from `conversation-store.ts`, so schema 1/2/3 all use exactly the same ready-message and Web/usage/reasoning sanitization path.

The module must not import `conversation-store.ts`; the dependency direction is store → session domain.

### `src/conversation-store.ts`

Owns hashed paths, DataAdapter reads/writes, warnings, per-note queues, corruption backup, unsupported-version refusal, and atomic replacement. It exposes aggregate loading and exact-ID mutations, not whole-aggregate saves.

### `src/chat-session-controls.ts`

An Obsidian UI component owning the native session `<select>`, New/Rename/Delete/Move up/Move down buttons, rename modal, and delete-confirmation modal. It emits callbacks and does not call the store or provider itself. The chat view owns state transitions and persistence.

### `src/chat-view.ts`

Owns the active note's in-memory aggregate, active session, transient session state, per-session drafts, active request, generation/identity checks, submission persistence cadence, history selection, and capacity-estimate refresh. `this.messages` may remain as a reference to the active session's messages to minimize unrelated rendering changes.

### `src/main.ts`

Retains the existing store construction, note-refresh events, target capture, and per-note pending-path lock. No session-specific provider or writer path is added.

## Persisted domain model

```ts
const CONVERSATION_SCHEMA_VERSION = 3;
const CHAT_SESSION_TITLE_MAX_CODE_POINTS = 80;
const NEW_CHAT_TITLE = 'New chat';

type ChatSessionTitleSource = 'auto' | 'manual';

interface ChatSession {
	id: string;
	title: string;
	titleSource: ChatSessionTitleSource;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

interface ChatConversation {
	version: 3;
	lastActiveSessionId: string | null;
	sessions: ChatSession[];
}

type ConversationLoadKind =
	| 'schema3'
	| 'legacy'
	| 'missing'
	| 'malformed'
	| 'unsupported';

interface LoadedChatConversation {
	kind: ConversationLoadKind;
	conversation: ChatConversation;
}
```

The JSON field names are exactly `version`, `lastActiveSessionId`, `sessions`, `id`, `title`, `titleSource`, `createdAt`, `updatedAt`, and `messages`.

### Invariants

- Session IDs are nonempty strings and unique within one note aggregate.
- New session IDs use `crypto.randomUUID()`; pure construction helpers accept an ID and timestamp for deterministic tests.
- A legacy session uses the stable per-note ID `legacy`, so repeated pre-migration loads do not change identity.
- `sessions` is the user's manual order; no timestamp sort is applied.
- A nonempty aggregate's `lastActiveSessionId` must reference an existing session. A null reference is valid only for an empty aggregate.
- Runtime fallback after deletion or missing runtime selection is the first session in manual order, or null when no sessions exist.
- Stored duplicate/missing IDs, invalid title/source/timestamps/messages container, and invalid active references make schema 3 malformed. No repair or rewrite occurs on load.
- Message entries retain the existing behavior: invalid or non-ready entries are filtered, while valid ready entries are normalized/sanitized.
- Session timestamps are finite numbers. Legacy `createdAt`/`updatedAt` derive from the minimum/maximum message timestamps, or `0` for an empty legacy thread.
- `updatedAt` changes on message append and rename. Set-active and reorder change aggregate metadata only and do not rewrite session timestamps.

### Titles

- Both automatic and manual titles are single-line, whitespace-collapsed, trimmed, nonempty strings of at most 80 Unicode code points.
- `deriveAutomaticTitle(prompt)` collapses whitespace. If the result exceeds 80 code points, it takes the first 79 code points and appends `…`, for exactly 80.
- Empty automatic input produces `New chat`; normal submission already rejects empty prompts.
- Manual titles use the same whitespace normalization but reject over-length input rather than truncating it.
- A new session starts as `{title: 'New chat', titleSource: 'auto'}`.
- Legacy sessions derive an automatic title from the first ready user message, or `New chat` when none exists.
- A successful assistant completion with `titleSource: 'auto'` derives a new title from that exchange's captured ready user prompt. `manual` titles never change automatically.
- Initial user persistence, stopped responses, errors, capacity failures, stale/abort failures, and management actions never change an automatic title.

## Loading and lazy migration

`ConversationStore.load(notePath): Promise<LoadedChatConversation>` waits for already queued mutations for that note, swallowing a prior mutation rejection only so the load can inspect the actual current bytes.

- Missing file: return an empty aggregate and `kind: 'missing'`; do not create a directory or file.
- Schema 1/2: validate/filter messages with the existing serializer, return one in-memory `legacy` session and `kind: 'legacy'`; do not write.
- Schema 3: return the validated aggregate and `kind: 'schema3'`; do not write.
- Malformed JSON/schema: preserve bytes, issue the existing non-secret warning, return an empty aggregate and `kind: 'malformed'`.
- Unsupported numeric version: preserve bytes, issue the existing unsupported warning, return an empty aggregate and `kind: 'unsupported'`.

The chat view converts an empty loaded aggregate into one runtime-only `New chat` session. It is not persisted merely by opening a note.

The first valid message/session mutation reads and migrates the latest legacy thread again inside the queue, then writes schema 3. A malformed original is backed up to the single reusable `.corrupt` file only when a valid mutation is about to replace it. Any unsupported version rejects every mutation before directory creation, backup, temp write, rename, process, or remove.

## Store mutation API

The final public store surface is:

```ts
load(notePath: string): Promise<LoadedChatConversation>;

createSession(
	notePath: string,
	session: ChatSession,
	options?: { activate?: boolean },
): Promise<ChatSession>;

appendReadyMessage(
	notePath: string,
	sessionId: string,
	message: ChatMessage,
	options?: { titlePrompt?: string; now?: number },
): Promise<ChatSession>;

setActiveSession(notePath: string, sessionId: string): Promise<void>;

renameSession(
	notePath: string,
	sessionId: string,
	title: string,
	options?: { now?: number },
): Promise<ChatSession>;

deleteSession(
	notePath: string,
	sessionId: string,
): Promise<{ activeSessionId: string | null }>;

reorderSessions(notePath: string, orderedIds: readonly string[]): Promise<void>;
```

The legacy whole-thread `save(notePath, messages)` API is removed when chat-view migration is complete; intermediate tasks may retain a compatibility wrapper only while old callers still exist.

### Shared mutation rules

- Every method snapshots/sanitizes its session or message arguments synchronously at invocation, before entering the asynchronous queue.
- Every queued operation performs read → inspect/migrate → validate → exact-ID mutate → atomic write. No operation writes a caller-supplied aggregate.
- `createSession` rejects a duplicate ID. `activate` defaults to true; creation with messages is used for the first submission of a transient session.
- `appendReadyMessage` requires `message.status === 'ready'` and an existing exact session ID. A missing/deleted ID rejects with a non-secret error and performs no write; it never implicitly creates a session.
- `titlePrompt` is supplied only for a successful assistant completion. The assistant append and derived automatic title use one `updatedAt` and one atomic write. There is no separate title save.
- `setActiveSession` requires an existing ID and updates only `lastActiveSessionId`.
- `renameSession` requires an existing ID, stores a manual title, updates `updatedAt`, and returns the persisted session snapshot.
- `deleteSession` removes exactly one session. If it was active, the next sibling at the deleted index becomes active; if there is no next sibling, the previous sibling becomes active; deleting the only session produces `{lastActiveSessionId: null, sessions: []}`. Deleting an inactive session leaves the active ID unchanged.
- `reorderSessions` requires the exact current ID set: same length, no duplicates, no missing or unknown IDs. It changes only array order.
- Mutation return values are snapshots of what was actually persisted, allowing visible metadata to update only after success.
- Note deletion retains the chat file. Current note-rename behavior is unchanged; history migration on rename remains out of scope.

## Runtime state and identity

The chat view maintains:

```ts
interface ChatIdentity {
	notePath: string;
	sessionId: string;
	generation: number;
}

interface ActiveRequest {
	identity: ChatIdentity;
	controller: AbortController;
	loadingMessage: ChatMessage;
}

// View fields:
notePath: string | null;
sessions: ChatSession[];
activeSessionId: string | null;
conversationGeneration: number;
activeRequest: ActiveRequest | null;
isThreadLoading: boolean;
isSessionMutating: boolean;
transientSessionIds: Set<string>;
transientSessions: Map<string, ChatSession>; // notePath → sole unsaved runtime session
drafts: Map<string, Map<string, string>>;
```

`conversationGeneration` increments on every actual note transition, session transition, and view close. `isCurrent(identity)` requires an open view and exact note path, session ID, and generation equality. The active request is also compared by object identity before completion cleanup.

### Drafts, messages, and transient-session lifetime

- Draft keys are nested by exact note path and session ID; no concatenated string key is used.
- Before a note/session transition, the current textarea value is stored under the old identity.
- Switching restores only the target session's draft. Drafts remain session-runtime-only and are never persisted.
- `this.messages` references the active session's messages. Other sessions' loaded messages remain in their own session objects.
- Deleting a session deletes its runtime draft. Creating a session starts with an empty draft.
- Opening an empty/malformed/unsupported aggregate reuses the note's cached transient session when one exists; otherwise it creates one runtime-only `New chat`. It is not persisted merely by opening a note.
- The `transientSessions` cache preserves that session's exact ID, draft association, ready user messages left by a failed save, and transient error/stopped content across note switches during the current view lifetime. Actual plugin/Obsidian reload clears it, as with other runtime drafts.
- A successful `createSession` removes the note's transient cache entry. Returning to the note then loads the persisted aggregate instead of recreating the transient.
- Creating New from a sole transient with no ready messages replaces/persists that session and transfers its current draft; no invisible second empty session is created. If the transient contains ready user messages from a failed initial save, New first persists that current session, then creates and activates the requested empty session in a second mutation. If the second mutation fails, the first remains safely persisted and visible.
- Rename on a transient materializes it through `createSession` with the manual title and any ready messages. Delete on a transient requires confirmation but only discards/replaces local runtime state; it performs no adapter mutation, so missing, empty, malformed, and future-version bytes remain unchanged.
- Submitting a transient session persists it with the ready user message. Subsequent assistant persistence uses `appendReadyMessage` and cannot recreate a deleted session.

### Same-note behavior

Session transitions do not reset selected mode, Web mode, explicit/automatic Edit-target choice, or additional-note selections. Actual note transitions preserve mode/Web as today and reset Edit target to automatic as today. Capacity estimates and quick-action blocking recompute from the target session's restored draft and ready history.

Provider history is taken only from the originating session's ready messages before adding the new user/loading pair, using the existing configured `historyMessageLimit`. No other session's messages enter the request.

## Submission and stale-completion protocol

1. Reject submission while sending, thread-loading, or session-mutating. Require a current note and active session.
2. Capture the ordinary/Selection target synchronously as today. Verify its source path equals the captured note path.
3. Capture `{notePath, sessionId, generation}`, the originating ready user message, active-session history, additional-note paths, mode/Web/target, and an `ActiveRequest` object before the first await.
4. Delete only that session's runtime draft. Append the ready user and loading assistant to the originating session and render them immediately.
5. Persist the user first:
   - Transient session: `createSession` with a snapshot containing only ready messages, then remove its transient marker after success.
   - Existing/legacy session: `appendReadyMessage` without `titlePrompt`; legacy migration happens in the same write.
   - If this initial save fails, show the save error, make no provider request, and leave the ready user visible as the current failed-request behavior does. The transient assistant error is not persisted.
6. Run the existing coordinator with the captured history and abort signal. Stream callbacks mutate only the originating loading message; they schedule rendering only while its request and identity remain current.
7. On successful provider completion, check abort, construct a ready assistant snapshot, and call `appendReadyMessage` with `titlePrompt: originatingUser.content`. The assistant and eligible automatic title persist atomically.
8. Only after that mutation succeeds, mark the visible loading message ready and apply returned title metadata if the identity is still current. A late successful save may finish for its originating session, but it cannot render into or rename the newly active session.
9. If the final assistant save fails, retain the answer text as a transient error-state message, show the save Notice only for the current identity, and do not update the title or ready history.
10. Stop/error/abort paths retain their current transient states and never call the assistant/title mutation.
11. In `finally`, clear the active controller/sending state and render only if the captured `ActiveRequest` is still the active object. An old request cannot clear a newer request's state.

Note/session transitions abort the active request and close Web review. UI session controls are disabled while sending, loading, or mutating; internal transition guards are still tested directly because note switches and close can race asynchronous work.

## Session controls and management flows

The title region gains a compact row below the existing Emend title/build row:

- Native `<select aria-label="Chat session">` showing session titles in manual order and the active session as its value.
- New, Rename, Delete, Move up, and Move down icon buttons using Obsidian `setIcon`, accessible labels/tooltips, and normal button keyboard behavior.
- Move up/down are the keyboard-accessible reorder mechanism; no drag-only behavior is required.
- Controls disable during sending, thread loading, or a session mutation. Stop remains available. Move controls also disable at their respective boundaries and with fewer than two sessions.

Flows:

- **New:** normally persist an empty auto-titled session and activate it in one `createSession` mutation. For a sole empty transient, persist/replace that transient and transfer its draft. For a transient with ready user messages left by a failed save, persist the current session first and then create/activate the empty session; a second-step failure leaves the recovered current session intact. Update visible state after each successful mutation. No provider call.
- **Switch:** save the current runtime draft, await `setActiveSession`, then update active state, increment generation, restore the target draft/messages, and refresh capacity. A failed mutation leaves the current session visible. A sole transient has no switch action.
- **Rename:** open a modal with the current title, trim/collapse whitespace, require 1–80 code points, and set `titleSource: 'manual'`. Persist an existing session through `renameSession`; materialize a transient through `createSession` with its ready messages. Later automatic cadence cannot change the manual title.
- **Delete:** open a confirmation modal naming the current target as plain text. Cancel performs no mutation. For a persisted session, confirm calls `deleteSession`, applies the returned next/previous/null active fallback only after success, removes the deleted draft, and creates/caches a transient `New chat` if no sessions remain. For a transient, confirm only replaces the local cached session with a fresh empty session and clears its draft/messages; no adapter operation occurs.
- **Move up/down:** call `reorderSessions` with the proposed exact ID array, apply the returned successful order locally, and keep the active ID unchanged.

Management operations use a serialized `isSessionMutating` flag in the view in addition to the store's per-note queue. Management failures produce a short non-secret Notice and do not change visible persisted session state. Local transient deletion is not a persisted mutation and therefore does not overwrite or attempt to repair malformed/future-version bytes.

## Capacity, edits, Web, and privacy preservation

- The Stage 42 meter reads only the active session's restored draft/history. Switching sessions triggers the same estimate/control refresh as a note transition without resetting same-note mode choices.
- Full-note and Selection submissions capture the originating session history; successful deterministic edit results and optional model summaries append as ordinary sanitized assistant content to that same session.
- Read-only Web warnings, citations, activity, main reasoning, and usage use the existing message serializer. No transient Web failure metadata or reader artifact is added to schema 3.
- The per-note pending-path registry is unchanged: session A blocks session B and Modify Selection for the same note; different notes remain independent.
- No new vault read, note write, provider operation, telemetry, hidden scan, or persisted draft/session-summary artifact is introduced.

## Test design

### Pure domain and schema tests

- Multiple sessions round-trip with exact order, active ID, titles/source, timestamps, messages, usage, reasoning, edit summaries, citations, and activity.
- Latest-active restore; first-in-order runtime fallback; empty aggregate.
- Automatic/manual title normalization, whitespace collapse, 80-code-point boundary, astral characters, ellipsis length, empty input, manual rejection.
- Exact-ID reorder acceptance and duplicate/missing/unknown/length mismatch rejection without writes.
- Active/inactive deletion, next/previous fallback, last-session deletion.
- Schema-3 duplicate/missing IDs, invalid active reference, invalid title/source/timestamps/sessions/messages container, and no-data-loss behavior.

### Migration and sanitization tests

- Schema 1 and 2 load as one stable legacy session with derived title/timestamps and zero writes.
- Next message, create, rename, delete, reorder, or set-active mutation writes schema 3.
- Malformed files retain original bytes on load and use one reusable `.corrupt` backup on the first valid replacement.
- Future versions reject every mutation with unchanged bytes and no adapter writes.
- Existing message sanitation remains byte/field equivalent across legacy and schema 3; transient/raw fields never persist.

### Queued mutation tests

- Queued create/append/set-active/rename/delete/reorder on one note compose from fresh state.
- Invocation-time session/message snapshots cannot be mutated by later caller changes.
- Atomic rename fallback and temp cleanup remain unchanged.
- Missing/deleted session append rejects and never resurrects the session.
- A late append for session A cannot clobber B's title, messages, order, or active state.
- Assistant+automatic-title persistence is one write; user/stopped/error/manual flows have exact title cadence and no provider call.

### View and controls tests

- New/Switch/Rename/Delete/Reorder, confirmation cancel/confirm, disabled states, boundary buttons, keyboard activation, and narrow-layout markers.
- Per-session drafts and configured provider history; no cross-session history.
- Most-recently-active reload and manual-order persistence.
- Successful/stopped/failed automatic titles and manual pinning under queued saves.
- No provider calls for management actions or naming.
- Rapid A1→A2→B→A1, close, and note-switch abort: stale loads, stream callbacks, completion, save Notices, and cleanup cannot affect the visible/new session.
- Same-note mode/Web/Edit-target and additional-note retention; active-session capacity recomputation.
- Same-note pending lock across sessions and Modify Selection; different-note independence.

### Real-Obsidian loopback matrix

Extend the ignored selection/chat verification harness with a `--sessions` suite, reusing its Obsidian launcher, CDP driver, and local mocks. Use only synthetic notes and dummy credentials.

1. Open a missing-history note: transient New chat creates no file; first Ask persists schema 3 and an automatic title after success.
2. Create/switch three sessions, preserve drafts and same-note controls, and verify actual wire history belongs only to the active session.
3. Rename manually and verify later successful responses do not change it; verify stopped/error responses leave automatic titles unchanged and management actions add zero provider requests.
4. Reorder with buttons, delete inactive/active sessions with next/previous fallback, cancel confirmation, delete the last session, and reload to verify persisted order/active state.
5. Reload actual Obsidian and restore the last active session, messages, usage, edit summary content, Web badges/citations/activity, and sanitized schema-3 bytes.
6. Load schema 1/2 fixtures without writes, then mutate to schema 3; verify malformed backup and future-version refusal for every mutation.
7. Exercise streaming Stop/retry, note-switch abort, same-note session/Modify Selection pending exclusion, and different-note independence.
8. Apply full-note and Selection edits and verify their summaries persist in the originating session with native undo/Track Changes and no unintended note writes.
9. Verify active-session capacity estimates/blocks, Web warning persistence, transient-state/raw-artifact exclusion, narrow layout, and keyboard operation.

Record Linux/CDP and unexercised platform limits honestly. No real provider/account/paid verification is claimed.

## Documentation and delivery

Update `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `QUICK_START.md`, `ROADMAP.md`, and a new `devel_docs/43-multiple-chat-sessions.md`. Document schema 3, lazy migration, controls, title cadence, request identity, per-note locks, privacy, and evidence.

The implementation sub-plan will use sequential fresh implementers and independent reviews with RED→GREEN evidence for every behavior change. Final delivery requires the clean install/test/lint/build/diff gate, real-Obsidian loopback, whole-branch review, GitHub CI, and an unmerged PR for user review.

## Decisions made by the designer

These fill gaps not explicitly settled by the issue or governing plan and remain reviewable:

- 80-code-point titles with a 79+ellipsis automatic truncation rule.
- `createdAt`/`updatedAt` field names and finite-number validation; legacy timestamps derive from messages or zero.
- Stable `legacy` ID for the single migrated legacy session.
- Empty schema-3 aggregates are valid; deleting the last session leaves a persisted empty aggregate and a runtime transient New chat.
- New from a sole empty transient replaces/persists that session and transfers its draft rather than creating an invisible second empty session; a transient with failed-save user messages is recovered before the new empty session is created.
- Transient sessions are cached per note across note switches. Rename/Submit materialize them; Delete discards only local transient state and never rewrites malformed/future-version files.
- Native single-click session selector plus icon actions instead of double-click/custom-dropdown behavior, selected by the user.
- Initial user-save failure prevents the provider request; final assistant-save failure retains answer text only as transient error-state content.
- No separate management tab, AI summaries, AI naming, or note-rename history migration.
