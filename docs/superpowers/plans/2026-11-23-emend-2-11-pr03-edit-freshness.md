# Emend 2.11.0 PR 03 Edit Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issue #77 by giving Full-note and Selection edits one fail-closed freshness contract while preserving guarded `vault.modify` for Full-note and native, undoable `editor.replaceRange` on the captured Selection range.

**Architecture:** A focused `edit-freshness.ts` module reads current disk text, snapshots all supplied editor texts, checks abort and active-target state, and requires exact full-document equality without line-ending or Unicode normalization. Full-note and Selection adapt their existing writer interfaces to this guard but retain separate write methods and result handling. Selection newly rejects disk and secondary-editor divergence with the existing concise stale-note error.

**Tech Stack:** Strict TypeScript, Obsidian 1.11.4+ desktop APIs, Vitest 4 with existing Obsidian mocks and public chat-view fixture, ESLint, esbuild/CommonJS for ES2021, and the established ignored real-Obsidian Linux/Xvfb loopback harness. No new dependency.

**Spec:** Approved global plan `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, PR 03 row and Global Constraints only; [Issue #77](https://github.com/chliu1990/obsidian-emend/issues/77); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `ROADMAP.md`; `devel_docs/51-2-10-stabilization.md`; `devel_docs/55-edit-target-flow.md`; current editing and privacy guides.

## Global Constraints

- Base implementation on merged main commit `3a7f53edd3f889cfe6841f51af3e1918c3a7a8e3`, on branch `feature/2.11-pr03-edit-freshness`. PR 02 is a merged dependency; do not reopen its target-flow decisions.
- Keep plugin ID `emend`, view type `emend-chat-view`, existing `emend:` command IDs, and released version metadata stable until the separate 2.11.0 release PR.
- Chat, Chat Selection, Web research, image selection, and Related Notes remain writer-free. Full-note Edit alone may call guarded `vault.modify`; Selection-based edits may call only native `editor.replaceRange` on the captured range.
- Do not make either writer call the other. The shared module is a freshness guard, not a third writer or a common write executor.
- Operations remain the only model-facing edit protocol. Resolve exact original anchors atomically; reject ambiguity, overlap, out-of-target ranges, malformed structure, and stale state. Never partially apply a rejected candidate.
- Existing Edit workflows continue to emit reviewable CriticMarkup. Track Changes remains separate and is the only Apply/Reject surface: no Emend diff/Apply/Reject UI, bundling, automatic installation, or second review UI.
- Candidate-validation failure retains exactly one same-provider correction with bounded private diagnostics. Provider, abort, stale, capacity, permission, read, and write failures get none. No new correction or silent retry.
- Preserve ready-only originating-session history, same-note request serialization, schema-3 persistence, SecretStorage credentials, sanitized saves, capacity checks at preflight and every fetch, abort/target/generation guards, and private raw candidates/retrieval artifacts.
- Freshness comparisons use exact strings from the captured source, current `vault.read` text, the captured editor, and every supplied open editor. Do not normalize CRLF/LF, Unicode, whitespace, or line endings to make a write succeed.
- Preserve the existing concise stale error: `The note changed while Emend was responding. No edits were applied.` Do not include disk/editor contents, divergent excerpts, raw candidates, or new path details in freshness errors.
- Use focused modules and existing TypeScript style: tabs, single quotes, semicolons, trailing commas, and `async`/`await`. No second provider stack, background request, telemetry, remote code execution, or unbundled runtime dependency.
- New or migrated chat-view behavior tests use `tests/chat-view-public.test.ts` and `tests/helpers/chat-view-public-fixture.ts`. Do not add private-prototype access, private-field casts, hand-built public-view contexts, or test-only production accessors. Mechanically update shared legacy doubles only where the new adapter type requires it; migrate any individual legacy case whose behavior/assertions must change.
- Every behavior PR updates `AGENTS.md`, the owning user guides, `IMPLEMENTATION_PLAN.md`/`ROADMAP.md` as applicable, and adds a new current stage record. Do not alter historical stage results.
- Feature and refactoring PRs do not bump versions, create tags, publish releases, change workflows, or submit to the Community Directory.
- Manual verification uses only ignored `test_vault/`, synthetic notes, loopback OpenAI-compatible SSE/CORS mocks, and dummy SecretStorage credentials. Never use real accounts, paid calls, private notes, personal paths, or other vaults.
- Write-path changes require independent whole-PR code/security review in addition to independent task reviews. Submit the PR and stop at the human gate; do not merge automatically.

## Review Focus

1. **Disk, captured-editor, and multi-pane divergence:** neither writer may overwrite newer user text or allow a clean sibling to mask a dirty target. Owned by Tasks 1–3 unit/integration matrices and Tasks 3–5 real-Obsidian scenarios.
2. **CRLF and normalization:** exact matches may write; LF/CRLF or Unicode-normalization-only differences must fail closed without modifying raw file bytes. Owned by Tasks 1–3 and Task 4.
3. **Abort and race boundaries:** cancellation before, during, and after the asynchronous disk read must prevent writes; final permission/abort checks and Selection replacement must share one synchronous handoff. Owned by Tasks 1–4.
4. **Permission, no-op, and error privacy:** read-only modes and unchanged responses perform no freshness I/O; stale failures use only the established concise message and never trigger correction. Owned by Tasks 1–3.
5. **Writer isolation and native undo:** Full-note uses only one guarded vault write, while Selection replaces only captured offsets and preserves exact native undo/redo. Owned by Tasks 2–4 and final independent review.

## Context and Current Gaps

### Current Full-note behavior

`src/note-writer.ts:37-87`:

1. Denies non-Edit modes before reading.
2. Returns an unchanged result without disk I/O for a no-op.
3. Awaits `writer.readCurrentText(file)`, currently `vault.read`.
4. Reads optional `readEditorTexts(file)` synchronously.
5. Checks abort.
6. Requires disk text and every supplied editor text to equal `snapshot.sourceText`, and requires the current target file to match.
7. Rechecks Edit permission and calls `writer.write`, currently `vault.modify`.

`src/main.ts:598-617` supplies the current target editor plus every open Markdown view for the same file. `undefined` or an empty editor list means there is no open-editor comparison and the pure writer may use its disk-only fallback. Production still independently requires the current target file, so closing every Markdown target fails the target check rather than authorizing a write.

### Current Selection behavior

`src/selection-editor.ts:189-235`:

1. Computes the composed annotated full document for no-op detection.
2. Denies non-Edit modes and returns no-op results without editor reads.
3. Checks abort.
4. Requires only `editor.readCurrentText()` to equal `snapshot.fullText` and the original target view/file to remain current.
5. Rechecks permission and abort, then synchronously calls native `replaceRange` at `snapshot.from`/`snapshot.to`.

The adapter reads only the captured `MarkdownView.editor`. It has no disk read and no secondary-editor reader. Therefore disk-only or secondary-pane divergence can disagree with Full-note’s definition of “current.” Full-note also already has an immediate post-read abort and second permission check; Selection has the latter checks but no asynchronous freshness read.

### Exact gaps to close

- One shared implementation must own disk/editor/target comparison and post-read abort ordering.
- Selection must supply current disk text and every open editor, while retaining an explicit read of its captured editor even if workspace enumeration omits it.
- Selection comparison remains against complete `snapshot.fullText`, not just `selectedText`; changes outside the Selection are also stale.
- Selection becomes asynchronous only through freshness verification. After the final guards, native replacement remains synchronous and uses only captured offsets.
- No-open-editor behavior must be explicit: the comparison guard permits `undefined`/`[]` as disk-only evidence, but never overrides target identity. Full-note’s existing disk-only writer seam remains; Selection still requires its captured target view and native editor.
- CRLF and other normalization-only differences fail closed. Successful matching-CRLF behavior is pinned in unit tests; real host normalization is recorded honestly rather than bypassed.
- The pre-write check cannot provide cross-process compare-and-swap. The plan preserves the existing bounded check-then-write contract and documents the remaining external-write race.

## Chosen Design and Alternatives

### Recommended: shared asynchronous freshness guard with writer-specific adapters

Create `src/edit-freshness.ts`:

```ts
export const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

