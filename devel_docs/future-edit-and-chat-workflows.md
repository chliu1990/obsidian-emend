# Future edit and chat workflows

Status: issue #51's approved behavior shipped in Stage 49; issue #48 remains a deferred design register. Deferred items are not current behavior or approval to implement without focused designs and PRs.

## Selection-focused read-only chat — shipped in Stage 49

Track: https://github.com/chliu1990/obsidian-emend/issues/51

The issue remains linked for history. Its approved Selection-focus behavior is implemented and verified in [Stage 49](49-selection-focus-and-context.md); the GitHub issue was not closed or mutated by the documentation change.

### Shipped behavior

- [x] Explicit **Chat · Selection** captures the exact usable selection synchronously and sends the complete note plus a separate complete read-only focus section; ordinary Chat remains bounded and selection alone never changes its target.
- [x] Empty, whitespace-only, or vanished focused selections require reselection with no message, save, request, retrieval, write, or ordinary-Chat fallback. Multiline, Unicode, and over-budget selections remain complete.
- [x] Chat Selection retains writer-free `ask` requests, originating-session history, additional-note privacy, capacity checks, and the existing DeepSeek Review/Auto protocol. Full-note/focus capacity includes the intentionally duplicated selection.
- [x] **Edit · Selection · Full note** and Modify Selection's per-open **Full note** choice share complete-note/target prompting while Default preserves Smart/Symmetric behavior and Operations/native replacement remain confined to the selection.
- [x] Structured request-body and real-Obsidian verification covers prompts, history/privacy/capacity, Web, fail-closed paths, native undo, exact Track Changes bytes, lifecycle races, popouts, and 240 px layouts.

No automatic Chat Selection, selection-preview/focus widget, new persisted mode/schema field, global Selection-context setting, or full-note target expansion was added.

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

- #51 shipped in its own focused PR with real-Obsidian verification; keep any #48 work in a separate focused PR with independent review and real-Obsidian verification.
- Do not weaken current fail-closed Operations validation, add silent retries, add another writer, or bypass capacity guards.
- Disclose provider usage/cost implications before increasing model-call counts.
