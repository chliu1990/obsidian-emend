# Multiple Chat Sessions per Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship multiple persisted, ordered chat sessions per note with safe legacy migration, exact-ID atomic mutations, deterministic titles, compact controls, and stale-completion protection.

**Architecture:** Add a pure session-domain module and keep one schema-3 aggregate in the existing hashed per-note file. All writes are queued read/migrate/validate/exact-ID-mutate/atomic-write operations; the chat view keys runtime state and requests by `{notePath, sessionId, generation}`. A native dropdown and icon buttons invoke session management without provider calls.

**Tech Stack:** TypeScript strict mode, Obsidian desktop API, Vitest, ESLint, esbuild, existing ignored real-Obsidian CDP/loopback harness, GitHub CLI/Actions.

**Spec:** `docs/superpowers/specs/2026-11-12-multiple-chat-sessions-design.md`

## Global Constraints

- Work in `/home/chang/Projects/obsidian-emend` on `feat/multiple-chat-sessions`; no worktrees. Use sequential fresh implementers and fresh reviewers; do not dispatch implementation agents in parallel.
- Write tests first and record observed RED→GREEN evidence for every behavior change. Preserve existing tests unless an assertion intentionally changes from schema 2 to schema 3 or from whole-thread saves to exact-ID mutations.
- Persist exactly `{version: 3, lastActiveSessionId, sessions}`. Titles are whitespace-collapsed, trimmed, nonempty, and at most 80 Unicode code points; automatic overflow is 79 code points plus `…`; default title is `New chat`.
- No AI naming, AI session summaries, hidden provider calls, background vault scans, note-rename history migration, draft persistence, or new writer path.
- Preserve ready-message sanitization, Web metadata, edit summaries, usage/reasoning, malformed `.corrupt` backup, unsupported-version refusal, hashed paths, and atomic rename/`DataAdapter.process` fallback.
- Preserve per-note pending exclusion, complete-note/complete-selection prompts, capacity guards, stale/abort/target guards, native `editor.replaceRange` undo, guarded `vault.modify`, and Track Changes as the only review UI.
- Use only ignored `test_vault/`, synthetic notes, loopback mocks, and dummy credentials for real-Obsidian verification. Never use real accounts or paid calls.
- Leave the user-provided untracked `docs/images/emend-context-bar.jpg` untouched and uncommitted. Do not commit generated bundles or vault data.
- Do not push, merge, tag, or release until the final PR publication step authorized by the user; the PR remains unmerged for review.

## Review Focus

- **Unsupported/malformed files with transient UI state:** local transient deletion must not repair or overwrite bytes; every persisted mutation must still follow backup/refusal rules. Pin in Tasks 2, 3, and 5.
- **Deleted session versus late assistant/title save:** append must reject the missing exact ID and never recreate it or alter a sibling. Pin in Tasks 3 and 4.
- **Initial/final persistence failure:** no provider request before a successful initial user save; a failed final save produces no ready assistant/history/title update and retains answer text only transiently. Pin in Task 4.
- **A1→A2→B→A1 and old-request cleanup:** stale loads/callbacks/finally blocks must not replace messages/drafts, clear a newer request, or show a Notice in the wrong session. Pin in Task 4.
- **Transient identity across note switches:** the same unsaved session, ready user messages, and draft association must be restored during the current view lifetime and discarded only on explicit local deletion or plugin reload. Pin in Tasks 4 and 5.

---

### Task 1: Pure session domain and shared message serialization

**Files:**
- Create: `src/chat-sessions.ts`
- Create: `tests/chat-sessions.test.ts`
- Modify: `src/conversation-store.ts`
- Test: `tests/conversation-store.test.ts`

**Interfaces:**
- Consumes: existing `ChatMessage` and the current private message serializers in `src/conversation-store.ts`.
- Produces:

```ts
export const CHAT_SESSION_TITLE_MAX_CODE_POINTS = 80;
export const NEW_CHAT_TITLE = 'New chat';
export type ChatSessionTitleSource = 'auto' | 'manual';
export interface ChatSession { id: string; title: string; titleSource: ChatSessionTitleSource; createdAt: number; updatedAt: number; messages: ChatMessage[] }
export interface ChatConversation { version: 3; lastActiveSessionId: string | null; sessions: ChatSession[] }
export function createChatSessionId(): string;
export function createChatSession(input: { id: string; now: number; title?: string; titleSource?: ChatSessionTitleSource; messages?: ChatMessage[] }): ChatSession;
export function deriveAutomaticTitle(prompt: string): string;
export function normalizeManualTitle(title: string): string;
export function resolveActiveSession(conversation: ChatConversation): ChatSession | null;
export function reorderChatSessions(conversation: ChatConversation, orderedIds: readonly string[]): ChatConversation;
export function deleteChatSession(conversation: ChatConversation, sessionId: string): { conversation: ChatConversation; activeSessionId: string | null };
export function legacyConversation(messages: ChatMessage[]): ChatConversation;
export function validateChatConversation(value: unknown): ChatConversation;
export function isReadyMessage(value: unknown): value is ChatMessage;
export function toPersistedMessage(message: ChatMessage): ChatMessage;
export function normalizeLoadedMessage(message: ChatMessage): ChatMessage;
```

- [ ] **Step 1: Write failing domain tests**

Cover: 79/80/81-code-point automatic titles, astral characters, whitespace collapse, empty automatic title, manual empty/over-80 rejection; default/new/manual session construction; first-in-order active fallback; exact-ID reorder acceptance and duplicate/missing/unknown/length mismatch rejection; active delete next/previous fallback, inactive delete preservation, and last delete to null; legacy title/timestamps including empty and negative finite message timestamps; schema-3 round-trip and duplicate/missing ID, invalid active reference, invalid title/source/timestamp/container rejection.

Example assertion:

```ts
expect(Array.from(deriveAutomaticTitle(` ${'😀'.repeat(81)} `))).toHaveLength(80);
expect(deriveAutomaticTitle('  First\n question  ')).toBe('First question');
```

- [ ] **Step 2: Verify domain RED**

Run: `npm test -- tests/chat-sessions.test.ts`
Expected: FAIL because `src/chat-sessions.ts` and its exports do not exist. Record the command and error.

- [ ] **Step 3: Implement the pure domain**

Use `Array.from` for code-point counts/slices and `/\s+/gu` for whitespace collapse. `createChatSessionId` uses `crypto.randomUUID()`. Pure mutations return new aggregate/session objects and preserve caller input. `legacyConversation` uses ID `legacy`, first ready user prompt for its auto title, min/max message timestamps or zero, and `lastActiveSessionId: 'legacy'`.

- [ ] **Step 4: Move shared message serialization without behavior changes**

Move the existing ready-message predicate, persisted-message allowlist, loaded-message normalization, usage/source handling, and Web citation/activity sanitizers to `chat-sessions.ts`; import them in `conversation-store.ts`. Do not duplicate the logic or make `chat-sessions.ts` import the store.

- [ ] **Step 5: Verify domain GREEN and legacy serializer equivalence**

Run: `npm test -- tests/chat-sessions.test.ts tests/conversation-store.test.ts`
Expected: PASS; existing schema-1/2 message, citation, activity, usage, reasoning, summary-content, and transient-field assertions remain unchanged.

- [ ] **Step 6: Typecheck, lint, and commit**

Run: `npm test && npx tsc -noEmit -skipLibCheck && npx eslint src/chat-sessions.ts src/conversation-store.ts tests/chat-sessions.test.ts tests/conversation-store.test.ts && git diff --check`
Expected: PASS. Commit as `feat: add chat session domain`.

---

### Task 2: Schema-3 loading and lazy legacy migration

**Files:**
- Modify: `src/conversation-store.ts`
- Modify: `src/chat-view.ts` only to consume the compatibility loader if required
- Test: `tests/conversation-store.test.ts`
- Test: `tests/chat-view.test.ts` only for loader compatibility

**Interfaces:**
- Consumes: Task 1 domain/serializer functions.
- Produces:

```ts
export const CONVERSATION_SCHEMA_VERSION = 3;
export type ConversationLoadKind = 'schema3' | 'legacy' | 'missing' | 'malformed' | 'unsupported';
export interface LoadedChatConversation { kind: ConversationLoadKind; conversation: ChatConversation }
loadConversation(notePath: string): Promise<LoadedChatConversation>;
```

Retain temporary `load(notePath): Promise<ChatMessage[]>` and `save(notePath, messages): Promise<void>` wrappers for current callers until Task 4. The loader wrapper returns the active session's messages; the save wrapper writes schema 3 through one internal compatibility mutation and is removed with its callers in Task 4.

- [ ] **Step 1: Write failing load/migration tests**

For missing, schema 1, schema 2, schema 3, malformed, and future-version inputs assert exact `kind`, aggregate, active session, and zero load writes. Schema 1/2 return one stable `legacy` session with derived metadata. Schema 3 restores its exact active ID/order/messages. Malformed/future preserve bytes and existing warnings. The next compatibility save or valid mutation writes schema 3; malformed replacement writes one reusable `.corrupt`; future mutation rejects unchanged.

- [ ] **Step 2: Verify loader RED**

Run: `npm test -- tests/conversation-store.test.ts`
Expected: FAIL because `loadConversation` and schema-3 inspection/migration do not exist. Record actual output.

- [ ] **Step 3: Implement inspection and lazy loading**

Parse `unknown`; accept numeric versions 1/2 as legacy, 3 through `validateChatConversation`, and other versions as unsupported. Missing/malformed/unsupported loads return `{version: 3, lastActiveSessionId: null, sessions: []}` without writing. Wait for the note's queued writes as today.

- [ ] **Step 4: Route compatibility writes through schema 3**

Keep the existing path hashing, queue, backup, temp/rename/process behavior. Update only intentional schema assertions and current-view loader glue. Do not add the full exact-ID mutation surface yet.

- [ ] **Step 5: Verify migration GREEN and current chat compatibility**

Run: `npm test -- tests/conversation-store.test.ts tests/chat-view.test.ts tests/main.test.ts`
Expected: PASS; opening legacy/current chats still renders their messages and no load causes a write.

- [ ] **Step 6: Typecheck, lint, and commit**

Run: `npm test && npx tsc -noEmit -skipLibCheck && npx eslint src/conversation-store.ts src/chat-view.ts tests/conversation-store.test.ts tests/chat-view.test.ts && git diff --check`
Expected: PASS. Commit as `feat: load schema 3 chat conversations`.

---

### Task 3: Exact-ID queued atomic mutations and title cadence

**Files:**
- Modify: `src/conversation-store.ts`
- Create: `tests/conversation-session-mutations.test.ts`
- Modify: `tests/conversation-store.test.ts`

**Interfaces:**
- Consumes: `loadConversation`, Task 1 helpers, existing per-note queue/atomic writer.
- Produces the final mutation surface:

```ts
createSession(notePath: string, session: ChatSession, options?: { activate?: boolean }): Promise<ChatSession>;
appendReadyMessage(notePath: string, sessionId: string, message: ChatMessage, options?: { titlePrompt?: string; now?: number }): Promise<ChatSession>;
setActiveSession(notePath: string, sessionId: string): Promise<void>;
renameSession(notePath: string, sessionId: string, title: string, options?: { now?: number }): Promise<ChatSession>;
deleteSession(notePath: string, sessionId: string): Promise<{ activeSessionId: string | null }>;
reorderSessions(notePath: string, orderedIds: readonly string[]): Promise<void>;
```

- [ ] **Step 1: Write failing mutation tests**

Test create with activate true/false and duplicate rejection; append ready user/assistant and non-ready/missing-session rejection; set-active; manual rename; active/inactive delete fallback; exact reorder; invocation-time snapshots; queued create/append/rename/reorder/set-active/delete composition; atomic rename fallback/temp cleanup.

- [ ] **Step 2: Add failing race and title-cadence tests**