export interface EditFreshnessSource {
	readonly capturedText: string;
	readDiskText(): Promise<string>;
	readEditorTexts(): readonly string[] | undefined;
	isTargetCurrent(): boolean;
}

export async function assertEditFreshness(
	source: EditFreshnessSource,
	signal?: AbortSignal,
): Promise<void>;
```

`assertEditFreshness`:

1. Calls `signal?.throwIfAborted()` before reading.
2. Awaits `readDiskText()` exactly once.
3. Calls `readEditorTexts()` once, synchronously after the disk read.
4. Calls `signal?.throwIfAborted()` again.
5. Requires `diskText === capturedText`, every supplied editor text to equal `capturedText`, and `isTargetCurrent()` to be true.
6. Returns `Promise<void>` only after all checks pass.
7. Throws `new Error(STALE_NOTE_ERROR)` for disk/editor/target mismatch. `undefined` and `[]` editor lists impose no editor comparison.
8. Propagates abort, disk-reader, and editor-reader errors unchanged. It performs no retry, logging, persistence, or write and returns no source text.

Both apply functions retain permission and write ownership:

```text
initial Edit permission
→ unchanged-result check
→ assertEditFreshness
→ second Edit permission
→ final abort check
→ writer invocation with no intervening await
```

Full-note awaits `writer.write(...)` as before. Selection awaits the freshness guard, then performs final permission/abort checks and native `replaceRange` in the same continuation.

### Selection adapter additions

Retain `readCurrentText` for the captured editor and add required disk/open-editor readers:

```ts
export interface SelectionFreshnessReaders {
	readDiskText(file: TFile): Promise<string>;
	readEditorTexts(file: TFile): readonly string[] | undefined;
}

