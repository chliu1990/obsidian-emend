# Emend 2.11.0 PR 02 Edit-Target Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issue #78 by replacing parallel Edit-target choice/display state with one maintained resolved state and one captured submission identity, while making Markdown target lookup side-effect-free and preserving all current UX, writer, and failure semantics.

**Architecture:** `edit-target.ts` owns a discriminated `EditTargetState` and pure resolution/refresh functions. `chat-view.ts` consumes that state’s maintained `resolved` value for display, capacity, quick actions, and submission, then captures the existing discriminated request target exactly once. `main.ts` reads the active/remembered/open Markdown view without mutation; only explicit lifecycle tracking updates `lastMarkdownView`. Existing full-note and native-Selection writer guards remain unchanged.

**Tech Stack:** Strict TypeScript, Obsidian 1.11.4+ desktop APIs, Vitest 4 with existing Obsidian mocks and the PR 01 public chat-view fixture, ESLint, esbuild/CommonJS for ES2021, and the established ignored real-Obsidian Linux/Xvfb loopback harness. No new dependency.

**Spec:** Approved global plan `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, PR 02 row only; [Issue #78](https://github.com/chliu1990/obsidian-emend/issues/78); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `devel_docs/39-easier-selection-editing.md`; `devel_docs/44-compact-composer.md`; `devel_docs/49-selection-focus-and-context.md`; `devel_docs/51-2-10-stabilization.md`; `devel_docs/54-public-chat-view-test-seam.md`.

## Global Constraints

- Keep plugin ID `emend`, view type `emend-chat-view`, existing `emend:` command IDs, and released version metadata stable until the separate 2.11.0 release PR.
- Chat, Chat Selection, Web research, image selection, and Related Notes remain writer-free. Full-note Edit alone may call guarded `vault.modify`; Selection-based edits may call only native `editor.replaceRange` on the captured range.
- Operations remain the only model-facing edit protocol. Resolve exact original anchors atomically; reject ambiguity, overlap, out-of-target ranges, malformed structure, and stale state. Never partially apply a rejected candidate.
- Existing Edit workflows continue to emit reviewable CriticMarkup. Track Changes remains separate and is the only Apply/Reject surface: no Emend diff/Apply/Reject UI, bundling, automatic installation, or second review UI.
- Candidate-validation failure retains exactly one same-provider correction with bounded private diagnostics. Provider, abort, stale, capacity, permission, and write failures get none. Configurable retries and partial application from `#48` are outside 2.11.0.
- Preserve ready-only originating-session history, same-note request serialization, schema-3 persistence, SecretStorage credentials, sanitized saves, capacity checks at preflight and every fetch, abort/target/generation guards, and private raw candidates/retrieval artifacts.
- Use focused modules and existing TypeScript style. Do not add a second provider stack, background request, telemetry, remote code execution, or unbundled runtime dependency.
- Every behavior PR updates `AGENTS.md`, the owning user guide, `IMPLEMENTATION_PLAN.md`/`ROADMAP.md` as applicable, and adds a new current stage record. Do not alter historical stage results.
- Feature and refactoring PRs do not bump versions, create tags, publish releases, change workflows, or submit to the Community Directory.
- Start from base `8adbc7729469881b6bdeb245fa1b817bb71de6df` on branch `feature/2.11-pr02-edit-target-flow`. The verified baseline is 54 test files and 1,880 passing tests; do not rerun the baseline merely to reproduce it.
- Use `tests/chat-view-public.test.ts` and `tests/helpers/chat-view-public-fixture.ts` for every new or migrated chat-view behavior test. Do not add private-prototype access, private-field casts, hand-built public-view contexts, or test-only production accessors.
- Preserve current menu labels, notices, draft/caret/focus behavior, capacity calculations, target-reset rules, and writer routing unless a characterization test proves an in-scope defect. Stop and report any such defect rather than expanding the PR.
- Exclude #77 freshness-contract redesign, #79 scanners, #76 controller extraction, new user-facing behavior/features, version changes, and unrelated refactors.