Use a deferred adapter write to queue an append for A behind a delete of A and metadata changes for B. Assert A is not resurrected and B's title/messages/order/active state survive. Assert one atomic assistant+auto-title write from the captured user prompt, no title change on user-only/manual flows, no separate late title write, and no provider dependency.

- [ ] **Step 3: Verify mutation RED**

Run: `npm test -- tests/conversation-session-mutations.test.ts`
Expected: FAIL because the exact-ID methods do not exist. Record actual output.

- [ ] **Step 4: Implement one shared queued mutation pipeline**

Each operation synchronously snapshots/sanitizes arguments, then queues read → inspect/migrate → validate → exact-ID mutate → atomic write. Return persisted snapshots. Missing IDs reject before any write. `titlePrompt` is honored only for a ready assistant in an `auto` session; assistant append/title/`updatedAt` share one mutation. Set-active/reorder do not change `updatedAt`.

- [ ] **Step 5: Verify mutation GREEN and all persistence suites**

Run: `npm test -- tests/conversation-session-mutations.test.ts tests/conversation-store.test.ts tests/chat-sessions.test.ts`
Expected: PASS, including unsupported rejection for every new method and malformed backup only on valid replacement.

- [ ] **Step 6: Typecheck, lint, and commit**

Run: `npm test && npx tsc -noEmit -skipLibCheck && npx eslint src/conversation-store.ts tests/conversation-session-mutations.test.ts tests/conversation-store.test.ts && git diff --check`
Expected: PASS. Commit as `feat: persist chat sessions by exact ID`.

---

### Task 4: Session-scoped chat runtime and stale-request guards

**Files:**
- Modify: `src/chat-view.ts`
- Modify: `src/conversation-store.ts` to remove compatibility `load`/`save` after callers migrate
- Modify: `tests/chat-view.test.ts`
- Modify: `tests/main.test.ts`
- Modify: `tests/request-isolation.test.ts`
- Modify: `tests/conversation-store.test.ts`

**Interfaces:**
- Consumes: Task 2 `loadConversation` and Task 3 mutation methods.
- Produces:

```ts
interface ChatIdentity { notePath: string; sessionId: string; generation: number }
interface ActiveRequest { identity: ChatIdentity; controller: AbortController; loadingMessage: ChatMessage }
switchActiveSession(sessionId: string): Promise<void>;
```

`switchActiveSession` awaits `setActiveSession`, then increments the generation and activates/restores the exact target session; Task 5 wires it to the selector. View state uses `sessions`, `activeSessionId`, `conversationGeneration`, `activeRequest`, `isSessionMutating`, `transientSessionIds`, `transientSessions`, and nested `drafts: Map<string, Map<string, string>>`. `this.messages` references the active session's messages.

- [ ] **Step 1: Write failing active-session runtime tests**

Cover latest-active load, empty transient creation without writes, per-session draft restore, active-only configured history, same-note mode/Web/Edit-target and additional-note retention, note-change Edit-target reset, and capacity recomputation from active draft/history. Verify transient ID/messages/draft association survives A→B→A during the current view lifetime.

- [ ] **Step 2: Write failing submission/race tests**

Cover transient create-then-assistant append; legacy append/migration; initial save failure → zero provider calls; successful assistant+title atomic save; final save failure → transient error-state answer and no ready history/title; stopped/error responses → no assistant/title save. Add rapid A1→A2→B→A1, close, note-switch abort, stale stream/render/Notice, and old-`finally` versus new-request tests.

- [ ] **Step 3: Verify runtime RED**

Run: `npm test -- tests/chat-view.test.ts tests/main.test.ts tests/request-isolation.test.ts`
Expected: FAIL on missing session identity, transient persistence, nested drafts, and request-generation behavior. Record actual output.

- [ ] **Step 4: Implement session runtime and identity guards**

Load aggregates and use a cached transient for empty kinds. Key drafts by note/session. Capture identity and `ActiveRequest` before awaits; abort/close Web review on transitions. Check exact identity plus request object before stream rendering and cleanup. Keep the existing per-note pending lock unchanged.

