# Emend 2.11.0 PR 05 Modification Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract only the Edit submission and concise-result interaction from `chat-view.ts` into a focused `ModificationController`, preserving every current Chat/Edit, targeting, persistence, streaming, Web, correction, freshness, and writer behavior while leaving issue #76 open for the other chat-view state machines.

**Architecture:** A stateless, request-scoped `ModificationController` receives the already captured Full-note or Selection target after the initial ready-user save. It owns only Edit reasoning/retry callback forwarding, dispatch to the existing plugin request methods, and applied/no-op result formatting. `EmendChatView` retains synchronous capture, capacity preflight, request identity, messages, drafts, sessions, persistence, abort/stale handling, DOM rendering, Chat streaming, and Web Review/Auto; the existing coordinators, correction loop, freshness guard, and two writers remain unchanged.

**Tech Stack:** Strict TypeScript, Obsidian 1.11.4+ desktop APIs, Vitest 4 with the real `EmendChatView` public fixture, ESLint, esbuild/CommonJS for ES2021, and the ignored real-Obsidian Linux/Xvfb loopback harness with Track Changes. No new dependency.

**Spec:** Approved global plan `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, Global Constraints and PR 05 row only; [Issue #76](https://github.com/chliu1990/obsidian-emend/issues/76); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `ROADMAP.md`; Stages 54–57; current source and tests at base `9a637f54e04090d88bbb55a19b63696fbb8ee71c`.

## Global Constraints

- Work only on branch `feature/2.11-pr05-modification-controller` in `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr05-modification-controller`, based on `9a637f54e04090d88bbb55a19b63696fbb8ee71c`. The clean baseline is 56 test files and 2,050 passing tests after `npm ci`.
- Keep plugin ID `emend`, view type `emend-chat-view`, existing `emend:` command IDs, and all released version metadata unchanged.
- This is a behavior-preserving extraction, not a whole-file rewrite. Do not bundle PR 06 actionable in-token diagnostics, attributed CriticMarkup, table/list/blockquote enablement, pending-card merging, images, Mermaid, or any other later feature.
- Chat, Chat Selection, Web Review/Auto, Related Notes, and session/model controls remain writer-free. Full-note Edit alone may call guarded `vault.modify`; Selection Edit and Modify Selection may call only native `editor.replaceRange` on the captured range.
- Preserve the maintained `EditTargetState` and one-time synchronous `CapturedDraftTarget` capture before the initial save. Never recapture target, Selection, additional-note paths, or history after an await.
- Operations remain the only model-facing edit protocol. Candidate-validation failure retains exactly one same-provider correction with bounded private diagnostics; provider, abort, stale, capacity, permission, read, and write failures receive none.
- Preserve same-note request serialization across sessions and Modify Selection, independent-note concurrency, ready-only originating-session history, schema-3 persistence, capacity checks at preflight and every fetch, and note/session/generation/abort/target guards.
- Persist only concise applied/no-op results, optional validated summaries, successful-attempt reasoning, and all-round usage. Raw candidates, Operations, rejected-attempt reasoning, correction diagnostics, request snapshots, and full annotated responses remain private.
- Track Changes remains the separate companion and only review surface. Add no diff, Apply/Reject UI, automatic installation, second writer, shared write executor, or new review abstraction.
- New and migrated chat-view behavior tests must construct real `EmendChatView` instances through `tests/helpers/chat-view-public-fixture.ts` and use public lifecycle, submission, session, target, and refresh methods with DOM/provider/store observations. Do not add view-prototype access, private-field casts, hand-built public-view contexts, or test-only production accessors.
- Use focused modules and existing TypeScript style: tabs, single quotes, semicolons, trailing commas, and `async`/`await`. Add no runtime dependency, background request, telemetry, provider stack, or unbundled module.
- Update `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, and add Stage 58. Do not rewrite historical stages or user behavior guides when behavior is unchanged.
- Every task uses one fresh sequential implementer, a fresh independent reviewer with both spec-compliance and quality verdicts, a commit, and a clean review gate before the next task. Resume the same implementer for review fixes and rerun affected verification.
- Manual verification uses only this worktree’s ignored `test_vault/`, synthetic notes, loopback OpenAI-compatible/SSE mocks, CORS, and dummy credentials. Never use real accounts, paid calls, private notes, personal paths, or other vaults.
- Final whole-PR review must include code quality, spec compliance, and write/security/privacy review. Submit the PR and stop at the human gate; never merge, tag, publish, or start PR 06 automatically.

## Review Focus