## Review Focus

1. **Note/session/mode transitions:** automatic and explicit targets must not drift or reset at the wrong time. Owned by Task 3’s note/session/mode public tests and Task 4 scenario `01-note-session-mode-target-state`.
2. **Vanished or replaced Selections:** maintained Selection must fail closed before messages/requests/writes, while an already-captured request retains its original identity. Owned by Task 3’s vanished-Selection and deferred-save tests and Task 4 scenario `03-vanished-selection-fail-closed`.
3. **Lookup order and non-active/popout targets:** repeated reads must not replace the explicitly remembered target; lifecycle events must still do so. Owned by Task 2’s purity/lifecycle tests and Task 4 scenario `02-popout-automatic-selection-native-undo`.
4. **Wrong-target, stale, and abort races:** preflight and existing writer guards must reject without a late write, fallback, or new-thread result. Owned by Task 2’s full-note guard test, Task 3’s source-path/note-switch tests, existing Selection writer tests, and Task 4 scenario `04-wrong-target-stale-abort`.
5. **Writer and capacity routing:** explicit Full note must use only the guarded vault path despite a live Selection; automatic/explicit Selection must use only native replacement with correct capacity and undo. Owned by Task 3’s routing/capacity tests and Task 4 scenarios `02` and `05`.

## Design and Decisions

### One authoritative maintained state

Replace `editTargetChoice` and `displayedEditTarget` with:

```ts
export type EditTargetChoice = 'auto' | 'full-note' | 'selection';
export type ResolvedEditTarget = Exclude<EditTargetChoice, 'auto'>;

export type EditTargetState =
	| { readonly choice: 'auto'; readonly resolved: ResolvedEditTarget }
	| { readonly choice: 'full-note'; readonly resolved: 'full-note' }
	| { readonly choice: 'selection'; readonly resolved: 'selection' };

export function resolveEditTargetState(
	choice: EditTargetChoice,
	hasUsableSelection: boolean,
): EditTargetState;

export function refreshEditTargetState(
	state: EditTargetState,
	hasUsableSelection: boolean,
): EditTargetState;
```

`refreshEditTargetState` returns a newly resolved state only for `auto`; explicit states retain their identity and resolution. The view owns one `private editTarget: EditTargetState`, initialized as automatic Full note without host I/O.

- A writing-menu choice resolves once through `resolveEditTargetState`.
- Same-note target/capacity refreshes call `refreshEditTargetState`.
- A real note change resets to automatic Full note without host I/O; the normal maintained refresh then resolves current Selection availability before composer display/capture. This preserves the prior lazy lookup behavior.
- Session and Chat/Edit switches do not reset the state.
- `composerState`, draft/action capacity, quick actions, and `submitPrompt` all read `this.editTarget.resolved`.
- `refreshEditTargetControl` updates the maintained state before its no-composer early return, so state maintenance is not conditional on a control existing.

The old `resolveEditTarget` helper is removed rather than leaving a second resolution flow.

### Captured submission identity

Keep the existing `CapturedDraftTarget` discriminated union. Its `type: 'full-note' | 'selection'` is the captured resolved target identity; its `RequestContext` or `SelectionEditTarget` is captured synchronously once before the initial save. Do not resolve again after awaits, and do not add another target enum or controller.

Explicit Selection remains Selection even if the Selection disappears before or after a refresh. Capture then throws the existing `Select non-whitespace text first.` error. Automatic Selection also fails if it vanishes while Selection is still maintained; after a maintained automatic refresh resolves Full note, a later submission may use Full note. This preserves Stage 39 behavior and prevents silent fallback.

### Pure lookup and explicit last-active tracking

`getTargetMarkdownView()` retains its current precedence:

1. active Markdown view;
2. remembered view if still open;
3. first open Markdown view;
4. `null`.

It performs no assignment. `rememberActiveMarkdownView()` remains the only lifecycle updater and continues to run at load and through the existing `active-leaf-change`, `file-open`, and rename-driven refresh path. The first-open fallback is a local read result, not a new remembered target.

