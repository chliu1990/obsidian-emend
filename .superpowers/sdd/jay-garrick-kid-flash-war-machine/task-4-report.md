# Task 4: Guarded Full-Note and Selection Integration

## Implementation

- `src/request-coordinator.ts`: replaced the Edit coordinator's private content accumulation, single provider call, direct `prepareEdit`, and single-round usage resolution with `prepareEditResponse({ original, request, editStrategy, requestRound, signal, onReasoning })`. The existing `applyPreparedEdit` writer path and all stale/target/abort/permission guards remain unchanged. `EditRequestResult` still returns the helper's aggregated `usage`.
- `src/selection-editor.ts`: replaced the selection coordinator's duplicated provider/prepare block with the same writer-free helper, using exactly `snapshot.selectedText` as the original. The existing `applyPreparedSelectionEdit` path still performs the only `editor.replaceRange` at captured offsets. Its public `EditResult` and selection UI remain unchanged; helper usage is intentionally discarded.
- No changes were made to `src/edit-response.ts`, `src/note-writer.ts`, `src/main.ts`, read-only coordination, web routing, production UI, styles, manifests, or dependencies.

## Test coverage

- `tests/request-coordinator.test.ts`: invalid-to-valid correction with one minimal-markup write; identical complete source, prompt, additional-note context, and history across rounds; one-time context/instruction loading; provider usage summation; independent mixed/missing usage estimation; second-round provider/abort failures with no read/write; and exact stale-source error preservation.
- `tests/selection-editor.test.ts`: invalid-to-valid correction against exactly the captured selection; one minimal `replaceRange` at original offsets with no target expansion or public result change; one-time context/instruction loading; second-round provider/abort failures; and terminal stale-source/target-switch behavior.
- `tests/request-isolation.test.ts`: same-note locking while the correction provider call is pending, independent-note progress, and lock release/retry after final validation, second-round abort, and post-correction stale failure. Existing additional-note-only invalid responses now explicitly supply and expect two validation rounds with zero writes.
- `tests/chat-view.test.ts`: real Edit coordinator plus chat view integration proving one loading entry becomes one concise ready Edit summary with two-round provider usage; invalid response, typed diagnostics, and operation payloads are absent from persisted ready messages and later provider history.
- `tests/selection-modal.test.ts`: real coordinator integration holding the second provider call, proving input, quick actions, and additional-note controls remain disabled until final validation settles and recover afterward without replacement.
- `tests/operation-edit-strategy.test.ts`: final out-of-selection validation performs only the two allowed rounds and no editor read/replacement.
- Old exact-one-call assertions were changed only for typed validation failures that now correctly trigger the single correction round.

## Explicit RED/GREEN evidence

### RED

Command:

```bash
npx vitest run tests/request-coordinator.test.ts tests/selection-editor.test.ts tests/request-isolation.test.ts tests/chat-view.test.ts tests/selection-modal.test.ts tests/operation-edit-strategy.test.ts
```

Observed before production changes: **5 failed files, 1 passed file; 17 failed tests, 245 passed tests (262 total)**. All 17 new correction-flow cases failed for the expected missing behavior: the coordinators stopped after the first invalid response, so no second provider call occurred. This included direct `EditResponseValidationError` failures, expected second-round provider/abort errors not being reached, correction-lock waits timing out, and the chat/modal tests observing one provider call instead of two. No test setup or compilation error caused the RED run.

### GREEN

After integrating `prepareEditResponse`, the same command initially left only five failures: three old exact-one-call assertions, two one-shot invalid-response mocks that needed a second invalid response, and one new read-only chat mock that needed to emit its normal content callback. After those test-only corrections, the identical focused command produced:

- **6 passed test files**
- **262 passed tests, 0 failed**
- Duration: 726 ms

## Full verification

- `npm test`: **34 passed files, 695 passed tests, 0 failed**; duration 934 ms; pristine output with no errors or warnings.
- `npm run build`: passed `tsc -noEmit -skipLibCheck` and the production esbuild bundle; exit 0.
- `npm run lint`: passed ESLint; exit 0.
- `git diff --check`: passed; no whitespace errors.