1. **Captured-target and lifecycle races:** deferred saves, note/session switches, vanished Selections, late Edit callbacks, and old-request completion must not recapture a target, contaminate a newer request, save into the wrong session, or write. Owned by Tasks 1 and 3 public tests and Task 5 runtime scenarios.
2. **Writer routing and native undo:** Full-note must use only guarded `vault.modify`; Selection must use only the captured native adapter and exact offsets, including full-note supporting context and quick actions. Owned by Tasks 1–3 and Task 5.
3. **Abort, correction, and committed-save races:** one correction remains bounded, Stop before an uncommitted result prevents persistence, and an already applied edit still saves its concise ready result when Stop or a save failure races completion. Owned by Tasks 1–3 and Task 5.
4. **Privacy and concise persistence:** rejected reasoning, raw Operations, diagnostics, snapshots, and full annotated text must not reach rendered ready messages, later history, or saved aggregates. Owned by Tasks 1–3 and Task 5 request/save audits.
5. **Unrelated state-machine isolation:** sessions, drafts, capacity, streaming render/scroll generations, Chat Selection, Web drafts/review, quick actions, and same-note locks must behave exactly as before and must not move into the new controller. Owned by Tasks 1 and 3, unchanged regression suites, and Task 5’s focused plus inherited runtime groups.

## Current Source Map and Exact Extraction Boundary

### Current `chat-view.ts` ownership

| Current location | Behavior | PR 05 decision |
| --- | --- | --- |
| `src/chat-view.ts:1642-1659` | `submitQuickAction` checks pending state and capacity, preserves the typed draft, selects the action mode, and calls `submitPrompt(..., { fromQuickAction: true })`. | Retain in the view. Quick actions subsequently use the new controller through the common Edit branch. |
| `src/chat-view.ts:1661-1764` | `submitPrompt` validates idle/session state; synchronously captures Full-note, Selection, Chat, or Chat Selection context; checks source path; freezes additional-note paths and ready history; performs capacity preflight; creates `ChatIdentity`. | Retain unchanged except for moving the Edit variants’ shared type to the new module. |
| `src/chat-view.ts:1765-1810` | Creates user/loading messages and `AbortController`; clears or preserves drafts; installs active-request state; renders; awaits initial ready-user persistence; requires the request to remain active. | Retain in the view. The controller is invoked only after these steps. |
| `src/chat-view.ts:1811-1861` | Creates Edit reasoning/retry callbacks; chooses `requestSelectionEdit` or Edit-mode `requestChatCompletion`; computes summary source/offset; stores `applied`; formats applied/no-op content and usage. | **Extract this block** into `ModificationController`. |
| `src/chat-view.ts:1862-1927` | Chat and Chat Selection streaming, provisional Web drafts, Web Review/Auto configuration, activities, sources, and incompleteness warnings. | Retain in the view; never call the controller. |
| `src/chat-view.ts:1928-2000` | Uncommitted abort check, ready-assistant save, `allowAbortedSave` for committed edits, error/stopped/save-failure handling, active-request-owned cleanup, and completion render generation. | Retain in the view. `committedEdit` is assigned from `ModificationResult.applied`. |
| `src/chat-view.ts:2003-2039` | Web tool Review modal and abort behavior. | Retain in the view. |
| `src/chat-view.ts:2041-2101` | Ready-message persistence, metadata application, and provider-history projection. | Retain in the view. |

### Paths that must remain distinct

- **Full-note Edit:** view captures `RequestContext`; controller calls `plugin.requestChatCompletion` with an `EditSubmission`; `main.ts` still uses `EditRequestCoordinator`; `note-writer.ts` remains the only guarded vault-write path.
- **Selection Edit:** view captures `SelectionEditTarget`; controller calls `plugin.requestSelectionEdit` with the exact snapshot, editor adapter, history, additional-note paths, callbacks, and Selection context policy; `selection-editor.ts` retains composed-note validation, freshness, and native replacement.
- **Modify Selection command palette:** `main.ts` captures and calls `requestSelectionEdit` directly through `SelectionModal`; it does not pass through `EmendChatView` or the new controller.
- **Edit quick actions:** remain view-controlled capacity/draft interactions, then enter `submitPrompt` and the new controller exactly like typed Edit prompts.
- **Web Review/Auto:** remain Chat-only view behavior. Edit submissions continue forcing `webSearchMode: 'off'`; no Web option or callback enters the controller API.
- **Chat and Chat Selection:** remain in the existing read-only branch with their streaming and Web callbacks.

## Chosen Controller Design

Create `src/modification-controller.ts` with these exact public types:

```ts
export type ModificationTarget =
	| {
		readonly type: 'full-note';
		readonly mode: 'edit';
		readonly context: RequestContext;
	}
	| {
		readonly type: 'selection';
		readonly mode: 'edit';
		readonly target: SelectionEditTarget;
		readonly selectionContext: SelectionContextPolicy;
	};

export interface ModificationStreamCallbacks {
	onReasoning(text: string): void;
	onRetry(): void;
}

export interface ModificationSubmission {
	readonly target: ModificationTarget;
	readonly prompt: string;
	readonly history: ProviderHistoryMessage[];
	readonly additionalNotePaths: readonly string[];
	readonly signal: AbortSignal;
	readonly callbacks: ModificationStreamCallbacks;
}

export interface ModificationResult {
	readonly applied: boolean;
	readonly content: string;
	readonly usage: TokenUsage;
}

export interface ModificationControllerDependencies {
	requestFullNoteEdit(submission: EditSubmission): Promise<EditRequestResult>;
	requestSelectionEdit(
		snapshot: SelectionSnapshot,
		prompt: string,
		signal: AbortSignal,
		editor: SelectionEditorAdapter,
		additionalNotePaths: readonly string[],
		history: ProviderHistoryMessage[],
		callbacks: SelectionEditCallbacks,
		selectionContext: SelectionContextPolicy,
	): Promise<SelectionEditResult>;
}

export class ModificationController {
	constructor(dependencies: ModificationControllerDependencies);
	async submit(submission: ModificationSubmission): Promise<ModificationResult>;
}
```

