# Stage 37: Minimal edit ranges and guarded correction

## Status and scope

Implementation is complete on `feature/minimal-edit-ranges` for issue #23, with focused automated coverage and real-Obsidian loopback verification. Full-note Edit and Modify Selection now produce smaller review ranges, expose actionable validation diagnostics, and permit one automatic candidate-validation correction. Read-only chat and Web research are unchanged. No character-minimal diff, relaxed Operation validation, retry setting, retry delay/backoff, fallback provider, or additional writer was added.

## Review-range minimization

Full-note and selection prompts ask for the smallest complete semantic target and separate nonoverlapping operations. Deterministic post-processing then minimizes every `replace` independently of how broad the model's declared target was. `Intl.Segmenter` with undetermined-locale word granularity supplies Unicode word/segment tokens. Common token prefix/suffix trimming and a longest-common-subsequence pass preserve exact old/new text while emitting only changed regions as CriticMarkup insertions, deletions, or substitutions. The result is word-aware, not character-minimal.

One compiler is shared by all replacements in a response. Detailed LCS processing requires at most 1,000 changed-middle tokens per side, at most 250,000 per-replacement matrix work, and accumulated response work below 1,000,001. Expensive cases retain the common prefix/suffix and use one substitution for the changed middle. Missing/failing segmentation or any reconstruction mismatch also falls back safely. Insert, remove, and comment operations retain their existing compilation behavior. Validation still resolves exact original-snapshot ranges before minimization; declared-target overlap and insertion-conflict rules are not relaxed to accommodate the resulting hunks.

## Typed diagnostics and one correction round

Candidate failures use `EditResponseValidationError` with stable codes for malformed JSON/shape/operations, missing or ambiguous anchors/targets, out-of-range occurrences, overlap, ambiguous insertion, and compiled-markup rejection. Diagnostics include applicable operation/related-operation numbers, operation type, allowlisted field, match count, requested occurrence, and at most eight match lines. Unknown field names are redacted as `unknown` in retry feedback. Invalid pre-existing source markup remains a source-validation error and does not trigger correction.

`prepareEditResponse` makes at most two provider calls. After the first candidate-validation failure, it resubmits the unchanged original request to the same provider with an assistant continuation containing the invalid response and a user continuation containing bounded diagnostic feedback plus an instruction to return a complete bare JSON array against the unchanged snapshot. A second invalid response returns its precise terminal diagnostic and writes nothing. Provider errors and aborts during either round are terminal; stale-source/target and write failures happen after correction and are terminal as well. Existing pending-note isolation and final permission/source/target/abort guards remain in force, and a successful submission still performs only one full-note `vault.modify` or selection `editor.replaceRange`.

The original loading/pending state covers both rounds. Raw candidates, operation payloads, and correction feedback never appear in ready chat content or stored threads. Full-note Edit sums usage across all attempted rounds, using provider totals only when every round has valid usage and otherwise independently estimating every round. Selection editing keeps its existing result/UI and has no usage display. Full-note chat clears rejected-attempt reasoning when correction begins, so only successful-attempt reasoning is retained in the ready persisted summary; live streaming and failure behavior otherwise remain unchanged.

## Clean local gate

Run from the repository root:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: locked install succeeded; **34 Vitest files and 695 tests passed**; ESLint reported no findings; strict TypeScript and production esbuild succeeded; `git diff --check` reported no whitespace errors. The production root `main.js` from this build was copied into the isolated verification vault.

## Real-Obsidian loopback verification

- Date: 2026-11-06, Asia/Shanghai; Linux only.
- Runtime: official Obsidian 1.15.0 AppImage, Track Changes 2.3.0, isolated Xvfb `:100`, CDP port `19223`, and a synthetic vault/configuration created under ignored `test_vault/emend-minimal-edit-verify/runtime/`.
- Provider: CORS loopback OpenAI-compatible SSE mock at `127.0.0.1:18765`, fragmented content/reasoning events, controlled correction holds, per-round usage, and a dummy SecretStorage credential. No real account/key, external/paid call, private note, or pre-existing vault/profile was used.
- Final command: `node --check test_vault/emend-minimal-edit-verify/verify.mjs && node test_vault/emend-minimal-edit-verify/verify.mjs`.
- Result: **9/9 scenarios and 78 assertions passed**. Evidence: `test_vault/emend-minimal-edit-verify/evidence/summary.json`, nine screenshots, eleven sanitized request logs, `selection-native.json`, and `persisted-thread-audit.json`. Reproduction: `node test_vault/emend-minimal-edit-verify/verify.mjs`; it recreates the isolated runtime and evidence.

The final matrix covered:

1. **Invalid to valid full-note correction:** two same-provider requests preserved the original message prefix and appended exactly the invalid assistant candidate plus bounded `ambiguous-target` feedback with match count 2 and lines `[3,4]`. Occurrence 2 alone changed, one `vault.modify` occurred, and ready/stored usage was `46 total · 33 prompt · 13 completion` from rounds `17 + 29`. Only `SUCCESSFUL_RETRY_REASONING` survived; rejected reasoning, raw operations, and diagnostics were absent.
2. **Two invalid responses:** exactly two calls and zero writes. The terminal UI diagnostic was exactly `Operation 1 occurrence 3 is out of range: 2 matches are available; use an occurrence from 1 to 2.`
3. **Stop during correction:** the held second request stopped with no ready response or write; a fresh submission then used one call and one write successfully.
4. **Provider failure during correction:** HTTP 503 and the synthetic provider detail remained terminal with two calls and zero writes; a fresh submission then succeeded with one call and one write.
5. **Persisted stale source during correction:** a synthetic vault change before release produced exactly `The note changed while Emend was responding. No edits were applied.`, preserved the user's change, and applied no model markup. Restoring the synthetic source and freshly submitting succeeded with one call and one write.
6. **Invalid to valid selection correction:** two requests carried the invalid selection candidate and typed ambiguity feedback; occurrence 2 alone became `{~~red~>blue~~}`, with exactly one native `replaceRange` and unchanged outside text.
7. **Broad full-note replacements:** two broad Operations became three small Track Changes cards: `fox → cat`, `the → a`, and `beta → delta`. Unicode `café 😀` remained exact, only the explicitly selected repeated occurrence changed, and the ready summary reported three tracked changes.
8. **Broad selection replacement:** one broad Operation became two cards, `starts → begins` and `green → ripe`. One native range replacement occurred, outside text/Unicode remained unchanged, native undo restored the complete original selection, and redo restored the minimized markup.
9. **Persistence/privacy audit:** all six full-note chat threads used schema 2 and contained only ready messages and concise Edit outcomes. Unique invalid-candidate sentinels, rejected reasoning, correction instructions/diagnostics, and raw operation payloads were absent. Selection editing created no chat thread or retry-status persistence.

Windows and macOS were not exercised. No real-provider smoke was run. The final stale scenario intentionally changed persisted vault bytes; an unsaved-editor-only race was not part of this matrix. All owned mock, Xvfb, and Obsidian processes were stopped after verification.

## Self-review and remaining boundaries

The documentation was checked against `replacement-diff.ts`, `edit-validation.ts`, `edit-response.ts`, both edit coordinators, chat retry handling, and the captured runtime evidence. It distinguishes candidate-validation correction from terminal provider/abort/stale/write failures, keeps the second same-provider call and its potential cost explicit, and does not imply character-minimal output or relaxed declared-range validation. Task 5 changed documentation and ignored synthetic verification artifacts only; the user's pre-existing `.gitignore` modification was preserved and excluded from the documentation commit. Final independent whole-branch review and PR creation remain separate controller steps.