### Behavior and documentation decision

This is a behavior-preserving architecture refactor. The editing guide already specifies automatic/explicit targeting, vanished-Selection failure, maintained quick-action targeting, writer routing, and freshness semantics. No user-guide change is needed unless implementation reveals a behavior change, which is a stop-and-report condition. Update `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, and add Stage 55; do not rewrite historical stages.

### Characterization and mutation policy

Tasks 2 and 3 include genuine and characterization coverage. Where current behavior is already correct, do not manufacture a product change to obtain RED. Add the public characterization first, then apply the named temporary local mutation to prove the test detects the targeted drift, restore it immediately, and implement the refactor. Never commit a mutation.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-11-23-emend-2-11-pr02-edit-target-flow.md` | Create | This focused plan. |
| `src/edit-target.ts` | Modify | Own the single state type and pure resolve/refresh operations. |
| `src/chat-view.ts` | Modify | Maintain one target state; consume it for display, capacity, and one-time submission capture. |
| `src/main.ts` | Modify | Make target lookup pure; retain explicit last-active lifecycle updates and existing writer guards. |
| `tests/edit-target.test.ts` | Modify | Prove automatic/explicit resolution and refresh invariants. |
| `tests/main.test.ts` | Modify | Prove read purity, lifecycle tracking, non-active targeting, and full-note wrong-target rejection. |
| `tests/helpers/chat-view-public-fixture.ts` | Modify | Support dynamic Selection text and workspace-event emission through the existing public fixture only. |
| `tests/chat-view-public.test.ts` | Modify | Add required target-flow behavior and receive every touched legacy case. |
| `tests/chat-view.test.ts` | Modify | Delete migrated cases and mechanically update only shared legacy context state shapes for unrelated remaining cases. |
| `tests/quick-actions.test.ts` | Modify | Mechanically preserve prior target setup in pre-existing hand-built contexts; no assertion/body migration. |
| `tests/request-isolation.test.ts` | Modify | Mechanically preserve prior target setup in pre-existing hand-built contexts; no assertion/body migration. |
| `tests/main.test.ts` | Modify | Complete partial host doubles required by maintained Selection refresh, in addition to Task 2 lookup tests. |
| `tests/note-writer.test.ts` | Test only, unchanged | Existing Full-note stale/wrong-target/abort guard evidence. |
| `tests/selection-editor.test.ts` | Test only, unchanged | Existing native-Selection routing, wrong-target, stale, and abort evidence. |
| `AGENTS.md` | Modify | Record the single maintained/captured target and pure-lookup architecture rules. |
| `IMPLEMENTATION_PLAN.md` | Modify | Update current target architecture and add Stage 55 to the index. |
| `ROADMAP.md` | Modify | Add current Stage 55 status and remove only the completed #78 deferral. |
| `devel_docs/55-edit-target-flow.md` | Create | Record exact scope, migrations, RED/mutation evidence, gates, real scenarios, and limitations. |
| `test_vault/emend-selection-chat-verify/verify.mjs` | Ignored local verification only | Add a focused `--edit-target-flow` group using synthetic notes and actual Obsidian behavior. |
| `test_vault/emend-selection-chat-verify/mock-provider.mjs` | Ignored local verification only, if needed | Add only deterministic held/valid Operations responses required by the new scenarios. |

No production change belongs in `note-writer.ts`, `selection-editor.ts`, request coordinators, context scanners, provider code, styles, or persistence.

---

### Task 1: Pure Maintained Edit-Target State

**Files:**
- Modify: `src/edit-target.ts`
- Test: `tests/edit-target.test.ts`

**Interfaces:**
- Produces `EditTargetState`, `resolveEditTargetState`, and `refreshEditTargetState` exactly as defined above.
- Retains the existing `resolveEditTarget` temporarily so Tasks 1–2 remain buildable and Task 3 can characterize old behavior. Task 3 removes it with the final `chat-view.ts` migration; no second resolution flow may remain after Task 3.