`chat-view.ts` changes its local `CapturedDraftTarget` union to reuse `ModificationTarget` for the two Edit variants. Its read-only variants remain local. `toDraftCapacityTarget` and capacity calculations continue consuming the same discriminated shapes.

For each Edit request, the view constructs a fresh controller with two arrow-function dependencies:

- `requestFullNoteEdit` delegates to `this.plugin.requestChatCompletion(submission)`.
- `requestSelectionEdit` delegates to `this.plugin.requestSelectionEdit(...)` with the same eight positional arguments used today.

The controller:

1. Creates no request, session, DOM, Web, persistence, or writer state.
2. Forwards the supplied callbacks without adding abort or correction policy.
3. Calls exactly one dependency selected by `submission.target.type`.
4. Uses `formatEditSummary` for an applied result and `formatNoChangeSummary` otherwise.
5. Uses `context.sourceText` and offset `0` for Full-note, or `target.snapshot.fullText` and `target.snapshot.from` for Selection.
6. Returns only `{ applied, content, usage }`.
7. Propagates all dependency errors unchanged so the view’s existing catch/finally behavior remains authoritative.

The view then performs the existing assignments:

- `committedEdit = result.applied`;
- `loadingMessage.content = result.content`;
- `loadingMessage.usage = result.usage`.

### Ownership and dependency rules

- `modification-controller.ts` may import types from `context.ts`, `request-coordinator.ts`, `selection-editor.ts`, `selection-focus.ts`, `token-usage.ts`, and `types.ts`, plus the pure formatters in `edit-summary.ts`.
- It must not import `chat-view.ts`, `main.ts`, Obsidian UI APIs, `Notice`, `ActiveRequest`, `ChatIdentity`, `ChatMessage`, Web modules, persistence, freshness, or a writer.
- `chat-view.ts` imports the controller; no runtime dependency points back to the view or plugin, avoiding a circular dependency.
- `edit-response.ts` retains the two-round correction loop. `request-coordinator.ts` and `selection-editor.ts` retain provider/coordinator behavior. `edit-freshness.ts`, `note-writer.ts`, and native Selection application remain untouched.
- The controller is request-scoped and stateless. It has no `onOpen`, `onClose`, abort method, timer, event registration, or cleanup requirement.

### Rejected alternatives

- **A view-lifetime controller holding `ActiveRequest` and messages:** rejected because it would move request/session identity into the new module, broaden the refactor, and create close/stale cleanup risks.
- **A controller owning all of `submitPrompt`:** rejected because Chat, Web, capacity, persistence, and rendering are separate issue #76 state machines and are explicitly outside PR 05.
- **A shared edit/write executor:** rejected because coordinator dispatch and concise formatting are the actual common interaction; writer ordering must remain in the existing guarded modules.
- **Injecting the entire `EmendPlugin`:** rejected in favor of two narrow function dependencies, which avoid runtime cycles and make accidental Chat/Web routing visible in tests.

## Explicit Non-Goals