export interface SelectionEditorAdapter {
	readCurrentText: () => string;
	readDiskText: () => Promise<string>;
	readEditorTexts: () => readonly string[] | undefined;
	isTargetCurrent: () => boolean;
	replaceRange: (replacement: string, from: number, to: number) => void;
}
```

Update:

```ts
createSelectionEditorAdapter(
	markdownView: MarkdownView,
	isTargetCurrent: (view: MarkdownView) => boolean,
	readers: SelectionFreshnessReaders,
): SelectionEditorAdapter;

captureSelectionEditTarget(
	view: MarkdownView,
	isTargetCurrent: (view: MarkdownView) => boolean,
	readers: SelectionFreshnessReaders,
): SelectionEditTarget;

applyPreparedSelectionEdit(
	mode: Mode,
	snapshot: SelectionSnapshot,
	prepared: EditPreparation,
	editor: SelectionEditorAdapter,
	signal?: AbortSignal,
): Promise<EditResult>;
```

The adapter binds readers to the originally captured `TFile`. Its `readEditorTexts` delegates to `main.ts`’s existing every-open-editor reader. `applyPreparedSelectionEdit` passes a combined list containing `editor.readCurrentText()` first and every adapter-supplied open editor after it. Duplicate views are harmless; no content-based deduplication is allowed.

`main.ts` supplies `{ readDiskText: file => this.app.vault.read(file), readEditorTexts: file => this.readNoteEditorTexts(file) }` at both Selection capture sites through one narrow private helper. `readNoteEditorTexts` itself remains unchanged.

### Alternative A: pure synchronous comparator only

Each writer would independently await its disk read and then call a shared synchronous equality helper.

- Advantage: slightly smaller module.
- Rejection: abort/read/snapshot ordering would remain duplicated, which is the drift issue #77 is intended to remove. It would also be easier for a future writer to compare before awaiting or omit the post-read abort.

### Alternative B: shared write executor with callbacks

A common executor could own freshness, permission, abort, and a writer callback.

- Advantage: maximizes shared ordering.
- Rejection: unnecessarily couples permission/result behavior to writing and risks becoming a third writer abstraction. It obscures the critical native synchronous Selection handoff and makes accidental writer routing harder to review. The recommended guard shares only the actual common decision.

## Explicit Non-Goals

- No #79 Markdown scanner consolidation.
- No #76 controller extraction or `chat-view.ts` decomposition.
- No feature, UI, setting, menu, notice, target-flow, provider, persistence, or capacity redesign.
- No new writer, common writer executor, automatic edit, background read/request, fallback provider, or new correction retry.
- No atomic cross-process locking, file watcher, conflict-resolution UI, merge, or automatic refresh.
- No normalization to make CRLF or Unicode-different documents writable.
- No changes to `src/edit-target.ts`, request prompts, Operations validation, CriticMarkup guards, or composed-Selection validation.
- No Track Changes integration changes, Emend diff UI, or Full-note native-undo claim.
- No version metadata, workflow, tag, release, or Community Directory work.
- No committed real-Obsidian harness, generated bundle, evidence, local settings, credentials, or vault content.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-11-23-emend-2-11-pr03-edit-freshness.md` | Create | This focused plan. |
| `src/edit-freshness.ts` | Create | Shared asynchronous exact-source, every-editor, target, and abort guard. |
| `src/note-writer.ts` | Modify | Adapt Full-note freshness to the shared guard; retain `vault.modify` and `EditResult`. |
| `src/selection-editor.ts` | Modify | Add required Selection freshness readers, use shared guard, await native application, preserve exact range replacement. |
| `src/main.ts` | Modify | Supply vault disk and every-open-editor readers to both Selection capture paths. |
| `tests/edit-freshness.test.ts` | Create | Pin comparison, no-open, CRLF, normalization, abort, error, and privacy semantics. |
| `tests/note-writer.test.ts` | Modify | Pin Full-note migration, no-op/permission, final abort, and write handoff. |
| `tests/request-coordinator.test.ts` | Regression | Preserve coordinator ordering, stale/abort, no-op, and correction behavior. |
| `tests/selection-editor.test.ts` | Modify | Pin Selection disk/captured/every-editor/full-document matrices and async application. |
| `tests/main.test.ts` | Modify | Prove production reader wiring, scoping, multi-pane behavior, and writer routing. |
| `tests/selection-modal.test.ts` | Mechanical/regression | Update required adapter doubles; preserve modal correction/failure behavior. |
| `tests/selection-unload.test.ts` | Mechanical/regression | Update required adapter doubles; preserve unload abort behavior. |
| `tests/request-isolation.test.ts` | Mechanical/regression | Update adapter doubles; preserve request serialization and stale/abort isolation. |
| `tests/operation-edit-strategy.test.ts` | Mechanical/regression | Update adapter doubles; preserve validation/correction confinement. |
| `tests/helpers/chat-view-public-fixture.ts` | Mechanical | Supply fresh matching disk/editor doubles in captured Selection targets. |
| `tests/chat-view-public.test.ts` | Regression | Preserve public Selection routing and persistence behavior. |
| `tests/quick-actions.test.ts` | Mechanical/regression | Update shared adapter doubles only. |
| `tests/chat-view.test.ts` | Mechanical only if required | Update shared adapter factories; do not add legacy behavior cases. Migrate any individually touched case. |
| `test_vault/emend-selection-chat-verify/verify.mjs` | Ignored local only | Add `--edit-freshness` real-Obsidian matrix using PR 02 harness baseline. |
| `test_vault/emend-selection-chat-verify/mock-provider.mjs` | Ignored local only | Add deterministic held/valid Operations responses required by scenarios. |
| `AGENTS.md` | Modify | Record one freshness contract and preserved writer/no-open/raw-text invariants. |
| `IMPLEMENTATION_PLAN.md` | Modify | Update current edit boundary and add Stage 56 index entry. |
| `ROADMAP.md` | Modify | Add current Stage 56 status and remove only completed #77 deferral. |
| `docs/guides/editing-and-review.md` | Modify | Describe shared saved-note/every-editor freshness and Selection stale behavior. |
| `docs/guides/privacy-and-storage.md` | Modify | Update writer/freshness description without broadening data-sharing claims. |
| `devel_docs/56-edit-freshness.md` | Create | Record exact design, matrices, evidence, review, and limitations. |