- [ ] **Step 1: Write failing state-model tests**

Replace the old helper tests with automatic resolution in both availability states, explicit Full-note/Selection preservation with and without availability, automatic refresh in both directions without mutating the prior state, and explicit refresh object identity. Assert complete `{ choice, resolved }` values, not only the resolved string.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npx vitest run tests/edit-target.test.ts`

Expected: FAIL because `resolveEditTargetState` and `refreshEditTargetState` are not exported.

- [ ] **Step 3: Implement the pure state operations**

Add the exact interfaces in `src/edit-target.ts` while retaining `resolveEditTarget` until Task 3. Use a narrow automatic branch and return the explicit state unchanged from refresh. Do not read Obsidian state or add capture/writer responsibilities to this module.

- [ ] **Step 4: Run the tests and confirm GREEN**

Run: `npx vitest run tests/edit-target.test.ts`

Expected: all tests pass, including both automatic directions and explicit object identity.

- [ ] **Step 5: Commit**

```bash
git add src/edit-target.ts tests/edit-target.test.ts
git commit -m "refactor: add maintained edit target state"
```

---

### Task 2: Pure Markdown Lookup and Existing Writer-Guard Evidence

**Files:**
- Modify: `src/main.ts:567-630`
- Test: `tests/main.test.ts`
- Test only: `tests/note-writer.test.ts`
- Test only: `tests/selection-editor.test.ts`

**Interfaces:**
- Preserves existing public host methods `getActiveNotePath()`, `captureChatContext()`, `captureSelectionEditTarget()`, and writer callback behavior.
- `getTargetMarkdownView()` becomes read-only; `rememberActiveMarkdownView()` remains the explicit updater.

- [ ] **Step 1: Add lookup-purity and lifecycle tests**

Add behavior-only tests proving: repeated target reads do not replace the explicitly remembered Markdown view; active-leaf-change and file-open explicitly update the non-active Markdown target; and the remembered still-open view wins over leaf iteration order when chat has focus. Do not add a production getter for `lastMarkdownView`.

Add a main-level full-note guard integration test: submit context for A through `requestChatCompletion` with a valid loopback Operations response while actual target lookup resolves B. Keep disk and every open A editor equal to captured source. Expect the exact stale error, one provider fetch, zero `vault.modify`, zero native replacement, and unchanged A/B bytes.

- [ ] **Step 2: Run the new tests and capture expected results**

Run: `npx vitest run tests/main.test.ts -t "target"`

Expected: repeated-read purity FAILS on the old getter after reads cache A; lifecycle and wrong-target characterizations pass on unchanged source. No test accesses a real vault or network.

- [ ] **Step 3: Mutation-check explicit lifecycle ownership**

Temporarily remove the `rememberActiveMarkdownView()` call from the shared `refreshChatTargetNotes` callback. Rerun the lifecycle test. Expected RED: after B becomes active and then chat has focus, lookup falls back to stale A instead of B. Restore immediately and rerun; expected PASS.

- [ ] **Step 4: Make lookup pure**

Delete both assignments inside `getTargetMarkdownView()`. Return the active view, the still-open remembered view, or the local `foundView`. Do not change `rememberActiveMarkdownView`, event registrations, `readNoteEditorTexts`, `createVaultNoteWriter`, or Selection adapter guards.

- [ ] **Step 5: Run focused lookup and writer suites**

Run: `npx vitest run tests/main.test.ts tests/note-writer.test.ts tests/selection-editor.test.ts`

Expected: all pass. Confirm existing active-target-change, target-view-switch, and immediate-abort writer cases remain green.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/main.test.ts
git commit -m "refactor: make Markdown target lookup pure"
```

---

### Task 3: One Resolved State for Display, Capacity, and Capture