- No extraction of session/thread lifecycle, request/abort identity, streaming render/scroll generations, composer draft/capacity, Web draft/review state, or control synchronization.
- No changes to `request-coordinator.ts`, `selection-editor.ts`, `edit-response.ts`, `edit-summary.ts`, `edit-target.ts`, `edit-freshness.ts`, `note-writer.ts`, Operations, diagnostics, prompts, styles, settings, providers, persistence schema, or version metadata.
- No migration of unrelated legacy tests and no weakening of `tests/request-isolation.test.ts`; its real coordinator lock, writer, stale, abort, and correction coverage remains unchanged.
- No user-guide rewrite because no user behavior changes.
- No committed runtime harness, evidence, generated bundle, vault content, local settings, or credentials.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-11-24-emend-2-11-pr05-modification-controller.md` | Create | This focused plan. |
| `src/modification-controller.ts` | Create | Request-scoped Edit dispatch and concise-result formatting only. |
| `src/chat-view.ts:43,156-165,1811-1861` | Modify narrowly | Reuse the Edit target type and delegate only the current Edit branch. |
| `tests/modification-controller.test.ts` | Create | Direct dependency-routing, formatting, callback, and error-propagation tests. |
| `tests/chat-view-public.test.ts` | Modify | Receive 12 legacy modification cases and add delegation/race/Web-isolation coverage through the public view seam. |
| `tests/chat-view.test.ts:2545-2754,6478-6594` | Modify narrowly | Remove only migrated cases; leave unrelated read-only and legacy coverage intact. |
| `tests/request-isolation.test.ts` | Regression only | Preserve real same-note serialization, independent-note, writer, correction, stale, and abort evidence without retrofit changes. |
| `AGENTS.md` | Modify | Record the controller boundary and unchanged writer/request invariants. |
| `IMPLEMENTATION_PLAN.md` | Modify | Update architecture ownership and add Stage 58 to the index. |
| `ROADMAP.md` | Modify | Record the partial #76 extraction and precise remaining deferral. |
| `devel_docs/58-modification-controller.md` | Create | Record design, migration inventory, RED/GREEN evidence, verification, reviews, and remaining #76 scope. |
| `test_vault/emend-selection-chat-verify/verify.mjs` | Ignored local only | Add and run focused `--modification-controller` scenarios plus inherited groups. |
| `test_vault/emend-selection-chat-verify/mock-provider.mjs` | Ignored local only if needed | Add deterministic held/invalid/valid/Web responses for focused scenarios. |

---

### Task 1: Migrate Modification Characterization to the Public View Seam

**Files:**
- Modify: `tests/chat-view-public.test.ts`
- Modify: `tests/chat-view.test.ts:2545-2754,6478-6594`
- Use unchanged: `tests/helpers/chat-view-public-fixture.ts`
- Regression only: `tests/request-isolation.test.ts`

**Interfaces:**
- Consumes the existing `createPublicChatViewFixture`, public `EmendChatView.onOpen/onClose/submitPrompt`, public Writing menu, session loading, deferred values, rendered DOM, and provider/conversation-store doubles.
- Produces no production interface or behavior change.

- [ ] **Step 1: Add the 12 public characterization cases on unchanged production**

Migrate these exact cases without changing their assertions:

1. `keeps full-note Selection context on the native selection writer only`
   - Choose `Edit · Selection · Full note` through the public menu.
   - Assert Selection request argument 7 is `'full-note'`, Full-note Chat completion and Full-note context capture are not called, and the user message mode is `edit`.
2. `sends the same captured ready history as full-note and read-only requests`
   - Load one ready user/assistant pair and assert the Selection request receives exactly that originating-session history with `user` and `model` origins.
3. `adds the Selection start offset once to note-absolute summary lines`
   - Use the multiline source and Selection from the legacy case; assert the exact persisted/rendered `- Replaced lines 2–3.` summary.
4. `keeps the exact no-op text when a non-applied result carries summary items`
   - Assert content is exactly `No changes were needed.` with no bullet despite non-applied summary items.
5. `renders the Selection target and model summary as persisted plain content`
   - Assert the exact target/model-summary/bullet content and that no separate `summary` property is persisted.
6. `renders a no-op summary after the exact no-op sentence`
   - Assert exact `No changes were needed.\n\nReviewed without changing the selection.` in the message and save.
7. `settles a %s failure and permits a selection retry without fallback`
   - Keep the `provider`, `validation`, and `stale` rows.
   - Assert exact error content/status, no Full-note fallback, no persisted error, idle controls after failure, and a successful second Selection submission.
8. `uses the existing stopped lifecycle and excludes the partial response from saves`
   - Hold the Selection result, click the rendered Stop button, then resolve a non-applied result.
   - Assert a stopped visible assistant, no stopped/error assistant persistence, reset controls, and no late write.
9. `keeps an applied edit summary when its session was deleted during the request`
   - Reject only the assistant append with `Chat session does not exist.`
   - Assert two append attempts, exact `Emend: Edit applied, but this chat could not be saved.` Notice, and a ready concise applied result.
10. `reports a failed save after a committed edit when Stop raced completion`
   - Click Stop in a microtask as the applied Selection result settles and reject the assistant save with `Disk is full.`
   - Assert exact `Emend: Could not save this chat. Disk is full.`, ready concise content, and reset sending state.

The three parameterized failure rows count as three of the 12 cases. Drive every submission through `fixture.view.submitPrompt()` or rendered controls; do not inspect view-private messages, `activeController`, `isSending`, or persistence methods.

- [ ] **Step 2: Run the public characterization and confirm expected GREEN**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts
```

Expected: all existing and 12 migrated cases pass against unchanged production. These are characterization tests, so no artificial product failure is required.

- [ ] **Step 3: Delete only the migrated legacy cases**