## Concrete Unit and Integration Matrix

| Case | Full-note expectation | Selection expectation |
| --- | --- | --- |
| Disk and all editors match | One `vault.modify` with exact prepared text | One native replacement at captured offsets |
| No open editor texts (`undefined` and `[]`) | Guard permits disk-only comparison; target check still decides | Captured editor is always separately included; missing captured target remains stale |
| Disk differs; editors match | Exact stale error; no write | Exact stale error; no native replacement |
| Captured editor differs; disk matches | Stale; no write | Stale; no replacement |
| Secondary editor differs; disk/captured match | Stale; no write | Newly stale; no replacement |
| Dirty target plus clean sibling | Stale; clean sibling cannot mask target | Stale; clean sibling cannot mask target |
| Change only outside Selection | Stale full-note source | Stale complete `fullText`; never compare only `selectedText` |
| Unrelated file’s editor differs | Ignored | Ignored |
| Wrong target/view | Stale; no write | Stale; no replacement or rerouting |
| Matching CRLF everywhere | Exact prepared CRLF write | Exact captured-range arguments; no normalization |
| CRLF disk versus LF editor | Stale | Stale; raw disk remains unchanged |
| NFC versus NFD source | Stale | Stale |
| Abort before disk read | No disk/editor read or write | No disk/editor read or replacement |
| Abort while disk read pending | Abort after read settles; no write | Abort after read settles; no replacement |
| Abort during final target check | Final abort prevents write | Final abort prevents replacement |
| `ask`/`discuss`/`brainstorm` | No freshness I/O or write; summary suppressed | Same |
| No-op/unchanged candidate | No freshness I/O; validated summary retained | Same |
| Disk/editor reader throws | Same error propagates; no write/correction | Same |
| Writer throws | Same error propagates; no correction | Same |
| Stale after a correction round | Terminal; no third request or write | Terminal; no third request or replacement |
| Error privacy | Exact concise stale message without source sentinels | Same |