**Files:**
- Modify: `src/chat-view.ts`
- Modify: `src/edit-target.ts`
- Modify: `tests/helpers/chat-view-public-fixture.ts`
- Modify: `tests/chat-view-public.test.ts`
- Modify: `tests/chat-view.test.ts`
- Modify: `tests/quick-actions.test.ts`
- Modify: `tests/request-isolation.test.ts`
- Modify: `tests/main.test.ts`

**Interfaces:**
- Consumes Task 1’s `EditTargetState`, `resolveEditTargetState`, and `refreshEditTargetState`.
- Replaces both private fields with `private editTarget: EditTargetState`.
- Preserves `CapturedDraftTarget` and existing coordinator/writer signatures.
- Extends only the public fixture with `setSelectedText(text: string): void` and `emitWorkspaceEvent(name: 'editor-change' | 'editor-selection-change'): void`. The fixture computes current offsets per capture, makes `hasUsableSelection` dynamic, and throws `Select non-whitespace text first.` for empty, whitespace-only, collapsed, or missing Selection. It must not expose view state.

- [ ] **Step 1: Extend the public fixture and add required behavior characterizations**

Add public tests for: maintained automatic/explicit targets through same-note refreshes and Chat/Edit switches; automatic reset on note changes and preservation across session switches; automatic target/capacity refresh on Selection changes without requests/writes; fail-closed maintained auto/explicit Selection disappearance before submit; original captured Selection identity across deferred initial save and later target refresh; captured full-note/Selection source-path mismatch rejection; and abort of captured Selection on note switch without rerouting or late save.

The deferred-save test must hold first `appendReadyMessage`, clear/re-resolve current Selection through same-note `refreshTargetNote()`, then release save. Assert `requestSelectionEdit` receives original snapshot and adapter object, original additional-note paths, and no Full-note request.

Add or migrate explicit Full-note routing coverage: with usable selected text, choosing **Edit · Full note** calls `captureChatContext` and `requestChatCompletion` only; automatic Selection calls `captureSelectionEditTarget` and `requestSelectionEdit` only.

- [ ] **Step 2: Migrate every touched legacy case to the public suite**

Delete each case below from `tests/chat-view.test.ts` and preserve its observations in `tests/chat-view-public.test.ts`, using DOM/provider/store boundaries instead of private fields. Parameterized names retain each row.

1. `applies %s atomically with one render and capacity calculation`
2. `applies $title atomically with its targeting policy`
3. `retains the explicit target and maintained Web choice through Edit and Chat`
4. `retains Chat and Edit targeting policies across unrelated writing and mode choices`
5. `rejects stale menu and submission callbacks after rerender and close`
6. `blocks submissions and duplicate choices during a deferred save without rerendering`
7. `initially displays Selection when automatic targeting has usable text`
8. `initially displays Full note for an empty or whitespace selection: %j`
9. `preserves explicit $choice targeting across renders and Chat/Edit switches`
10. `resets to auto only for real note changes while preserving per-note drafts`
11. `updates automatic Selection-first targeting without replacing composer DOM or reloading chat`
12. `keeps Related notes available in Chat and enables every quick action in Edit`
13. `changes target state without requests or content reads and preserves the draft`
14. `synchronizes Edit controls after quick-action Selection capture fails and preserves the draft`
15. `formats full-note summaries against the captured note source`
16. `renders a full-note summary with no bullets`
17. `keeps explicit Full note on the ordinary request despite a usable selection`
18. `fails closed without messages, saves, or fallback when %s Selection capture fails`
19. `aborts Chat Selection on a note switch and resets all target policies`
20. `uses the complete full-note source instead of the bounded Markdown window`
21. `uses the captured Selection snapshot and updates when the Edit target changes`
22. `keeps small Selection quick actions enabled while the full note is over capacity`
23. `refreshes the automatic Edit target when the selection appears`
24. `captures the selection and additional-note paths before a deferred initial save`
25. `aborts the captured selection request on a note switch without saving it to the new thread`

Items 24–25 must be represented by the stronger public deferred-save and note-switch abort tests in Step 1, preserving original snapshot/adapter/additional-note paths, no Full-note reroute, aborted original signal, and no late new-thread save.