Remove the 12 corresponding legacy cases and any imports used only by those cases. Retain the four read-only cases in the Selection submission block, their required legacy fixture support, and every unrelated legacy test. Do not alter `tests/request-isolation.test.ts`.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts tests/request-isolation.test.ts
npm test
npx eslint tests/chat-view-public.test.ts tests/chat-view.test.ts
git diff --check
```

Expected: all pass; the total test count is unchanged from baseline because 12 cases moved rather than being added. Confirm the public file/fixture contains no `EmendChatView.prototype`, `Object.setPrototypeOf`, `viewPrototype`, private-field cast, or hand-built view context.

- [ ] **Step 5: Commit**

```bash
git add tests/chat-view-public.test.ts tests/chat-view.test.ts
git commit -m "test: migrate modification behavior to public seam"
```

- [ ] **Step 6: Independent review gate**

A fresh reviewer checks the complete task diff for characterization fidelity, public-seam compliance, assertion preservation, and scope. Resolve every Critical/Important finding through the same implementer and scoped re-review before Task 2.

---

### Task 2: Add the Stateless Modification Controller

**Files:**
- Create: `src/modification-controller.ts`
- Create: `tests/modification-controller.test.ts`

**Interfaces:**
- Produces `ModificationTarget`, `ModificationStreamCallbacks`, `ModificationSubmission`, `ModificationResult`, `ModificationControllerDependencies`, and `ModificationController` exactly as defined above.
- Does not yet change `chat-view.ts`; Task 3 owns delegation.

- [ ] **Step 1: Write failing controller contract tests**

Add these focused tests with synthetic contexts and typed dependency doubles:

1. `routes Full-note submissions and formats the applied result`
   - Assert exact `EditSubmission` fields and object identities, no Selection call, unchanged usage, `applied: true`, and exact Full-note summary text.
2. `routes Selection submissions with the captured editor and note-absolute summary offset`
   - Assert all eight positional arguments, including the same snapshot/editor, additional paths, history, callbacks, and `'full-note'` policy.
   - Assert no Full-note call and exact Selection line numbering from `snapshot.from`.
3. `keeps the exact no-op result when non-applied summary items exist`
   - Assert `applied: false`, content exactly `No changes were needed.`, no bullet, and unchanged usage.
4. `places an optional validated summary after the no-op sentence`
   - Assert exact two-paragraph no-op content.
5. `forwards reasoning and retry callbacks without adding correction policy`
   - Have each dependency emit rejected reasoning, retry, and successful reasoning through the supplied callbacks.
   - Assert the same callbacks are forwarded in order and the controller makes exactly one dependency call; do not reimplement or test a second correction here.
6. `propagates Full-note failures without Selection fallback or result formatting`
   - Use provider, validation, stale, and abort sentinels; assert error identity, one Full-note call, zero Selection calls, and no returned result.
7. `propagates Selection failures without Full-note fallback`
   - Assert the same error identity and absence of cross-target fallback.

Use no Obsidian vault, network, writer, DOM, or persistence in this unit file.

- [ ] **Step 2: Run the tests and confirm genuine RED**

Run:

```bash
npx vitest run tests/modification-controller.test.ts
```

Expected: FAIL because `src/modification-controller.ts` does not exist.

- [ ] **Step 3: Implement the minimal controller**

Implement only the specified request-scoped dispatch and formatting. Do not add state, catches, retries, abort checks, target capture, Web handling, persistence, writer calls, or correction logic.

- [ ] **Step 4: Run focused, type, lint, and full-suite verification**

Run:

```bash
npx vitest run tests/modification-controller.test.ts
npx tsc -noEmit -skipLibCheck
npx eslint src/modification-controller.ts tests/modification-controller.test.ts
npm test
git diff --check
```

Expected: all pass. Self-review that the module has no runtime import of `chat-view.ts` or `main.ts` and no Obsidian, Web, persistence, freshness, or writer dependency.

- [ ] **Step 5: Commit**

```bash
git add src/modification-controller.ts tests/modification-controller.test.ts
git commit -m "refactor: add modification controller"
```

- [ ] **Step 6: Independent review gate**

A fresh reviewer checks spec compliance, type boundaries, error identity, privacy, and YAGNI. The reviewer must explicitly confirm the controller does not own correction, freshness, persistence, or writes.

---

### Task 3: Delegate Only the Chat-View Edit Branch

**Files:**
- Modify: `src/chat-view.ts:43,156-165,1811-1861`
- Modify: `tests/chat-view-public.test.ts`
- Regression only: `tests/modification-controller.test.ts`
- Regression only: `tests/request-isolation.test.ts`
- Regression only: `tests/edit-response.test.ts`
- Regression only: `tests/edit-summary.test.ts`

**Interfaces:**
- Consumes Task 2’s `ModificationController`, `ModificationTarget`, `ModificationSubmission`, and `ModificationResult`.
- Preserves public `EmendChatView.submitPrompt(prompt?, options?): Promise<void>` and all plugin/coordinator/writer signatures.

- [ ] **Step 1: Add failing public delegation tests**

Add tests using real public view instances. A spy may observe the new **public** `ModificationController.prototype.submit` method while calling through to its real implementation; it must not access any `EmendChatView` prototype or private field.

1. `delegates Full-note Edit with the captured context, history, additional notes, and signal`
   - Seed ready history and an additional note, submit through `submitPrompt`, and assert one controller call with a Full-note `ModificationTarget`.
   - Assert exact prompt/history/additional paths, an un-aborted signal, one Edit-mode `requestChatCompletion`, zero Selection requests, and the concise ready result in DOM and persistence.
2. `delegates Selection Edit with the captured target and Selection context policy`
   - Choose `Edit · Selection · Full note`; assert one controller call containing the exact submitted `SelectionEditTarget` and policy.
   - Assert one native Selection request, zero Full-note requests, and exact concise Selection content.
3. `keeps Chat, Chat Selection, Web Review, and Web Auto outside the modification controller`
   - Parameterize four rows: ordinary Chat, `Chat · Selection`, `Web Review`, and `Web Auto`.
   - Assert zero controller calls and zero Selection writer requests for every row.
   - Assert Chat Selection sets `chatTarget: 'selection'`; Web rows set the matching `webSearch.mode`, and Review still exposes `reviewCalls`.
   - Stream a terminal answer and assert no provisional `webDraft` flag or Edit summary is persisted.

Before the production wiring change, run only these new delegation tests. Expected RED: the two Edit delegation tests report zero controller calls. The four read-only isolation rows are expected to pass as characterizations.

- [ ] **Step 2: Add an Edit-specific stale-lifecycle characterization**

Add `isolates late Edit callbacks and non-applied completion after a note switch and newer Chat request`:

- Hold Full-note Edit A after its initial user save and capture its callbacks.
- Switch to B, assert A’s signal aborts, then complete a newer Chat request on B.
- After B is active, fire A’s retained reasoning/retry callbacks and resolve A with a non-applied result.
- Assert no stale A content/reasoning/Notice appears in B, B’s stream and cleanup remain intact, A persists only its ready user message, B persists only its own ready exchange, and no wrong-note write or late assistant save occurs.

This is expected GREEN before and after delegation; it pins the existing request guards around the new boundary. The separate committed-edit cases retain the intentional `applied: true` late-save contract.

Run this characterization before changing production:

```bash
npx vitest run tests/chat-view-public.test.ts \
	-t "isolates late Edit callbacks and non-applied completion after a note switch and newer Chat request"