---

### Task 1: Shared Fail-Closed Freshness Guard

**Files:**
- Create: `src/edit-freshness.ts`
- Test: `tests/edit-freshness.test.ts`

**Interfaces:** Produces `STALE_NOTE_ERROR`, `EditFreshnessSource`, and `assertEditFreshness` exactly as defined above. No writer imports or write callback.

- [ ] **Step 1: Write failing contract tests**

Cover successful disk-only and all-editor matches; disk mismatch; first and later editor mismatch; dirty-target/clean-sibling masking; false target; `undefined` and empty editor lists; immediate and pending-read abort; exact matching CRLF; CRLF/LF and NFC/NFD rejection; reader-error identity; and one-call read ordering. Use synthetic source sentinels and assert every stale error exactly equals `STALE_NOTE_ERROR` and contains none of those sentinels.

Assert ordering explicitly: initial abort check → disk read → editor snapshot → second abort check → equality/target evaluation. A false target must not write because this module has no writer at all.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/edit-freshness.test.ts`

Expected: FAIL because `src/edit-freshness.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal guard**

Implement only the specified asynchronous read/compare/abort contract. Do not catch and rewrite reader errors, normalize text, add result unions, log source text, or accept a write callback.

- [ ] **Step 4: Run focused verification and self-review**

Run:

```bash
npx vitest run tests/edit-freshness.test.ts
npx tsc -noEmit -skipLibCheck
npx eslint src/edit-freshness.ts tests/edit-freshness.test.ts
```

Expected: all pass. Self-review that no Obsidian writer, vault, persistence, network, or UI dependency entered the module.

- [ ] **Step 5: Commit**

```bash
git add src/edit-freshness.ts tests/edit-freshness.test.ts
git commit -m "refactor: add shared edit freshness guard"
```

---

### Task 2: Migrate Full-Note Freshness Without Changing Its Writer

**Files:**
- Modify: `src/note-writer.ts`
- Test: `tests/note-writer.test.ts`
- Regression: `tests/request-coordinator.test.ts`
- Regression: `tests/edit-freshness.test.ts`

**Interfaces:** Keeps `NoteWriter`, `createVaultNoteWriter`, `applyPreparedEdit`, and `EditResult` signatures unchanged. Consumes Task 1’s guard.

- [ ] **Step 1: Add failing Full-note boundary tests**

Add tests for final abort triggered from `isTargetCurrent`, exact matching-CRLF writes, and the ordered handoff `disk read → editor snapshot → target check → vault write`. Keep existing no-open fallback, every-pane, no-op, permission, stale, abort, and writer-error cases. Assert no second disk read and exactly one `writer.write`.

- [ ] **Step 2: Run tests and confirm the intended RED**

Run: `npx vitest run tests/note-writer.test.ts`

Expected: the new final-abort/order cases fail against the old local implementation or reveal ordering drift. Existing contract characterizations may pass; do not manufacture changes solely to make them fail.

- [ ] **Step 3: Replace only the local freshness block**

Call `assertEditFreshness` with `snapshot.sourceText`, `writer.readCurrentText(file)`, optional `writer.readEditorTexts(file)`, and `writer.isTargetCurrent(file)`. Retain initial/second permission checks, no-op result semantics, final abort check, `writer.write`, and result construction.

- [ ] **Step 4: Run focused regression verification and self-review**

Run:

```bash
npx vitest run tests/edit-freshness.test.ts tests/note-writer.test.ts tests/request-coordinator.test.ts
npx tsc -noEmit -skipLibCheck
```

Expected: all pass. Confirm Full-note remains the only caller of `writer.write`/`vault.modify`, stale/write failures do not alter correction behavior, and no-op/read-only paths perform no disk read.

- [ ] **Step 5: Commit**

```bash
git add src/note-writer.ts tests/note-writer.test.ts
git commit -m "refactor: use shared freshness for full-note edits"
```

---

### Task 3: Apply the Same Contract to Selection and Production Wiring

**Files:**
- Modify: `src/selection-editor.ts`
- Modify: `src/main.ts`
- Test: `tests/selection-editor.test.ts`
- Test: `tests/main.test.ts`
- Mechanical/regression tests listed in the File Responsibility Map
- Ignored local: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored local: `test_vault/emend-selection-chat-verify/mock-provider.mjs`

