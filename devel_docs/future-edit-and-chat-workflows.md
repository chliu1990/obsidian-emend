# Future edit and chat workflows

Status: deferred design register recorded on 2026-11-12. These are not current behavior or approval to implement without focused designs and PRs.

## Selection-focused read-only chat — issue #51

Track: https://github.com/chliu1990/obsidian-emend/issues/51

### Problem

In Emend 2.8.0, selecting text and asking Ask/Discuss/Brainstorm to focus on it does not reliably communicate that intent to the model. Read-only requests currently receive bounded note context centered on the selection or caret, but the prompt does not explicitly identify a selected region as the conversation's focus.

### Deferred behavior

- [ ] Capture the exact usable selection synchronously for read-only submissions and label it as the user's current focus in the prompt.
- [ ] Preserve complete selected text even when it exceeds the ordinary context budget; use the existing smart or symmetric selection-context builders for surrounding text rather than silently truncating the target.
- [ ] Keep Ask/Discuss/Brainstorm writer-free. A selection in these modes changes conversational focus only and must not route to either edit writer.
- [ ] Define behavior for empty, whitespace-only, vanished, multiline, and over-budget selections, including whether the visible control falls back to the full note or asks the user to reselect.
- [ ] Preserve current note switching, per-session history, additional-note privacy, capacity checks, and selection editing semantics. Do not reuse the model's answer as permission to edit.
- [ ] Add prompt-assembly and real-Obsidian tests that inspect actual provider messages and prove the model receives an explicit focus label, complete selection, bounded surroundings, and no unintended note write.

### Open design questions

- Whether selection focus is automatic whenever usable text exists or needs an explicit read-only target control.
- How much surrounding context is useful for discussion without making the answer revert to the whole note.
- Whether the selected region is shown in the composer before submission.

## Edit-failure feedback and bounded retry — issue #48

Track: https://github.com/chliu1990/obsidian-emend/issues/48

### Problem

Structural Markdown safeguards intentionally reject unreviewable Operations, especially around tables. Current behavior permits exactly one automatic correction for candidate-validation failures; provider, stale-source, abort, permission, and write failures are terminal. The issue requests configurable retries and raises partial application as a possible way to recover from failures in different locations.

### Deferred behavior

- [ ] Design a user-visible, bounded retry policy for candidate-validation failures, including a conservative default, a hard upper bound, all-round usage, and a clear terminal result after exhaustion.
- [ ] Return bounded allowlisted diagnostics to the same provider without exposing credentials, unrelated note content, or unbounded source excerpts.
- [ ] Preserve exact original snapshots, atomic candidate validation, occurrence/overlap checks, Stage 38 structural guards, and the current stale/target/abort/permission checks on every attempt.
- [ ] Keep provider transport failures, stale-source/target failures, aborts, and writer failures outside the correction loop unless a separate explicit policy justifies otherwise.
- [ ] Do not enable partial application by default. Any partial-edit design must first define how valid and rejected ranges coexist in Track Changes, how remaining failures are presented, and how retries avoid compounding earlier annotations.
- [ ] Test table-heavy failures, correction exhaustion, all-round usage, Stop/retry, source changes between attempts, no-write rejection paths, and real-Obsidian accept/reject bytes.

### Open design questions

- Whether additional attempts are user-initiated, automatic, or require per-request confirmation because of cost and latency.
- Whether retry count replaces or extends the current single correction.
- Whether partial application is ever compatible with Emend's atomic, fail-closed edit guarantees; it is not assumed to be desirable.

## Delivery boundaries

- Keep #51 and #48 in separate focused PRs with independent review and real-Obsidian verification.
- Do not weaken current fail-closed Operations validation, add silent retries, add another writer, or bypass capacity guards.
- Disclose provider usage/cost implications before increasing model-call counts.