- [ ] **Step 5: Implement the two-save submission cadence**

Persist the ready user before networking, creating a transient or appending to an existing/legacy session. On success append the ready assistant with `titlePrompt` from the captured user. Update visible ready/title state only after successful final persistence; on final save failure preserve answer text as error-state transient content. Remove old whole-thread persistence and compatibility store wrappers.

- [ ] **Step 6: Verify runtime GREEN and integration suites**

Run: `npm test -- tests/chat-view.test.ts tests/main.test.ts tests/request-isolation.test.ts tests/conversation-store.test.ts tests/conversation-session-mutations.test.ts tests/context-capacity-ui.test.ts tests/quick-actions.test.ts`
Expected: PASS; no cross-session history, stale render/cleanup, or pending-lock regression.

- [ ] **Step 7: Typecheck, lint, and commit**

Run: `npm test && npx tsc -noEmit -skipLibCheck && npx eslint src/chat-view.ts src/conversation-store.ts tests/chat-view.test.ts tests/main.test.ts tests/request-isolation.test.ts tests/conversation-store.test.ts && git diff --check`
Expected: PASS. Commit as `feat: scope chat runtime to sessions`.

---

### Task 5: Title-region session controls and management flows

**Files:**
- Create: `src/chat-session-controls.ts`
- Create: `tests/chat-session-controls.test.ts`
- Modify: `src/chat-view.ts`
- Modify: `styles.css`
- Modify: `tests/chat-view.test.ts`
- Modify: `tests/mocks/obsidian.ts` only if the existing Modal/button shim lacks required behavior

**Interfaces:**
- Consumes: Task 3 management mutations and Task 4 `switchActiveSession(sessionId)`/runtime identity/drafts/transient cache.
- Produces:

```ts
interface ChatSessionControlsState { sessions: readonly ChatSession[]; activeSessionId: string | null; disabled: boolean }
interface ChatSessionControlsCallbacks { onNew(): void; onSwitch(sessionId: string): void; onRename(title: string): void; onDelete(): void; onMove(direction: -1 | 1): void }
class ChatSessionControls {
	constructor(container: HTMLElement, callbacks: ChatSessionControlsCallbacks);
	render(state: ChatSessionControlsState): void;
	destroy(): void;
}
createNewSession(): Promise<void>;
renameActiveSession(title: string): Promise<void>;
deleteActiveSession(): Promise<void>;
moveActiveSession(direction: -1 | 1): Promise<void>;
```

The component owns rename validation and delete confirmation, emitting `onRename` only with valid normalized text and `onDelete` only after confirmation. It does not access the store/provider directly.

- [ ] **Step 1: Write failing component tests**

Assert native `<select aria-label="Chat session">`, manual option order/active value, New/Rename/Delete/Move up/Move down accessible buttons, boundary/disabled states, callback IDs/directions, keyboard activation, rename validation, delete confirmation cancel/confirm, and cleanup. No callback performs a provider request.

- [ ] **Step 2: Write failing view-management tests**

Cover New persisted empty session; Switch set-active then generation/draft/history/capacity refresh; Rename manual pinning; Delete next/previous/last fallback and draft removal; Move order persistence; disabled mutations while sending/loading/mutating; failed mutation leaves visible state unchanged. Cover transient New with and without failed-save ready users, transient Rename materialization, transient Delete with zero adapter writes, and unsupported/malformed transient deletion preserving bytes.

- [ ] **Step 3: Verify controls RED**

Run: `npm test -- tests/chat-session-controls.test.ts tests/chat-view.test.ts`
Expected: FAIL because the component and management actions do not exist. Record actual output.

- [ ] **Step 4: Implement the component and Obsidian modals**

Use `setIcon`, native buttons/select, plain text for titles, and Obsidian `Modal` for rename/delete. Manual titles use `normalizeManualTitle`; rename/delete contain no model content or `innerHTML`. Controls disable during sending/loading/mutating; Stop remains available.

- [ ] **Step 5: Implement view flows and narrow-layout CSS**