**Interfaces:** Produces the exact `SelectionFreshnessReaders`, expanded `SelectionEditorAdapter`, updated capture factories, and `Promise<EditResult>` application contract defined above. `SelectionEditRequestCoordinator.submit` awaits the application and preserves usage/result shape.

- [ ] **Step 1: Add failing Selection unit and main-integration tests**

Extend adapter doubles with independent disk, captured-editor, and secondary-editor state. Add cases for disk-only divergence, secondary-only divergence, dirty-target/clean-sibling, changes outside Selection, unrelated-file isolation, pending disk-read abort, final abort, matching CRLF, and successful exact-range replacement.

Add main-level tests proving both Selection capture paths receive vault disk and `readNoteEditorTexts` readers bound to the original file. Drive valid Operations through the coordinator: matching sources use one native replacement and zero `vault.modify`; disk or secondary divergence produces the exact stale error, zero writes, and no additional correction request.

- [ ] **Step 2: Run the new tests and confirm RED**

Run: `npx vitest run tests/selection-editor.test.ts tests/main.test.ts`

Expected: disk and secondary-divergence cases currently apply native edits instead of rejecting; new reader/abort/interface cases fail. Do not weaken assertions to match the old contract.

- [ ] **Step 3: Establish the PR 02 harness baseline and reproduce the Selection gap**

Provision the ignored harness from `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr02-edit-target-flow/test_vault/emend-selection-chat-verify/`, especially its current `verify.mjs`, `model-controls.mjs`, and `mock-provider.mjs`. Do not start from an older main copy.

Add a focused `--edit-freshness` group and deterministic held Operations responses before changing Selection production code. Build the Task 2 head and run only the new Selection disk-divergence scenario:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness --selection-disk-baseline
```

Expected: where the harness can keep the captured editor unchanged while changing disk directly, the old Selection writer performs a native replacement and the new stale assertion fails. Record whether the host preserved that disk-only shape; do not claim baseline RED if Obsidian synchronized the editor first. Unit RED remains mandatory regardless.

- [ ] **Step 4: Implement Selection freshness and required host readers**

Add the required reader interfaces and adapter methods, bind them to the captured file, and pass main’s existing disk/every-editor readers at both composer and Command Palette capture sites. Combine captured editor text with every supplied open-editor text inside the shared guard input.

Make `applyPreparedSelectionEdit` async, await `assertEditFreshness` against complete `snapshot.fullText`, then recheck permission and abort and call `replaceRange` without another await. Await it from `SelectionEditRequestCoordinator`. Do not call `vault.modify`, normalize text, alter candidate validation, or add correction behavior.

Mechanically add matching `readDiskText`/`readEditorTexts` doubles to every required `SelectionEditorAdapter` fixture. Do not change unrelated assertions or add legacy chat-view cases.

- [ ] **Step 5: Run focused and affected-suite verification**

Run:

```bash
npx vitest run tests/edit-freshness.test.ts tests/note-writer.test.ts tests/request-coordinator.test.ts tests/selection-editor.test.ts tests/main.test.ts tests/selection-modal.test.ts tests/selection-unload.test.ts tests/request-isolation.test.ts tests/operation-edit-strategy.test.ts tests/chat-view-public.test.ts tests/quick-actions.test.ts tests/chat-view.test.ts
npx tsc -noEmit -skipLibCheck
```

Expected: all pass. Review every async callsite for a missing `await`, every adapter for a fail-open optional reader, and every changed legacy file for unauthorized test migration.

- [ ] **Step 6: Rerun the focused real scenario and self-review**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness --selection-disk-baseline
```

Expected: Selection now rejects disk divergence with the exact stale error, zero native/vault writes, one provider request, and unchanged user bytes; root/loaded bundle identity holds. Self-review that Full-note and Selection still have separate writers and Selection replacement remains native and synchronous after final checks.

- [ ] **Step 7: Commit tracked implementation and tests only**

```bash
git add src/selection-editor.ts src/main.ts tests/selection-editor.test.ts tests/main.test.ts tests/selection-modal.test.ts tests/selection-unload.test.ts tests/request-isolation.test.ts tests/operation-edit-strategy.test.ts tests/helpers/chat-view-public-fixture.ts tests/chat-view-public.test.ts tests/quick-actions.test.ts tests/chat-view.test.ts
git commit -m "fix: require fresh sources for selection edits"
```

Do not stage ignored harnesses, runtime vaults, evidence, or `main.js`.

---

### Task 4: Complete Real-Obsidian Evidence and Canonical Documentation