```

Expected: PASS on the pre-delegation implementation.

- [ ] **Step 3: Replace only the current Edit branch**

Move the block at `src/chat-view.ts:1811-1861` into Task 2’s controller and replace it with one request-scoped controller invocation.

- Reuse `ModificationTarget` inside `CapturedDraftTarget` without changing read-only target shapes.
- Remove `formatEditSummary` and `formatNoChangeSummary` imports from the view.
- Keep the existing view callbacks that mutate `loadingMessage.reasoning` and call `scheduleRequestRender(request)`.
- Construct the controller only after the initial save and `requireActiveRequest(request)` succeed.
- Preserve `committedEdit`, loading-message assignments, the uncommitted abort check, final save, catch, and finally order exactly.
- Do not change `submitQuickAction`, capture, capacity, Chat/Web, persistence, or any other method.

- [ ] **Step 4: Run focused regression and race verification**

Run:

```bash
npx vitest run tests/modification-controller.test.ts tests/chat-view-public.test.ts \
	tests/chat-view.test.ts tests/request-isolation.test.ts \
	tests/edit-response.test.ts tests/edit-summary.test.ts
```

Expected: all pass, including both new delegation tests, the migrated 12 cases, corrected-Edit privacy, deferred-save Selection identity, Stop/save races, same-note locks, and Chat/Web isolation.

- [ ] **Step 5: Run the full local gate and inspect the production diff**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all pass. Inspect the base-to-head production diff and confirm it contains only the new controller and narrow type/import/Edit-branch changes in `chat-view.ts`; no coordinator, writer, target, freshness, scanner, provider, persistence, style, or generated-file change is present.

- [ ] **Step 6: Commit**

```bash
git add src/chat-view.ts src/modification-controller.ts \
	tests/modification-controller.test.ts tests/chat-view-public.test.ts