## Self-review

Reviewed the complete diff for every touched source and test file. Both coordinators call the shared helper before their separate existing writer functions exactly once per submission. The full-note path retains aggregated usage; selection discards it and returns only the existing `EditResult`. Captured full-note source/selection text and prompts are unchanged between rounds except for the helper's continuation. No content callback was added to either edit path, so invalid responses, correction feedback, and operation payloads remain private. Existing final abort, stale source, active target, permission, and native-range guards were not moved or weakened. The pending lock remains outside the coordinators and is held until the helper and final application settle.

The working tree already contained a `.gitignore` modification before Task 4. It was preserved and excluded from the Task 4 staging set. No generated files were added.

## Concerns

None. Verification is automated only, as requested by the brief; no real-Obsidian or real-provider calls were made.


## Fix round 1: rejected-attempt reasoning

### Change

- `src/edit-response.ts`: added optional `onRetry?: () => void`. It fires exactly once after the first candidate throws `EditResponseValidationError` and before the correction request is constructed and sent. Valid first attempts and terminal second attempts do not fire it.
- `src/request-coordinator.ts`: added the optional callback to the full-note Edit submission callback contract and forwarded it to `prepareEditResponse`. Selection behavior and its public result remain unchanged.
- `src/chat-view.ts`: the full-note Edit `onRetry` callback clears `loadingMessage.reasoning` and schedules a rerender. Live reasoning still streams normally for both attempts; only the rejected attempt's accumulated reasoning is cleared, leaving the successful attempt's reasoning on the ready persisted message. No retry-status UI or all-round buffering was added.
- `.gitignore` was preserved and excluded from staging.

### Covering tests

- `tests/edit-response.test.ts`: verifies `onRetry` occurs after first validation and before round two, and is not called for a valid first response.
- `tests/request-coordinator.test.ts`: verifies the full-note coordinator forwards the callback between provider rounds while preserving live reasoning callbacks.
- `tests/chat-view.test.ts`: streams distinctive `INVALID_ROUND_REASONING` and `VALID_ROUND_REASONING` sentinels and asserts complete persisted user/assistant messages, including IDs, timestamps, roles, content, reasoning, mode, source path, status, and usage. It also checks invalid-round reasoning remains absent after a later ready request.
- `tests/selection-editor.test.ts` and `tests/selection-modal.test.ts`: run as unaffected-selection regressions.

### RED evidence

Command:

```bash
npx vitest run tests/edit-response.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts
```

Before production changes: **3 failed files; 3 failed tests, 103 passed tests (106 total)**. The helper and coordinator spies observed zero retry notifications. The chat integration observed ready reasoning `INVALID_ROUND_REASONINGVALID_ROUND_REASONING` instead of only `VALID_ROUND_REASONING`, directly reproducing the reported leak.

### GREEN and final verification

After the focused production change, the same covering command produced **3 passed files, 106 passed tests, 0 failed** (656 ms).

Additional selection regression command:

```bash
npx vitest run tests/selection-editor.test.ts tests/selection-modal.test.ts
```

Result: **2 passed files, 56 passed tests, 0 failed** (674 ms).

Final project gates after all code/test changes:

- `npm test`: **34 passed files, 695 passed tests, 0 failed** (928 ms), with pristine output.
- `npm run build`: passed `tsc -noEmit -skipLibCheck` and production esbuild; exit 0.
- `npm run lint`: passed; exit 0.
- `git diff --check`: passed; no whitespace errors.

An intermediate lint run identified four test-only `no-unsafe-assignment` errors from reusable `expect.any(...)` fields. The exact snapshots now use the actual generated IDs/timestamps while keeping all behavioral fields literal; the final lint run is clean.

### Commit

Separate focused fix with subject `fix: discard rejected edit reasoning`; its SHA is reported in the final handoff. The pre-existing `.gitignore` modification remains unstaged.