**Files:**
- Ignored local: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored local: `test_vault/emend-selection-chat-verify/mock-provider.mjs`
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ROADMAP.md`
- Modify: `docs/guides/editing-and-review.md`
- Modify: `docs/guides/privacy-and-storage.md`
- Create: `devel_docs/56-edit-freshness.md`
- Include: `docs/superpowers/plans/2026-11-23-emend-2-11-pr03-edit-freshness.md`

**Interfaces:** No production interface. Produce actual evidence for Stage 56.

- [ ] **Step 1: Complete the focused real-Obsidian scenario assertions before execution**

Extend `--edit-freshness` with synthetic scenarios covering:

1. Full-note disk-only, captured-editor-only, secondary-pane, wrong-target, and no-open-target rejection, preserving user/disk bytes and making zero plugin vault writes.
2. Selection disk-only, captured-editor inside and outside the Selection, secondary-pane, wrong-target, closed-target, and no-open-target rejection, preserving user bytes and making zero native/plugin vault writes.
3. Matching multi-pane Full-note and Selection success, proving one correct writer only; Selection undo/redo restores exact full-document bytes and outside-Selection content.
4. CRLF disk with host-normalized editor text: both paths fail closed and raw CRLF file bytes remain unchanged. Record actual observed editor/disk line-ending shapes; do not claim successful real CRLF editing unless it is genuinely exercised.
5. Abort during a held post-response freshness `vault.read` for both paths, then release the read and prove no late write. Also cover immediate Stop before application.
6. No-op and Chat writer-free controls, stale after a valid correction round with no third request, exact concise errors without divergent sentinels, and no raw candidate/source snapshot in saved chats.
7. Native undo/redo after a normal Selection success and exact root/loaded `main.js` SHA-256 identity in setup and summary.

Instrument actual writer calls and note bytes. Record where Obsidian mirrors same-file panes, making independent dirty-target/clean-sibling divergence unit-only. Dynamic permission denial is a unit-mode matrix because there is no runtime permission toggle to manipulate.

- [ ] **Step 2: Build and run the real verification groups**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Expected: all exercised scenarios pass, summaries record exact head/bundle hash and `loadedBundleMatchedRoot: true`, and request logs contain no authorization headers or dummy credential. Preserve screenshots/logs only under ignored evidence paths.

- [ ] **Step 3: Update current documentation owners**

In `AGENTS.md`, add `edit-freshness.ts` to the architecture map and state that both writers require exact disk/captured/every-open-editor full-document equality, active target, no abort, and Edit permission immediately before writing. Record disk-only comparison fallback versus independent target checks, no normalization, and Selection’s synchronous native handoff.

In `IMPLEMENTATION_PLAN.md`, replace the separate freshness description with the shared contract and add Stage 56, `Shared edit freshness with native Selection writes`, to the numbered index and current status paragraph.

In `ROADMAP.md`, add Stage 56 to recently shipped status and remove only the completed #77 deferral. Leave #76, #79, #91, and all unrelated deferrals unchanged.

In both user guides, explain that Full-note and Selection require the saved note and every open editor to match the captured complete note before writing. Selection divergence shows the existing stale error and replaces nothing; native undo still applies only after a successful native replacement. Link Stage 56. Do not broaden privacy, persistence, or writer claims.

Do not modify historical Stage 08/09/51/55 records.

- [ ] **Step 4: Create Stage 56 from actual results**

Include base/branch/scope/exclusions; chosen design and rejected alternatives; exact API/error/order/no-open/CRLF/race semantics; unit and real matrices; genuine RED evidence; actual gate results; independent review once completed later if available; bundle identity; environment/provider/input/theme limits; mirrored-pane and host-normalization observations; and the remaining non-atomic external-write limitation. Do not invent results or claim unexercised platforms/providers.

- [ ] **Step 5: Run documentation checks, self-review, and commit**

Run the repository’s local link/anchor audit for every changed document. If no scripted audit exists, manually inspect each changed relative link and heading anchor and record that limitation in the task report.

```bash
git diff --check
git status --short
```

Confirm the docs match actual source and evidence and no historical record changed. Then:

```bash
git add AGENTS.md IMPLEMENTATION_PLAN.md ROADMAP.md docs/guides/editing-and-review.md docs/guides/privacy-and-storage.md devel_docs/56-edit-freshness.md docs/superpowers/plans/2026-11-23-emend-2-11-pr03-edit-freshness.md
git commit -m "docs: record shared edit freshness"
```

---

### Task 5: Exact-Head Gates, Independent Write/Security Review, and PR Submission

**Files:** Review the complete base-to-head diff. Only review-driven fixes and corresponding evidence updates may add commits.

- [ ] **Step 1: Run the final focused audit**

```bash
npx vitest run tests/edit-freshness.test.ts tests/note-writer.test.ts tests/request-coordinator.test.ts tests/selection-editor.test.ts tests/main.test.ts tests/selection-modal.test.ts tests/selection-unload.test.ts tests/request-isolation.test.ts tests/operation-edit-strategy.test.ts tests/chat-view-public.test.ts tests/quick-actions.test.ts tests/chat-view.test.ts
npx tsc -noEmit -skipLibCheck
git diff --check
```

Audit that Selection never calls `vault.modify`, Full-note never calls native replacement, no reader is optional in Selection, and no stale/read/write failure enters candidate correction.

- [ ] **Step 2: Run the full local gate on the exact submitted head**

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

All commands must pass before submission. Use focused tests again after any review fix, then repeat the full gate.

- [ ] **Step 3: Repeat real-Obsidian verification on the exact head**

Rebuild after documentation changed the embedded build identity and rerun:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Assert final root/loaded bundle identity, actual bytes/writers/undo, and sanitized request evidence. Record ultimate exact-head results in the SDD ledger and PR body/check evidence without recursively rewriting Stage 56.

- [ ] **Step 4: Obtain fresh independent whole-PR write/security review**

Give a fresh reviewer the complete `3a7f53edd3f889cfe6841f51af3e1918c3a7a8e3..HEAD` diff, this plan, issue #77, and actual evidence. Require separate spec-compliance, quality, and write/security verdicts covering:

- exact full-document disk/captured/every-editor comparisons;
- no-open behavior and dirty-target/clean-sibling masking;
- CRLF/no-normalization and raw privacy;
- abort/read/final synchronous handoff boundaries;
- initial/second permission and no-op behavior;
- writer isolation and native undo;
- no new correction/retry/background work;
- public-test integrity and documentation accuracy;
- remaining external-write race and evidence limits.

Resolve every Critical/Important finding through the same implementer/reviewer loop, then rerun affected tests, full gates, and relevant real scenarios. Commit each review fix separately with focused verification.

- [ ] **Step 5: Check the submission boundary**

```bash
git status --short
git diff --name-only 3a7f53edd3f889cfe6841f51af3e1918c3a7a8e3..HEAD
git diff --name-only 3a7f53edd3f889cfe6841f51af3e1918c3a7a8e3..HEAD -- package.json package-lock.json manifest.json versions.json CHANGELOG.md .github
git ls-files main.js test_vault
```

Expected: clean tracked worktree; only scoped files; no version/workflow changes; no generated bundle or vault files tracked. Confirm #79/#76 files and behavior were not bundled.

- [ ] **Step 6: Submit and stop at the human gate**

```bash
git push -u origin feature/2.11-pr03-edit-freshness
gh pr create --base main --title "refactor: unify edit freshness" --body "Resolves #77. Introduces one fail-closed disk/every-editor freshness contract for Full-note and Selection writes while preserving guarded vault writes and native Selection undo. Include the exact-head gates, Linux loopback evidence, limitations, and independent write/security review results in this PR."
gh pr checks --watch
```

Do not merge, tag, publish, close unrelated issues, or start PR 04. Update #77 only from actual merged scope and leave #76/#79 untouched.

## Honest Evidence Limitations to Preserve

- Unit tests use Obsidian mocks and cannot establish host editor synchronization, native undo, or actual raw file bytes.
- Real evidence must identify the actual Linux/Xvfb environment, Obsidian version evidence, theme, and CDP-driven input. No macOS, Windows, mobile, physical-input, screen-reader, other-version, or unexercised popout-edge claim.
- Loopback OpenAI-compatible SSE with dummy SecretStorage credentials is not real-provider coverage; no real account, paid call, external network, or provider behavior may be claimed.
- Obsidian may mirror same-file pane contents. If independent secondary-editor divergence cannot be produced live, report it as unit-verified only rather than overstating the manual matrix.
- If the host normalizes CRLF editor text, real CRLF success may be intentionally unavailable. Exact matching-CRLF success is then unit evidence; real evidence proves fail-closed behavior and unchanged raw disk bytes.
- The final freshness check and write are not a cross-process compare-and-swap. External changes after the final check remain a bounded host race; this PR does not claim locking or post-write conflict detection.
- Native undo applies to successful Selection replacement only. Full-note remains guarded `vault.modify` plus separate Track Changes review.
- No dynamic permission-setting runtime exists for manual denial; read-only permission matrices are unit-level, with real Chat writer-free regression evidence only.