git commit -m "refactor: delegate chat edits to modification controller"
```

- [ ] **Step 7: Independent review gate with write/privacy lens**

A fresh reviewer checks the complete task diff for spec compliance, code quality, lifecycle races, exact writer routing, callback ownership, concise persistence, and absence of later-feature scope. Fix and re-review every Critical/Important issue before documentation.

---

### Task 4: Record the Controller Boundary and Remaining Issue #76 Scope

**Files:**
- Create: `devel_docs/58-modification-controller.md`
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Documents the Task 2 interfaces and Task 3 ownership without changing them.
- Does not modify user behavior guides or historical stage records.

- [ ] **Step 1: Update canonical architecture ownership**

In `AGENTS.md`:

- Add `modification-controller.ts` to the request-flow map as the Edit-only interaction between the view’s captured target and existing plugin request methods.
- State that it is stateless/request-scoped, owns reasoning/retry forwarding and concise result formatting, and has no target capture, request identity, Web, persistence, freshness, correction, or writer ownership.
- Retain all current target, freshness, writer, correction, privacy, and public-test rules.
- Link Stage 58.

In `IMPLEMENTATION_PLAN.md`:

- Add the controller to the current context/request architecture and Edit/review boundaries.
- Add Stage 58 to the numbered index and current status paragraph.
- Do not duplicate the full test matrix outside the stage record.

In `ROADMAP.md`:

- Add a Recently shipped row for the modification controller.
- Amend the #76 deferral to say only modification submission/review extraction landed.
- Keep #76 explicitly open for session/thread lifecycle, request/abort identity, streaming render/scroll generations, composer draft/capacity, Web draft/review state, and control synchronization.

- [ ] **Step 2: Create Stage 58 with current verified facts**

Record:

- Base, branch, behavior-preserving scope, exclusions, and chosen/rejected designs.
- Exact current-method extraction map and public interfaces.
- The 12-case public migration inventory and the deliberately unchanged read-only/request-isolation legacy coverage.
- Genuine RED from Task 2’s missing module and Task 3’s zero-delegation spy assertions; expected-GREEN characterization elsewhere.
- Focused and full gate results available through Task 3.
- The planned real-Obsidian matrix; do not claim runtime results before Task 5 executes them.
- Explicit remaining #76 scope and absence of user-facing changes.
- Evidence limits: unit tests use mocks and do not prove host bytes, native undo, real-provider behavior, physical input, screen readers, or non-Linux platforms.

- [ ] **Step 3: Run documentation and regression checks**

Run:

```bash
npm test
git diff --check
```

Perform the repository’s local one-off relative-link and anchor audit over the four changed/new documents. Expected: all tests pass, every relative link and referenced anchor resolves, no historical stage or user guide changed, and no version/workflow/generated file is modified.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md IMPLEMENTATION_PLAN.md ROADMAP.md \
	devel_docs/58-modification-controller.md
git commit -m "docs: record modification controller architecture"
```

- [ ] **Step 5: Independent factual review gate**

A fresh reviewer compares every documentation claim with current source and Stage 54–57 ownership. Require explicit verdicts that #76 remains open, no later feature is implied, and no unexecuted verification is claimed.

---

### Task 5: Real-Obsidian Verification, Final Evidence, Broad Review, and PR Submission

**Files:**
- Ignored local setup: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored local setup if needed: `test_vault/emend-selection-chat-verify/mock-provider.mjs`
- Update after the first runtime run: `devel_docs/58-modification-controller.md`
- Final exact-head evidence: ignored runtime summaries and the SDD task/final-review reports, not another recursive documentation commit.

**Interfaces:**
- Verifies the exact Task 2/3 production interfaces through actual Obsidian requests and writes.
- Preserves the established verifier’s `process.exitCode`, summary `head`, `bundleSha256`, `loadedBundleSha256`, and `loadedBundleMatchedRoot` contract.

- [ ] **Step 1: Provision the latest harness only inside this worktree**

Copy/provision the PR 04 harness from `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr04-markdown-scanner/test_vault/emend-selection-chat-verify/` into this worktree’s ignored `test_vault/emend-selection-chat-verify/`.

- Copy the current verifier, mock provider, model-control support, and required local runtime/tool prerequisites.
- Provision a fresh synthetic runtime rather than treating old evidence or saved chats as PR 05 results.
- Keep all writes inside this worktree’s ignored `test_vault/`; do not modify the PR 04 worktree.
- Use only loopback `127.0.0.1` services, synthetic notes, and the established dummy SecretStorage credential.
- Preserve the actual separately provisioned Track Changes companion; do not change Emend’s installation behavior.

Add a `--modification-controller` dispatcher group and only the deterministic mock responses it needs.

- [ ] **Step 2: Implement the focused ignored runtime scenarios**

Implement these scenario names and assertions without changing production behavior:

1. `01-full-note-correction-summary-history-privacy`
   - Return one invalid candidate and then one valid Operations candidate.
   - Assert exactly two same-provider requests, bounded private correction feedback, one guarded `vault.modify`, zero native replacements, exact CriticMarkup bytes, aggregate usage, successful-only reasoning, and the concise applied result.
   - Follow with ordinary Chat and assert history contains only the user prompt and concise result.
   - Audit requests and saved aggregate for raw candidates, Operations, rejected reasoning, diagnostics, snapshots, headers, and the dummy credential.
2. `02-selection-full-note-context-native-undo`
   - Use `Edit · Selection · Full note`.
   - Assert the request sends the complete note as supporting context, identifies only the Selection as edit target, and advertises no Web tools.
   - Assert exactly one native replacement at the captured offsets, zero guarded vault writes, exact note-absolute summary lines, unchanged outside-Selection bytes, and actual native undo/redo restoring complete original/annotated documents.
3. `03-quick-action-draft-and-capacity-preflight`
   - Submit an Edit quick action with a separate typed draft and assert the controller-backed Edit request succeeds while the typed draft remains.
   - Then make the next draft over capacity and assert no new runtime/persisted messages, provider request, save, writer call, or note-byte change.