For unrelated legacy cases that share `createEditTargetView`, `createSelectionEditSubmission`, or `createCapacityView`, mechanically replace only fixture fields with appropriate initial `EditTargetState`. Also mechanically update pre-existing hand-built contexts in `tests/quick-actions.test.ts` and `tests/request-isolation.test.ts` from old/missing target fields to equivalent `EditTargetState` values, and complete the partial `tests/main.test.ts` host doubles needed by maintained Selection refresh (a focused `hasUsableSelection` double is acceptable where no composer exists). Do not alter those tests' bodies/assertions or migrate additional cases; these changes only keep their prior implicit Full-note/Selection setup equivalent. Do not migrate the entire legacy file.

- [ ] **Step 3: Run public characterizations before changing production**

Run: `npx vitest run tests/chat-view-public.test.ts`

Expected: existing behavior characterizations pass on baseline. Any genuine behavior discrepancy is stop-and-report, not permission to change UX.

- [ ] **Step 4: Prove the vanished-Selection test detects automatic fallback**

Temporarily change old submission branch to recompute automatic targeting from current `editTargetChoice` and `plugin.hasUsableSelection()` instead of maintained display state. Run vanished-Selection tests. Expected RED: automatic case captures Full note and reaches `requestChatCompletion` instead of producing only `Emend: Select non-whitespace text first.`; explicit case still fails closed. Restore immediately and rerun; expected PASS.

- [ ] **Step 5: Implement the single maintained state**

In `src/chat-view.ts`: replace both fields with `private editTarget: EditTargetState = resolveEditTargetState('auto', false)`; resolve menu choices once; reset on actual note change to automatic Full note without eager host I/O, followed by the normal maintained refresh; refresh through `refreshEditTargetState` before checking `composerControls`; replace every old display-field read with `this.editTarget.resolved`; keep synchronous `CapturedDraftTarget` construction and later uses unchanged; remove the now-unused `resolveEditTarget` export from `src/edit-target.ts`; remove listed legacy cases and apply only shared-fixture mechanical updates. Do not modify `CapturedDraftTarget`, writers, freshness checks, user copy, capacity formulas, persistence, or request coordination.

- [ ] **Step 6: Run focused suites and migration audits**

Run:

```bash
npx vitest run tests/edit-target.test.ts tests/chat-view-public.test.ts tests/chat-view.test.ts
npx tsc -noEmit -skipLibCheck
! rg -n 'editTargetChoice|displayedEditTarget' src/chat-view.ts tests/chat-view.test.ts
! rg -n 'EmendChatView\.prototype|Object\.setPrototypeOf|viewPrototype|productionSubmitPrompt|productionPersistMessages' tests/chat-view-public.test.ts tests/helpers/chat-view-public-fixture.ts
```

Expected: all pass and searches return no matches. Review public migration diff for dropped assertions, especially quick-action failure rendering, per-note drafts, session policy retention, capacity summaries, and no-request/no-read assertions.

- [ ] **Step 7: Commit**

```bash
git add src/chat-view.ts src/edit-target.ts tests/chat-view-public.test.ts tests/helpers/chat-view-public-fixture.ts tests/chat-view.test.ts tests/quick-actions.test.ts tests/request-isolation.test.ts tests/main.test.ts
git commit -m "refactor: unify edit target display and capture"
```

---

### Task 4: Real-Obsidian Edit-Target Flow Evidence

**Files:**
- Ignored local only: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored local only if needed: `test_vault/emend-selection-chat-verify/mock-provider.mjs`

**Interfaces:** No production or committed test interface. Produce ignored evidence for Stage 55.

- [ ] **Step 1: Provision and inspect established ignored harness**