Serialize management through `isSessionMutating`; apply visible state only after successful store results. Implement the transient rules exactly as specified. Place the row below the existing title/build row and add `emend-` classes with wrapping/no horizontal overflow at the existing 400px breakpoint.

- [ ] **Step 6: Verify controls GREEN and related UI suites**

Run: `npm test -- tests/chat-session-controls.test.ts tests/chat-view.test.ts tests/main.test.ts tests/request-isolation.test.ts tests/context-capacity-ui.test.ts tests/quick-actions.test.ts`
Expected: PASS; management/naming adds no provider calls and same-note request exclusion remains intact.

- [ ] **Step 7: Typecheck, lint, and commit**

Run: `npm test && npx tsc -noEmit -skipLibCheck && npx eslint src/chat-session-controls.ts src/chat-view.ts tests/chat-session-controls.test.ts tests/chat-view.test.ts && git diff --check`
Expected: PASS. Commit as `feat: add chat session controls`.

---

### Task 6: Real-Obsidian verification, documentation, and final review

**Files:**
- Modify: `test_vault/emend-selection-chat-verify/verify.mjs` (ignored harness only)
- Create: `devel_docs/43-multiple-chat-sessions.md`
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `README.md`
- Modify: `QUICK_START.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: complete session runtime/store/controls from Tasks 1–5.
- Produces: reproducible Stage 43 loopback evidence, current-behavior documentation, and a reviewable PR.

- [ ] **Step 1: Add the ignored `--sessions` loopback suite**

Reuse the existing Obsidian launcher/CDP/local mock infrastructure. Implement the nine scenarios in the approved spec: missing/transient first Ask; three-session drafts/history; manual/auto/stopped/error titles; reorder/delete/reload; actual reload and sanitized restore; schema 1/2/malformed/future matrix; Stop/retry/abort/pending locks; full-note/Selection edit summaries/native undo; capacity/Web/transient/privacy/narrow/keyboard behavior. Assert zero management provider calls and zero unintended note writes.

- [ ] **Step 2: Build and run real-Obsidian verification**

Run: `npm run build && node test_vault/emend-selection-chat-verify/verify.mjs --sessions && sha256sum main.js`
Expected: all session scenarios/assertions PASS; loaded bundle hash matches root `main.js`. Record exact counts/hash and Linux/CDP/platform limitations. Fix only confirmed product defects with their own RED→GREEN unit tests before rerunning.

- [ ] **Step 3: Write Stage 43 and current-behavior documentation**

Document exact schema, empty/legacy/transient semantics, controls, title cadence, store API, generation/request guards, per-note locks, privacy, deferred AI summaries/note-rename migration, test counts, loopback evidence, and real-provider limitations. Update all six listed current guides consistently; do not change release metadata or `CHANGELOG.md`.

- [ ] **Step 4: Run the complete clean gate**

Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`
Expected: clean install succeeds; all tests, ESLint, strict TypeScript, production build, and diff check PASS. Record dependency advisories without unrelated audit fixes.

- [ ] **Step 5: Commit verification and documentation**

Commit the tracked documentation as `docs: record multiple chat sessions`. Confirm `git status --short --branch` shows only the pre-existing untracked context-bar image; do not add ignored harness output, bundles, vault data, or the image.

- [ ] **Step 6: Complete independent final review and one fix wave**

Generate the whole-branch review package from merged base `c6c0d7c902aca87ced04cfbc719ead91957178bb` to final HEAD. Require persistence/race/security/spec and code-quality verdicts. Resolve every Critical/Important finding, rerun affected tests plus the full gate/loopback after product fixes, and obtain scoped re-review.

- [ ] **Step 7: Publish the PR and verify CI**

With the user's existing PR4 publication authorization, push `feat/multiple-chat-sessions`, open a PR against `main` titled `Multiple chat sessions per note`, and include schema/migration/control/race summaries plus exact gate/loopback evidence and limitations. Wait for both push and pull-request CI runs to pass. Leave the PR unmerged for user review; do not tag or start the release.
