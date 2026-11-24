# Emend 2.11.0 PR 06 Actionable In-Token Selection Rejection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox syntax and test-driven development. Use one fresh sequential implementer per task and an independent reviewer for every task.

**Goal:** Make a changed Selection candidate strictly inside an existing CriticMarkup token fail with exact actionable guidance after one provider response, without spending the impossible automatic correction, reading freshness state, writing, or weakening valid no-op and boundary behavior.

**Architecture:** Add a default-correctable validation-error classification, mark only the new strictly in-token composed-selection failure as non-correctable, and leave rendering, persistence, request locking, freshness, and writers with their current owners.

**Tech Stack:** Strict TypeScript, existing CriticMarkup parser and Operations compiler, Vitest with the real public `EmendChatView` fixture, ESLint, esbuild, and the inherited ignored real-Obsidian Linux/Xvfb loopback harness. No new dependency.

**Spec:** Approved global plan, Global Constraints and PR 06 only; [Issue #88](https://github.com/chliu1990/obsidian-emend/issues/88); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `ROADMAP.md`; Stages 37, 51, and 54–58; current source at base `7385e532d904ed83845249132ff7f2e255f217c1`.

## 1. Intent and rationale

Stage 51 H1 prevented corrupt nested markup by validating the composed complete note. That safety check works, but a Selection such as `x` in `a{++x++}b` currently produces the generic message:

```text
Compiled operations produce invalid CriticMarkup in the complete note. Preserve existing CriticMarkup tokens and do not nest markup.
```

The unchanged Selection and original snapshot are then sent through one automatic correction round. A changed candidate cannot preserve the complete original token while modifying only a strict subrange of that token, so this correction cannot produce the requested tracked edit.

PR 06 should instead:

1. Preserve the initial explicit provider request and all existing capacity/context behavior.
2. Reject the invalid changed candidate before any freshness read or writer call.
3. Recognize the narrow strictly in-token geometry using the existing parser.
4. Show exactly how the user can proceed.
5. Skip `onRetry`, continuation feedback, and the second provider request.
6. Preserve valid no-op results and all model-correctable validation failures.

This is a UX and avoided-cost fix, not pending-card merging and not a new editing capability.

## 2. Global constraints

- Work only in the PR 06 feature worktree based at `7385e532d904ed83845249132ff7f2e255f217c1`.
- Baseline: **57 test files / 2,071 tests passing**.
- Keep plugin ID, view type, command IDs, version metadata, workflows, and release files unchanged.
- Operations remain the only model-facing edit protocol.
- Chat, Chat Selection, Web research, and Related Notes remain writer-free.
- Full-note Edit retains guarded `vault.modify`; Selection Edit and Modify Selection retain only native `editor.replaceRange` on the captured range.
- Do not modify `edit-freshness.ts`, `note-writer.ts`, the native writer adapter, or their check/write ordering.
- Every other candidate-validation error retains exactly one same-provider correction with bounded private diagnostics.
- Provider, abort, stale, capacity, permission, read, and write failures retain their existing terminal behavior.
- Preserve same-note locks, ready-only history, schema-3 persistence, stale/abort/target guards, and all-round usage behavior for successful corrections.
- Raw candidates, correction feedback, rejected reasoning, source snapshots, and full annotated responses remain private.
- New chat-view tests must use `tests/helpers/chat-view-public-fixture.ts`; no private prototypes, private-field casts, hand-built view contexts, or test-only production accessors.
- Track Changes remains the only Accept/Reject surface. Add no Emend review UI or automatic installation.
- Do not claim whole-card follow-up editing. Deterministic pending-card merging belongs to PR 11 / issue #37.
- Do not bundle attribution, tables, lists/blockquotes, images, Mermaid, configurable retries, or other PRs.
- Update current ownership documents and add Stage 59 without rewriting historical stage records.
- Submit the PR and stop at the human gate; do not merge, tag, publish, or start PR 07 automatically.

## 3. Goals and non-goals

### Goals

- Add a stable `in-token-selection` validation classification.
- Mark only that classification as ineligible for automatic correction.
- Detect strict containment in any existing insertion, deletion, substitution, comment, or highlight token.
- Use exact actionable copy:

  ```text
  This selection is inside a pending tracked change. Accept or reject that change in Track Changes first, then try again. No edits were applied.
  ```

- Make one provider request, zero `onRetry` calls, zero continuation feedback, zero freshness reads, and zero writes for the rejected changed candidate.
- Preserve ordinary `No changes were needed.` results and one-round usage for valid no-op Operations.
- Preserve valid adjacent, outside, enclosing-Selection, and model-correctable boundary behavior.
- Cover composer chat, command-palette Modify Selection, persistence/history privacy, actual note bytes, and native undo where applicable.
- Close #88 only after the complete scoped behavior merges.

### Non-goals

- No rejection before the initial provider request.
- No conversion of a rejected changed candidate into a successful no-op result.
- No follow-up editing or merging of a pending card.
- No suggestion that selecting a whole card enables ordinary Operations follow-up editing.
- No change to full-note in-token candidate policy.
- No broader multi-token, overlapping-token, or malformed-source redesign.
- No parser, attribution, prompt, Operation-schema, or CriticMarkup delimiter changes.
- No configurable retry count, partial application, or user-driven correction feedback.
- No production changes expected in `chat-view.ts`, `modification-controller.ts`, `selection-modal.ts`, or `main.ts`.
- No release metadata or `CHANGELOG.md` change.

## 4. Considered approaches

### Approach A — Validation-time non-correctable classification, recommended

After the existing composed-note validation rejects a candidate, check whether the captured Selection is strictly inside one parsed raw token. If so, throw `EditResponseValidationError('in-token-selection', …)` with `correctionEligible: false`. `prepareEditResponse` rethrows it immediately.

**Advantages:**

- Preserves valid `[]` and unchanged-replacement no-op results.
- Preserves the initial request, capacity checks, context loading, provider errors, and abort ordering.
- Distinguishes impossible changed candidates from correctable boundary failures.
- Requires only three production modules.
- Leaves UI, request identity, persistence, freshness, and writers untouched.

**Costs:**

- Does not avoid the initial provider request.
- Strict Selections that fail earlier for malformed JSON or invalid selected source retain those existing classifications; the new copy is specific to composed-markup rejection.

### Approach B — Preflight rejection before provider request

Reject every strictly in-token Selection in `SelectionEditRequestCoordinator.submit` before context loading or networking.

**Advantages:** Avoids all provider cost and is mechanically simple.

**Why rejected:** It incorrectly forbids valid no-op Operations and unchanged replacements, changes capacity/context sequencing, and turns a potentially successful request into an error before any candidate exists. It also broadens the UX change beyond the proven H1 failure.

### Approach C — Keep retrying and improve only final copy, or return a no-op result

Improving copy after round 1 would still spend the impossible correction. Returning `{ applied: false }` would avoid an exception but could misleadingly persist `No changes were needed.` for a rejected changed candidate.

**Why rejected:** The first retains the cost defect; the second confuses a validation failure with a legitimate model no-op and weakens the actionable error lifecycle.

## 5. Exact proposed design

### 5.1 `src/edit-validation.ts`

Add the stable code `in-token-selection` to `EditResponseValidationCode`. Add an explicit options interface and default-correctable property:

```ts
export interface EditResponseValidationOptions {
	readonly correctionEligible?: boolean;
}

export class EditResponseValidationError extends Error {
	readonly correctionEligible: boolean;

	constructor(
		code: EditResponseValidationCode,
		message: string,
		details: EditResponseValidationDetails = {},
		options: EditResponseValidationOptions = {},
	) {
		// Existing initialization remains unchanged.
		this.correctionEligible = options.correctionEligible ?? true;
	}
}
```

The actual constructor must retain the existing `super`, `name`, code, and detail initialization; the snippet shows only the new contract. Do not add `correctionEligible` to formatted model diagnostics. The new terminal error must never reach `formatEditValidationFeedback`.

### 5.2 `src/edit-response.ts`

Narrow the existing catch condition without restructuring the loop:

```ts
if (
	round === 1 ||
	!(error instanceof EditResponseValidationError) ||
	!error.correctionEligible
) {
	throw error;
}
```

Consequences for the new error on round 0:

- rethrow the same error object;
- do not invoke `onRetry`;
- do not append assistant/user continuation messages;
- do not call `formatEditValidationFeedback`;
- do not make a second provider request;
- do not return a preparation or usage result.

Every existing error defaults to `correctionEligible: true`, preserving all current correction and usage tests.

### 5.3 `src/selection-editor.ts`

Import `parseCriticMarkup` alongside `prepareCriticMarkupEdit`. Add the exact private copy constant and a private, side-effect-free predicate:

```ts
const IN_TOKEN_SELECTION_ERROR =
	'This selection is inside a pending tracked change. Accept or reject that change in Track Changes first, then try again. No edits were applied.';

function isStrictlyInsideExistingCriticMarkupToken(
	snapshot: SelectionSnapshot,
): boolean {
	if (snapshot.from >= snapshot.to) {
		return false;
	}
	try {
		return parseCriticMarkup(snapshot.fullText).some((token) =>
			snapshot.from > token.start && snapshot.to < token.end
		);
	} catch {
		return false;
	}
}
```

The parse catch is only a conservative classification fallback. It must not replace or alter existing source-validation behavior. In `validateComposedSelectionEdit`’s existing catch, throw the new non-correctable error only when this predicate is true; otherwise throw the existing `compiled-markup-rejected` error and message unchanged. Do not export a second range API and do not move CriticMarkup policy into `markdown-scanner.ts`.

## 6. Predicate and boundary matrix

All offsets are JavaScript UTF-16 code-unit offsets into the captured `snapshot.fullText`, matching `parseCriticMarkup` and the editor snapshot. No Unicode, whitespace, or line-ending normalization occurs.

| Selection geometry | PR 06 classification |
| --- | --- |
| `from > token.start && to < token.end`, and composed changed candidate is invalid | New terminal `in-token-selection`; one request, no correction |
| Selection equals the token’s complete textual content | Strictly inside the raw token; new terminal classification after composed rejection |
| Selection includes only part of a delimiter but reaches composed validation | Also strictly inside the raw token; new terminal classification |
| `from === token.start` or `to === token.end` | Not strict; existing source/Operation/composed validation and correction behavior |
| Exact raw token range `[token.start, token.end]` | Not strict; existing whole-token behavior, including delimiter rejection where applicable |
| Selection crosses the opener or closer | Not strict; existing generic composed rejection retains one correction |
| `to === token.start` or `from === token.end` | Adjacent, not inside; valid existing edits remain valid |
| Wholly before, after, or outside every token | Existing behavior unchanged |
| Enclosing Selection targets only text outside a pending token | Existing valid edit remains valid; original token stays byte-for-byte intact |
| One Selection spans multiple tokens without strict containment in one token | Existing generic path; do not broaden PR 06 |
| Nested/malformed original markup | Parser predicate returns false; existing sanitized source/composed errors remain authoritative |
| Empty or collapsed Selection | Existing capture rejection; predicate also returns false |
| Source-valid strict Selection with `[]` or unchanged replacement | No composed rejection; ordinary successful no-op result |
| Full-note Edit | Not examined by this predicate; existing correction behavior unchanged |

A malformed JSON response or invalid Operation may still receive its normal correction because a later valid no-op is possible. If the corrected changed candidate then reaches the strict composed rejection, it becomes terminal at that point without a third request. Existing selected-source validation remains authoritative for delimiter fragments, even when the model returns `[]` or an unchanged replacement.

## 7. Error, no-op, usage, and privacy semantics

| Outcome | Result and usage | Retry and persistence |
| --- | --- | --- |
| Strict in-token changed candidate rejected | Throw `in-token-selection`; no `SelectionEditResult` and no returned usage | One request; no `onRetry`; visible error/Notice; no ready assistant or usage persisted |
| Strict Selection returns `[]` | `{ applied: false, changeCount: 0 }`; existing `No changes were needed.`; one-round usage returned | One request; no freshness reads/writes; ready concise result may persist normally |
| Strict Selection returns unchanged replacement | Same ordinary no-op semantics | Same as `[]` |
| Other first-round candidate-validation failure | Existing correction behavior | One `onRetry`; second request; aggregate usage only on a returned result |
| Corrected candidate succeeds | Existing applied/no-op result | Successful-attempt reasoning and all-round usage retained |
| Provider/abort/stale/capacity/write failure | Existing behavior | No new correction or result semantics |

The in-token rejection is **not** a successful no-op. Its copy explicitly says no edits were applied, while the ordinary no-op copy remains `No changes were needed.`. Rejected reasoning may remain part of the existing transient error message state, but it must not enter ready content, later provider history, or saved aggregates. Raw candidates and diagnostics must never appear in the new message.

## 8. File responsibility map

| File | Change |
| --- | --- |
| `docs/superpowers/plans/2026-11-24-emend-2-11-pr06-in-token-rejection.md` | Create this focused plan |
| `src/edit-validation.ts` | Add code, options, and default-correctable property |
| `src/edit-response.ts` | Respect non-correctable validation errors |
| `src/selection-editor.ts` | Add strict raw-token predicate and exact actionable error |
| `tests/edit-validation.test.ts` | Pin default and explicit correction eligibility |
| `tests/edit-response.test.ts` | Prove terminal errors skip correction; preserve generic correction/usage coverage |
| `tests/selection-editor.test.ts` | Token/boundary/no-op/request/retry/freshness/write matrix |
| `tests/chat-view-public.test.ts` | Real public-view error, history, persistence, reasoning, and request coverage |
| `tests/selection-modal.test.ts` | Real coordinator-to-modal actionable Notice and reset controls |
| `AGENTS.md` | Record the narrow correction exception and no-op invariant |
| `docs/guides/editing-and-review.md` | Document actionable user recovery and link Stage 59 |
| `IMPLEMENTATION_PLAN.md` | Update architecture contract and add Stage 59 |
| `ROADMAP.md` | Move #88 from deferred to recently shipped; retain #37 separately |
| `devel_docs/59-actionable-in-token-rejection.md` | Create current design/evidence/limits record |
| `test_vault/emend-selection-chat-verify/` | Ignored inherited harness and evidence only; never commit |

No production change is planned for `critic-markup.ts`, `operation-edit-strategy.ts`, `markdown-edit-guards.ts`, `modification-controller.ts`, `chat-view.ts`, `selection-modal.ts`, `main.ts`, request coordinators, persistence, freshness, or writers.

## Task 0: Save the plan and confirm the base

**Files:** Create this plan and initialize the SDD workspace/ledger with one todo per task.

- [ ] Confirm the worktree is at the approved base, the branch is not `main`, and the baseline is 57 files / 2,071 tests.
- [ ] Confirm there are no tracked changes from another PR and no conflicting Stage 59 file.
- [ ] Save this plan and record the decisions: validation-time classification, raw-token strict containment, exact copy, and no whole-card claim.
- [ ] Obtain an independent builder review before implementation and resolve every material finding.
- [ ] Commit only the plan with `docs: plan actionable in-token rejection`.

## Task 1: Add non-correctable validation classification

**Files:** `src/edit-validation.ts`, `src/edit-response.ts`, `tests/edit-validation.test.ts`, `tests/edit-response.test.ts`.

- [ ] **Write failing tests first.** Pin default `correctionEligible: true`, explicit false, unchanged bounded diagnostics, and a `does not correct a non-correctable validatePrepared rejection` case proving the same error object is rethrown after one request/validation with no `onRetry`, continuation, second request, or prepared result. Keep generic correction, usage, abort, and provider-error tests unchanged.
- [ ] **Run RED:** `npx vitest run tests/edit-validation.test.ts tests/edit-response.test.ts`.
- [ ] **Implement the smallest change.** Add the code/options/property and the single `!error.correctionEligible` guard. Do not alter round limits, continuation construction, reasoning callbacks, or usage resolution.
- [ ] **Run GREEN and focused regression:** focused Vitest, `npx tsc -noEmit -skipLibCheck`, focused ESLint, and `git diff --check`.
- [ ] **Independent review:** require spec-compliance and quality verdicts. Verify all existing errors default correctable, provider-thrown validation errors are not reclassified, and terminal errors never create feedback or usage results.
- [ ] Commit with `fix: allow terminal edit validation failures`.

## Task 2: Implement strict in-token rejection and behavioral coverage

**Files:** `src/selection-editor.ts`, `tests/selection-editor.test.ts`, `tests/chat-view-public.test.ts`, `tests/selection-modal.test.ts`. Regression only: CriticMarkup, Operations, modification-controller, request-isolation, freshness, and writer tests.

- [ ] **Write failing unit tests first.** Parameterize insertion, deletion, substitution old/new sides, comment, and highlight. For each changed candidate assert exact code/message/non-correctable classification, one request, zero `onRetry`/continuation, no freshness reads or writes, and byte-identical captured snapshots.
- [ ] Add valid no-op cases on ordinary source-valid token content for `[]` and unchanged replacement: ordinary no-op result, exact one-round usage, one request, no retry, no freshness reads/writes, and no in-token error. Keep delimiter-fragment source validation unchanged.
- [ ] Add the combined correction-then-terminal sequence: first malformed JSON, then a strict changed candidate; exactly two requests and one `onRetry`, terminal `in-token-selection`, no third request, freshness read, or write.
- [ ] Preserve the existing crossing-opener corrected candidate case: two requests, one `onRetry`, valid outside insertion. Move generic two-invalid-candidate coverage to a non-strict boundary so `compiled-markup-rejected` still retains correction.
- [ ] Add boundary/validity cases: exact whole raw token is not reclassified; immediately adjacent edits apply and preserve token bytes; an enclosing Selection targeting only outside text applies and preserves the token; malformed source keeps existing sanitized behavior; multi-token spans are not broadly reclassified.
- [ ] Add one real public composer test through the shared fixture and real Selection coordinator: one request/no retry, exact rendered error and Notice, controls recover without Full-note fallback, no writer/freshness call, only initial ready-user save, and following Chat history/persistence excludes the error, raw candidate, diagnostics, rejected reasoning, usage, and source snapshot.
- [ ] Add a real-coordinator Modify Selection modal test: one request, exact Notice, controls recover, no writer/freshness call or chat persistence.
- [ ] **Run RED before changing `selection-editor.ts`:** `npx vitest run tests/selection-editor.test.ts tests/chat-view-public.test.ts tests/selection-modal.test.ts`.
- [ ] Implement only the private parser predicate and new throw in `validateComposedSelectionEdit`.
- [ ] **Run GREEN and affected regressions**, then `npm test`, strict typecheck, focused ESLint, and `git diff --check`.
- [ ] Inspect public tests for forbidden private/prototype access.
- [ ] **Independent spec/quality/write-security review:** verify the exact matrix, no preflight overreach, no valid-boundary regression, no second call, no freshness I/O, and no privacy leakage. Fix Critical/Important findings through the same implementer and rerun affected suites.
- [ ] Commit with `fix: make in-token selection rejection actionable`.

## Task 3: Exercise real Obsidian through the inherited ignored harness

**Files:** Ignored `test_vault/emend-selection-chat-verify/` harness and evidence only. No tracked production or test changes unless a genuine defect receives a failing unit test, minimal fix, and scoped re-review.

- [ ] Provision the current inherited PR 05 harness, Obsidian/Xvfb tools, CORS loopback provider, dummy SecretStorage credential, and separately installed Track Changes companion.
- [ ] Add a focused `--in-token-rejection` group with deterministic Operations and request/writer instrumentation. Update the inherited H1 expectation to the new copy and one request without rewriting Stage 51.
- [ ] **Composer strict rejection and recovery:** one SSE request/no continuation, exact error/Notice, zero target-note freshness reads or writes, unchanged bytes, sanitized saves/history, then accept through actual Track Changes, make a fresh valid Selection Edit, and verify exact markup plus native undo/redo. Target-note read assertions must exclude unrelated instruction/additional-note reads; later Chat assertions concern history and persistence, not legitimate note context.
- [ ] **Inherited enclosing-Selection success:** preserve `nesting-whole` unchanged as a separate scenario with the original token byte-identical, one native replacement, and exact native undo/redo. Reset the synthetic note between it and the strict-rejection recovery scenario; change only H1's rejected-candidate copy/request expectations.
- [ ] **Strict Selection valid no-op:** one request, `No changes were needed.`, one-round usage, zero target-note freshness reads/writes, unchanged bytes.
- [ ] **Boundary correction remains available:** crossing-opener first rejection followed by valid outside insertion; two requests/one correction, original token preservation, exact undo/redo.
- [ ] **Command-palette Modify Selection:** one request, exact Notice, controls recover, zero writes/unchanged bytes/no chat exchange.
- [ ] **Lock, abort, and stale regression:** terminal error releases the same-note lock; subsequent request proceeds; Stop/abort and stale/wrong-target behavior remain unchanged.
- [ ] Build the exact production head and run `--in-token-rejection`, `--stabilization`, `--modification-controller`, `--markdown-scanner`, `--edit-freshness`, `--edit-target-flow`, and `--sessions`; require zero failures and root/loaded bundle identity.
- [ ] Inspect request logs, note bytes, writer/undo logs, saved chats, and screenshots. Record only exercised Linux/Xvfb, Obsidian, Track Changes, CDP-input, synthetic-note, loopback, dummy-credential evidence; make no real-provider or unexercised-platform claim.
- [ ] Commit no harness, vault, generated bundle, or evidence files.

## Task 4: Update canonical documentation and Stage 59

**Files:** `AGENTS.md`, `docs/guides/editing-and-review.md`, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, new `devel_docs/59-actionable-in-token-rejection.md`.

- [ ] **`AGENTS.md`:** qualify the correction invariant with the narrow terminal in-token exception; preserve valid no-op semantics and separate whole-card merging.
- [ ] **Editing guide:** document exact recovery and skipped impossible correction; require Track Changes resolution plus a fresh Selection, link Stage 59, and do not recommend whole-card ordinary Operations.
- [ ] **`IMPLEMENTATION_PLAN.md`:** update the architecture/correction contract and numbered Stage 59 index while preserving writer/freshness ownership.
- [ ] **`ROADMAP.md`:** move #88 to recently shipped with Stage 59; retain #37 and #48 deferrals.
- [ ] **Stage 59:** record base/scope, alternatives, exact interface/copy/predicate/matrix, no-op versus error semantics, genuine RED/GREEN evidence, tests, runtime commands/results, bundle identity, reviews, limits, and issue disposition. Fill actual totals only after execution.
- [ ] Do not edit historical Stages 37, 51, or 54–58, `CHANGELOG.md`, version metadata, or workflows.
- [ ] Run relative-link/anchor and stale-claim audits plus `git diff --check`; obtain independent factual documentation review.
- [ ] Commit with `docs: record actionable in-token rejection`.

## Task 5: Final gate, whole-PR review, and submission

- [ ] Re-run focused tests on the exact final head: edit-validation, edit-response, selection-editor, chat-view-public, and selection-modal.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; use `npm ci` for clean/reproducible verification when needed.
- [ ] Re-run affected real-Obsidian groups on the exact submitted head after any production/build-identity change; record the final hash.
- [ ] Inspect the complete base-to-head diff for generated files, vault artifacts, version changes, historical edits, and unrelated changes.
- [ ] Obtain fresh whole-PR spec, quality, write/security/privacy, public UX, and documentation/evidence reviews. Resolve every Critical/Important finding through the implementer/reviewer loop and rerun affected plus full gates.
- [ ] Submit only PR 06 with `Closes #88`; do not close #37 or #48.
- [ ] Stop at the human gate. Do not merge or begin PR 07.

## 9. Explicit out-of-scope and remaining issues

After PR 06, ordinary changed Operations strictly inside a pending token remain intentionally unsupported; only their diagnostics and correction behavior improve. Users must accept or reject the pending change first, then make a fresh request.

Issue **#37 remains open** for deterministic pending-card addressing and net-suggestion merging in PR 11. This PR does not make whole-card follow-up editing work and must not claim otherwise. Issue **#48 remains deferred** beyond the existing single correction for correctable candidate failures. Attribution, structural tables/lists/blockquotes, images, Mermaid, and all other release rows remain untouched.
