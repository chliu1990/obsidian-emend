# Stage 59: Actionable in-token Selection rejection

## Status, base, and scope

Implemented on `feature/2.11-pr06-in-token-rejection` from merged PR 05 base `7385e532d904ed83845249132ff7f2e255f217c1`. The production, test, and real-Obsidian evidence head is `362f3921e393b554977ffc0c5a292d2ac0dc31f2`; Task 4 adds documentation only. This is current 2.11 scope for [#88](https://github.com/chliu1990/obsidian-emend/issues/88), not release metadata or a claim that the PR has merged.

| Commit | Subject | Scope |
| --- | --- | --- |
| `1df4aa2` | `docs: plan actionable in-token rejection` | Focused behavior, safety, verification, and documentation plan. |
| `8882d26` | `fix: allow terminal edit validation failures` | Default-correctable validation classification and terminal correction-loop handling. |
| `362f392` | `fix: make in-token selection rejection actionable` | Strict raw-token Selection classification, exact guidance, and public UI/privacy coverage. |

The change preserves the initial explicit provider request and rejects only a changed candidate that has already failed composed complete-note CriticMarkup validation. It does not reject at capture or preflight, merge pending cards, accept or reject markup, alter Operations or delimiters, add a writer or review UI, or change Full-note Edit policy. Freshness, persistence, request identity, target capture, rendering, and both writers retain their existing owners. Historical Stages [37](37-minimal-edit-ranges.md), [51](51-2-10-stabilization.md), and [54](54-public-chat-view-test-seam.md)–[58](58-modification-controller.md) remain unchanged.

## Current behavior and exact recovery copy

Only after `prepareCriticMarkupEdit(snapshot.fullText, composedFullText)` rejects the composed complete note, a nonempty captured Selection satisfying strict containment in any existing raw insertion, deletion, substitution, comment, or highlight token throws `EditResponseValidationError` with code `in-token-selection` and `correctionEligible: false`. Substitution coverage includes both old and new sides; raw token ranges include their delimiters.

The exact user-visible error is:

```text
This selection is inside a pending tracked change. Accept or reject that change in Track Changes first, then try again. No edits were applied.
```

The composer displays that error and its Notice; command-palette Modify Selection displays the Notice and recovers its controls without creating a chat exchange. The initial provider request has already completed. The terminal path skips only the impossible automatic correction, its continuation and retry callback, target freshness reads, and writes. It does not suppress context loading, capacity checks, or the initial request.

The user must accept or reject the pending change through the separate Track Changes plugin, then make a fresh Selection and submit a new request. Selecting a whole pending card does not make ordinary Operations follow-up editing or deterministic pending-card merging work. Track Changes remains the only review surface.

## Chosen design and rejected alternatives

The chosen design classifies the failure at validation time. Existing validation errors default to correction-eligible, and only this strict composed Selection rejection opts out. This preserves model-correctable failures and legitimate no-op candidates without moving CriticMarkup policy into the shared Markdown scanner or adding another range API.

The rejected alternatives were:

- **Preflight rejection before context loading or networking:** this would avoid the initial provider cost but would incorrectly forbid source-valid `[]` and unchanged-replacement no-ops, change capacity/context sequencing, and reject before a candidate exists.
- **Keep the correction and improve only final copy:** this would retain the cost and latency of a correction that cannot produce the requested strict in-token tracked edit.
- **Convert the rejection to `{ applied: false }`:** this would misleadingly turn a rejected changed candidate into the ordinary `No changes were needed.` success result.

## Exact interface and correction contract

`EditResponseValidationCode` now includes `'in-token-selection'`. The new options and error property are:

```ts
export interface EditResponseValidationOptions {
	readonly correctionEligible?: boolean;
}

// On EditResponseValidationError:
readonly correctionEligible: boolean;

// At the end of the existing constructor initialization:
this.correctionEligible = options.correctionEligible ?? true;
```

The constructor's fourth parameter is `options: EditResponseValidationOptions = {}`. Existing codes and call sites therefore remain correction-eligible by default. `correctionEligible` is not added to formatted model diagnostics, and the terminal in-token error never reaches `formatEditValidationFeedback`.

`prepareEditResponse` narrows its existing catch condition without changing the two-round loop:

```ts
if (
	round === 1 ||
	!(error instanceof EditResponseValidationError) ||
	!error.correctionEligible
) {
	throw error;
}
```

For a first-round terminal error, this rethrows the same error object and does not invoke `onRetry`, append assistant/user continuation messages, format feedback, make a second request, or return preparation or usage. Every other candidate-validation failure retains its existing one same-provider correction. If a correctable first candidate fails and the corrected changed candidate then reaches strict in-token composed rejection, the sequence ends after two requests and one correction with no third request.

## Exact strict-containment predicate

`src/selection-editor.ts` uses the existing parser and captured snapshot, with no I/O or mutation:

```ts
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

The predicate runs only inside the existing composed-note validation catch. A true result throws the new terminal error; a false result preserves the existing `compiled-markup-rejected` error and copy. The parser catch is only a conservative classification fallback and does not replace source validation.

All offsets are JavaScript UTF-16 code-unit offsets into `snapshot.fullText`, matching both the parser and editor snapshot. No Unicode, whitespace, or line-ending normalization occurs.

## Predicate and boundary matrix

| Selection geometry or candidate | Current classification |
| --- | --- |
| `from > token.start && to < token.end`, and the composed changed candidate is invalid | Terminal `in-token-selection`; one request when reached on round zero, no correction, freshness read, or write. |
| Selection equals the token's complete textual content | Strictly inside the raw token; terminal classification after composed rejection. |
| Selection includes only part of a delimiter but reaches composed validation | Also strictly inside the raw token; terminal classification. |
| `from === token.start` or `to === token.end` | Not strict; existing source, Operation, composed validation, and correction behavior. |
| Exact raw token range `[token.start, token.end]` | Not strict; existing whole-token behavior, including delimiter rejection where applicable. |
| Selection crosses the opener or closer | Not strict; generic composed rejection retains one correction. |
| `to === token.start` or `from === token.end` | Adjacent, not inside; valid existing edits remain valid. |
| Wholly before, after, or outside every token | Existing behavior unchanged. |
| Enclosing Selection targets only text outside a pending token | Existing valid edit remains valid; the original token stays byte-for-byte intact. |
| One Selection spans multiple tokens without strict containment in one token | Existing generic path; no broader multi-token redesign. |
| Nested or malformed original markup | Predicate returns false on parser failure; existing sanitized source/composed errors remain authoritative. |
| Empty or collapsed Selection | Existing capture rejection; the predicate also returns false. |
| Source-valid strict Selection with `[]` or unchanged replacement | No composed rejection; ordinary successful no-op result. |
| Delimiter fragment rejected by selected-source validation, even with `[]` or unchanged replacement | Existing `EditSourceValidationError` remains authoritative; no in-token reclassification. |
| Malformed JSON or another correctable invalid Operation | Existing correction remains available because a later valid no-op is possible. |
| Full-note Edit | Not examined by this predicate; existing correction behavior unchanged. |

## Error, no-op, usage, and privacy semantics

| Outcome | Result and usage | Requests, retry, freshness, and persistence |
| --- | --- | --- |
| Strict in-token changed candidate rejected | Throws `in-token-selection`; no `SelectionEditResult` and no returned usage. | One initial request when reached on round zero; no `onRetry`, continuation, target freshness read, or write; visible error/Notice; no ready assistant or usage persisted. |
| Strict Selection returns source-valid `[]` | `{ applied: false, changeCount: 0 }` and ordinary `No changes were needed.`; exact one-round usage returned. | One request; no correction, freshness read, or write; ready concise result and usage may persist normally. |
| Strict Selection returns a source-valid unchanged replacement | Same ordinary successful no-op semantics as `[]`. | Same as `[]`. |
| Other first-round candidate-validation failure | Existing correction behavior. | One `onRetry` and second same-provider request; aggregate usage only on a returned result. |
| Corrected candidate succeeds | Existing applied or no-op result. | Successful-attempt reasoning and all-round usage retained. |
| Provider, abort, stale, capacity, permission, read, or write failure | Existing terminal behavior. | No new correction or result semantics. |

The in-token rejection is not a successful no-op. Its copy says `No edits were applied.`, while an ordinary valid no-op says `No changes were needed.`. A rejected changed candidate never becomes a no-op merely to avoid an exception.

Raw candidates, correction feedback, rejected reasoning, source snapshots, full annotated responses, and rejected usage do not enter ready chat content, later provider history, or saved aggregates. The originating ready user message remains subject to the existing normal save behavior. The new message contains no raw candidate or diagnostics. Command-palette Modify Selection remains notice-only and creates no chat persistence.

## Genuine TDD and unit/static evidence

The baseline was 57 test files and 2,071 passing tests. RED runs used new tests against the then-current production before the corresponding implementation.

| Task | Command or gate | Observed result |
| --- | --- | --- |
| Task 1 RED | `npx vitest run tests/edit-validation.test.ts tests/edit-response.test.ts` | **3 failed / 29 passed**. The new eligibility and terminal-loop cases failed before implementation. |
| Task 1 GREEN | Same focused command | **32/32 tests passed**. |
| Task 1 full | `npm test` | **57 files / 2,075 tests passed**. |
| Task 2 RED | `npx vitest run tests/selection-editor.test.ts tests/chat-view-public.test.ts tests/selection-modal.test.ts` | **9 failed / 193 passed** (202 total). Strict token cases still received correctable generic rejection; public view and modal each made two requests instead of one. Production `selection-editor.ts` was unchanged at RED. |
| Task 2 focused GREEN | `npx vitest run tests/edit-validation.test.ts tests/edit-response.test.ts tests/selection-editor.test.ts tests/chat-view-public.test.ts tests/selection-modal.test.ts` | **5 files / 234 tests passed**. |
| Task 2 affected regression | `npx vitest run tests/critic-markup.test.ts tests/operation-edit-strategy.test.ts tests/modification-controller.test.ts tests/request-isolation.test.ts tests/edit-freshness.test.ts tests/note-writer.test.ts` | **6 files / 332 tests passed**. |
| Task 2 full | `npm test` | **57 files / 2,092 tests passed**. |
| Task 2 static/diff | `npx tsc -noEmit -skipLibCheck`, focused ESLint, and `git diff --check` | Passed. |

The selection matrix covers insertion with UTF-16 offsets, deletion, both substitution sides, comment, highlight, both valid no-op forms, delimiter-source precedence, correction-then-terminal behavior, non-strict generic correction, exact whole-token and multi-token boundaries, malformed source, adjacent edits, and enclosing-Selection token preservation. Public-view coverage uses the shared real `EmendChatView` fixture and real Selection coordinator; modal coverage uses the real coordinator. Assertions cover exact copy, request/continuation counts, retry callbacks, freshness and writer absence, unchanged snapshots, control recovery, history/persistence privacy, and usage semantics.

## Independent implementation and evidence reviews

| Gate | Result |
| --- | --- |
| Focused-plan builder review | Approved after preserving the enclosing-Selection control, source-valid no-op wording, and correction-then-terminal coverage. |
| Task 1 spec-compliance and quality reviews | Clean PASS, no findings. |
| Task 2 spec-compliance, quality, and write-security reviews | Clean PASS, no findings; strict geometry, no preflight overreach, valid boundaries, no extra request/freshness I/O, and no privacy leakage checked. |
| Task 3 evidence and write/privacy reviews | Clean PASS, no findings. |

These completed reviews concern the plan, production/test implementation, and runtime evidence. No independent documentation-review result is claimed here.

## Real-Obsidian loopback verification

Task 3 built and exercised exact head `362f3921e393b554977ffc0c5a292d2ac0dc31f2`. Every green runtime summary reports root and loaded `main.js` SHA-256 `ce255be329a385f29e2b62fd7a8c9d45bd4c1d80790b7ce3c8b12b9d91ec19ec`, with setup identity matched and `loadedBundleMatchedRoot: true`.

The executed commands were:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --in-token-rejection
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

| Runtime group | Passed scenarios | Assertions | Failures |
| --- | ---: | ---: | ---: |
| `--in-token-rejection` | 5/5 | 62 | 0 |
| `--stabilization` | 6/6 | 55 | 0 |
| `--modification-controller` | 6/6 | 73 | 0 |
| `--markdown-scanner` | 10/10 | 318 | 0 |
| `--edit-freshness` | 24/24 | 227 | 0 |
| `--edit-target-flow` | 5/5 | 95 | 0 |
| `--sessions` | 9/9 | 156 | 0 |
| **Total** | **65/65** | **986** | **0** |

The focused five-scenario group observed:

1. Exact composer error and Notice after one SSE request, no continuation, no target-note freshness read or writer call, unchanged bytes, sanitized saves/history, released same-note lock, actual Track Changes acceptance, then a fresh valid Selection Edit with exact markup and native undo/redo.
2. The inherited enclosing-Selection success case, preserving the original pending token byte-for-byte with one native replacement and exact undo/redo.
3. A source-valid strict `[]` response returning `No changes were needed.` with exact one-round provider usage, no freshness read or write, and unchanged bytes.
4. Crossing-opener generic rejection followed by a valid correction: two requests, one correction, preserved token bytes, one native outside insertion, and exact undo/redo.
5. Command-palette strict rejection with exact Notice, one request, recovered controls, no write or chat exchange, and unchanged bytes.

The inherited groups re-ran their stabilization, controller, scanner, freshness, target, session, lock, abort, stale-source, persistence-privacy, and writer/undo checks against this same bundle. Target-note read assertions excluded unrelated instruction and additional-note reads; later Chat history assertions did not mistake legitimate current-note context for persisted provider history.

### Negative control

The negative control was a **failing harness assertion control**, not a production mutation or product failure. It reported **4 passed / 1 failed with 34 assertions** and is separate from the 65-scenario green matrix.

### Runtime environment and limits

Evidence used Debian 13 x86_64, Node **20.19.2**, npm **9.2.0**, the official Obsidian **1.15.0** AppImage, separately installed Track Changes **2.3.0**, isolated Xvfb/CDP, and Obsidian's default dark theme. Notes and Operations were synthetic. Provider traffic used only loopback OpenAI-compatible SSE/CORS mocks with dummy SecretStorage credentials.

No real provider, real account, paid call, private note, external provider request, or real credential was used. These results do not establish macOS, Windows, mobile, physical OS-level input, screen-reader/assistive-technology, other Obsidian-version, or real-provider behavior. CDP-dispatched input is not physical keyboard or pointer coverage. Bundle identity proves that the harness loaded the root bundle, not behavior in an unexercised environment.

## Issue disposition and remaining limitations

Issue **#88 may close only when this PR merges**. Until then it is implemented current 2.11 scope, not a released or merged issue closure.

Changed Operations strictly inside a pending token remain intentionally unsupported; this stage improves their diagnosis and avoids only the impossible correction. The initial provider request and its cost remain. Other correctable failures can still spend the existing correction before a corrected changed candidate reaches terminal in-token rejection.

Issue **#37 remains deferred** for deterministic pending-card addressing and net-suggestion merging. This stage does not make whole-card follow-up editing work. Issue **#48 remains deferred** beyond the existing single correction for correctable candidate-validation failures; no configurable retry, user-driven correction feedback, or partial application was added. Track Changes remains separate and is the only Accept/Reject review surface.