Provision controller’s established harness/tools into this worktree without tracking them. Inspect current helpers and reuse existing Selection, popout, deferred-SSE, request-log, writer-log, session, and native-undo machinery. Do not copy production source from another checkout. Mechanically migrate existing ignored harness probes before running any group: `displayedEditTarget` → `editTarget.resolved`, and `editTargetChoice` → `editTarget.choice`; this is required by existing `focusChat`, mode/target helpers, and session-state assertions. Add focused `--edit-target-flow` group using only synthetic notes, loopback OpenAI-compatible SSE/CORS, and dummy SecretStorage credentials.

- [ ] **Step 2: Add state, popout, and vanished-Selection scenarios**

Implement `01-note-session-mode-target-state`, `02-popout-automatic-selection-native-undo`, and `03-vanished-selection-fail-closed`. Cover explicit target/session/mode/draft retention, real-note reset and per-note drafts, no I/O on control-only transitions, non-active/popout capture with exact Selection offsets and native undo/redo, auto/explicit vanished-Selection failure before messages/requests/saves/writes, and intentional Full-note submission only after maintained automatic refresh.

- [ ] **Step 3: Add wrong-target and writer-routing scenarios**

Implement `04-wrong-target-stale-abort` and `05-full-note-versus-native-selection-routing`. Exercise actual full-note and Selection wrong-target guards, Stop/note-switch late-candidate rejection, exact A/B bytes and result persistence, explicit Full-note versus native Selection request/writer routing, Selection Default/full-note supporting context, concise target labels, and native undo/redo. Do not alter or unify different existing freshness checks.

- [ ] **Step 4: Build and run deterministic verification**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
```

Expected: all pass; root/loaded `main.js` SHA-256 match and summaries record `loadedBundleMatchedRoot: true`. Record exact head, bundle identity, scenario/assertion counts, sanitized request/writer evidence, screenshots where useful, platform, Obsidian version evidence, and limitations. Do not commit harness, evidence, generated bundles, local credentials, or vault content.

---

### Task 5: Canonical Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ROADMAP.md`
- Create: `devel_docs/55-edit-target-flow.md`
- Include: `docs/superpowers/plans/2026-11-23-emend-2-11-pr02-edit-target-flow.md`

- [ ] **Step 1: Update current ownership documents**

In `AGENTS.md`, record one maintained `EditTargetState` driving display/capacity/quick actions/capture; real note changes alone reset automatic targeting; capture occurs once and explicit/vanished Selection never falls back; Markdown lookup is pure and last-active changes only through explicit lifecycle tracking; writer/freshness contracts remain separate.

In `IMPLEMENTATION_PLAN.md`, update current context/composer and edit boundaries and add Stage 55, `Resolved edit-target flow and pure target lookup`, to numbered index. Do not change historical Stage 39/44/49/51/54 text.

In `ROADMAP.md`, add Stage 55 to recently shipped status and remove only completed #78 deferral. Keep #76, #77, #79, and unrelated deferrals unchanged. Do not modify user guides unless implementation changes user-facing behavior.

- [ ] **Step 2: Create Stage 55 with actual evidence**

Include base/branch/scope/exclusions; exact design; public migration inventory and remaining legacy policy; genuine RED and restored-mutation evidence; focused/full gate results with actual totals; real scenario/assertion results and root/loaded bundle identity; Linux/Xvfb, Obsidian version, default theme, CDP input, loopback provider, dummy-credential limits; explicit exclusions and no unexercised coverage claims.

- [ ] **Step 3: Run documentation checks and commit**

Run repository local link/anchor audit for every changed document and `git diff --check`. If no scripted audit exists, manually verify every changed relative link and heading anchor and record honestly.

```bash
git add AGENTS.md IMPLEMENTATION_PLAN.md ROADMAP.md devel_docs/55-edit-target-flow.md docs/superpowers/plans/2026-11-23-emend-2-11-pr02-edit-target-flow.md
git commit -m "docs: record resolved edit target flow"
```

Confirm generated bundles, vault content, evidence, and local settings remain untracked.

---

### Task 6: Exact-Head Gate, Independent Review, and Submission

**Files:** Review complete base-to-head diff; only review-driven fixes may add commits.