4. `04-session-lock-note-switch-and-stale-callback-isolation`
   - Hold an Edit request on A; attempt a session switch and a second same-note request and assert both are refused while the first remains pending.
   - Switch to B, release A’s non-applied response and retained reasoning/retry callbacks after a newer B Chat request starts, and assert A aborts, B remains current, no stale DOM/save/Notice appears, no B thread receives A content, and no wrong-note or late write occurs.
5. `05-applied-stop-save-race`
   - Apply a Selection edit and click Stop as the result settles but before its final assistant save.
   - Assert native replacement has occurred exactly once, the concise assistant result persists as ready with an un-signaled committed save, usage and successful reasoning remain, controls return to Send, and native undo still restores the original bytes.
6. `06-web-review-auto-writer-free-isolation`
   - In Web Review, open the real review modal, edit proposed tool arguments, and assert the actual loopback tool request uses the edited arguments.
   - In Web Auto, assert no review pause and the terminal answer/activity/usage persists correctly.
   - Assert provisional Web content never enters copy/history/persistence, no Edit controller result appears, both writers remain untouched, and no raw tool/retrieval artifacts or credentials enter saved chats.

Run a harness-only negative control once and require nonzero exit plus a failed summary; remove it before evidence runs. Do not describe that control as a product failure.

- [ ] **Step 3: Run the pre-evidence runtime matrix**

Build and run:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Expected: every scenario passes with real process exit status `0`; each summary reports the current head and `loadedBundleMatchedRoot: true`. Diagnose harness defects separately from product regressions; never weaken assertions to obtain a pass.

The inherited groups provide actual multi-pane/disk/CRLF freshness, wrong-target, no-open-target, stale-after-correction, immediate and held-read abort, no-op, writer-free Chat/Chat Selection, session/draft/history/capacity/Web, native undo, scanner guard, and streaming reasoning coverage.

- [ ] **Step 4: Complete Stage 58 with observed evidence and commit**

Update Stage 58 with exact scenario/assertion totals, environment, provider limits, bundle identity, persistence/privacy audits, inherited-group results, and any harness-only failed attempts. Clearly label this as pre-final-documentation-head evidence.

```bash
git add devel_docs/58-modification-controller.md
git commit -m "docs: record modification controller verification"
```

- [ ] **Step 5: Run the clean full gate on the exact submitted head**

Run:

```bash
npm ci
npx vitest run tests/modification-controller.test.ts tests/chat-view-public.test.ts \
	tests/chat-view.test.ts tests/request-isolation.test.ts \
	tests/edit-response.test.ts tests/edit-summary.test.ts
npm test
npm run lint
npm run build
git diff --check
```

Expected: all pass on `git rev-parse HEAD` after the evidence commit. Confirm generated `main.js`, maps, `node_modules/`, `test_vault/`, evidence, and local settings are ignored and not committed.

- [ ] **Step 6: Repeat real-Obsidian verification on that exact head**

Rebuild if necessary and rerun every command from Step 3. Preserve final ignored summaries under a distinct `evidence-pr05-final/` directory.

For every group, require:

- `summary.head === git rev-parse HEAD`;
- zero failed scenarios and process exit `0`;
- equal independently computed root and loaded `main.js` SHA-256 values;
- setup and final `loadedBundleMatchedRoot: true`;
- actual request/write/native-undo assertions and request/save privacy audits present.

Record final exact-head totals, hashes, and evidence paths in the SDD final report and PR body rather than making another recursive Stage 58 commit.

- [ ] **Step 7: Dispatch the broad independent whole-PR review**

Use the most capable available reviewer and provide the complete base-to-head diff, plan, Stage 58, focused/full gate reports, and runtime evidence. Require separate verdicts for:

- **Spec compliance:** only the Edit branch moved; all required behavior remains; no later PR scope.
- **Code quality:** narrow interfaces, no cycle, no duplicated submission state, focused tests, and no unnecessary legacy migration.
- **Write/security/privacy:** exact target and signal forwarding, same-note serialization, one correction, guarded/native writer isolation, freshness/abort ordering, committed-save behavior, concise persistence, and credential/artifact exclusion.

Resume the relevant implementer for any fix, rerun affected and full gates plus runtime scenarios, and obtain scoped re-review. Do not submit with an open Critical/Important finding.

- [ ] **Step 8: Submit the PR and stop at the human gate**

Push the branch and create the PR using `Refs #76`, not a closing keyword. Include this exact remaining-scope statement in the PR body:

> This PR lands only the modification submission/review interaction extraction from issue #76. Issue #76 remains open for session/thread lifecycle, request/abort identity, streaming render/scroll generations, composer draft/capacity, Web draft/review state, and control synchronization.

Include unit/full-gate and exact-head loopback evidence with environment limits. Wait for CI to be green if available. Do not merge, close #76, tag, publish, change versions, or start PR 06; the human now owns the merge gate.