- [ ] **Step 1: Run final focused audit**

```bash
npx vitest run tests/edit-target.test.ts tests/main.test.ts tests/chat-view-public.test.ts tests/chat-view.test.ts tests/note-writer.test.ts tests/selection-editor.test.ts
! rg -n 'editTargetChoice|displayedEditTarget' src/chat-view.ts tests/chat-view.test.ts
git diff --check
```

- [ ] **Step 2: Run full local gate on exact submitted head**

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

- [ ] **Step 3: Repeat real-Obsidian verification on exact head**

Rebuild after documentation changes embedded build identity, reinstall only generated plugin files into ignored synthetic vault, rerun `--edit-target-flow`, `--sessions`, and `--stabilization`, and assert final root/loaded bundle identity. Record these ultimate exact-head results in the SDD ledger and PR body/check evidence, not by recursively editing committed Stage 55. Stage 55 retains the code-head evidence produced in Tasks 4–5.

- [ ] **Step 4: Perform fresh independent whole-PR review**

Give fresh reviewer complete base-to-head diff, plan, issue #78, and actual evidence. Require separate spec-compliance, quality, and write-path/security verdicts. Verify no second resolution/capture path, no Selection fallback, pure lookup/effective lifecycle, note/session/mode/popout pinning, deferred-save identity, wrong-target/stale/abort no-write/no-reroute, no scope creep, public-test integrity, and accurate docs/evidence. Resolve every Critical/Important finding and rerun affected plus full gates and relevant real scenarios.

- [ ] **Step 5: Check submission boundary**

```bash
git status --short
git diff --name-only 8adbc7729469881b6bdeb245fa1b817bb71de6df..HEAD
git diff --name-only 8adbc7729469881b6bdeb245fa1b817bb71de6df..HEAD -- package.json package-lock.json manifest.json versions.json CHANGELOG.md .github
git ls-files main.js test_vault
```

Expected: clean tracked worktree; only scoped files; no version/workflow files; no generated bundle or vault files tracked.

- [ ] **Step 6: Submit and stop at human gate**

```bash
git push -u origin feature/2.11-pr02-edit-target-flow
gh pr create --base main --title "refactor: unify edit target flow" --body "Resolves #78. Unifies maintained Edit-target state and captured submission identity, makes Markdown target lookup pure, and preserves existing writer/UX semantics. Includes public behavior migrations and full gates. Stage 55 records code-head evidence; this PR body records the ultimate exact-head Linux loopback results without recursive documentation commits."
gh pr checks --watch
```

Do not merge, close unrelated issues, tag, publish, or begin PR 03 automatically. Update #78 only from actual merged scope and leave #76/#77/#79 untouched.

## Non-Goals

- Redesigning or unifying Full-note and Selection freshness contracts (#77).
- Consolidating Markdown scanners (#79).
- Extracting a modification controller or otherwise decomposing `chat-view.ts` (#76).
- Changing target choices, menu labels, notices, capacity formulas, context policies, session semantics, or persistence.
- Adding a new writer, fallback provider, review UI, automatic edit, background request, or runtime dependency.
- Migrating unrelated legacy chat-view tests beyond explicit inventory and required shared-fixture state shapes.
- Committing real-Obsidian harnesses, generated bundles, evidence, credentials, or vault content.
- Version metadata, tags, releases, workflows, or Community Directory work.
- Claiming real-provider, physical-input, screen-reader, macOS/Windows, or unexercised Obsidian/popout-edge coverage.

## Decisions Left to Implementers

- Internal organization of public test helpers, provided specified fixture interface and prohibition on private view access remain intact.
- Least invasive way to drive real scenarios with existing harness helpers after inspecting provisioned ignored harness.
- Exact ignored evidence filenames and screenshots, provided final-head/request/writer/undo/bundle assertions are preserved.
- Cleanup of imports made unused by explicit migrations only.

Any characterization failure that exposes a current behavior difference is a stop-and-report condition, not approval to broaden PR 02.
