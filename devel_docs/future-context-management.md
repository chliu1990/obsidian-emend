# Context management: implemented accounting, deferred compression

## Status and scope

**Implemented in [Stage 42](42-context-accounting-capacity.md):** per-provider capacity settings, a live estimated-input meter in the composer and Modify Selection modal, shared request-character accounting, hard submission preflight, and a per-fetch transport guard. Those behaviors are current Emend behavior and are specified there; this document no longer describes them as future work.

**Still deferred:** automatic context compression, including the configurable threshold with a default of **75%**. It is not implemented in the current release, and it must not be added as an incidental change to another feature. The remainder of this document is the actionable design for that deferred work.

Current behavior remains authoritative elsewhere: read-only chat uses bounded note context, full-note Edit sends the complete captured note, and Modify Selection sends the complete selection plus bounded surrounding context. Over-capacity requests now fail before networking instead of being truncated. Existing provider-reported usage and the clearly labeled character-based estimate are unchanged.

## Implemented baseline (Stage 42)

Do not re-implement or contradict these; extend them only through the compression design below.

- `contextWindowTokens` and `outputReserveTokens` are nullable positive integers per provider, with a persisted `contextCapacityInvalid` marker. Both values are required together; `window − reserve` must be positive. Both empty with no marker disables checks. Partial, equal, and reversed pairs keep their entered values and mark the configuration invalid; malformed values are dropped and also mark it invalid. A settings edit resolves the full pair, and both cleared keeps a persisted invalid marker. Emend invents no model limits and makes no model-metadata or pricing request.
- Effective input capacity is `contextWindowTokens − outputReserveTokens`. The output reserve is local accounting only and is never sent as `max_tokens`.
- Accounting sums UTF-16 characters for the system prompt, user prompt, formatted history, tool continuations, and tool declarations, then estimates `max(1, ceil(characters / 4))` per nonempty category. This is a predictive approximation, not a tokenizer, billing data, or proof that a request will fit.
- Read-only, full-note, and Selection submissions preflight the assembled request after fresh additional-note/instruction reads and an abort check. Every provider fetch — later Web main rounds, extractor/verifier/refine rounds, and the single Edit correction round — re-checks the same rule. Aborts win, and invalid or exceeded capacity is terminal with no retry, correction, partial answer, or write.
- The composer and selection modal show an accessible **Draft estimate** with folded per-category details. It excludes loaded instructions/skills, additional-note contents, and later Web/correction rounds, and blocks Send, the affected quick actions, and keyboard submission at or above capacity or with invalid settings. The exact submission check remains authoritative.
- Full-note Edit and Modify Selection are never silently truncated: an oversized request fails with a capacity error that directs the user to a smaller selection or target, and no writer runs.

## Goals for the deferred compression work

- Compress only at a deliberate, configurable threshold, with a default threshold of **75%** of effective input capacity.
- Explain the privacy and provider-cost consequences of compression before it occurs.
- Never silently truncate full-note Edit input. If the complete edit request cannot fit even after eligible compression, fail without writing and direct the user to Modify Selection.
- Keep the Stage 42 guards as the final authority: compression is an optimization before the existing preflight, never a replacement for it.

Compression must never be a free local transformation. Its design and UI must state:

- exactly which content will be sent (for example older ready chat history or eligible read-only note context);
- that the selected provider receives that content and that the extra request may incur provider cost;
- whether the user must confirm each compression or has explicitly enabled automatic compression for later submissions; and
- that compressed summaries and resulting request content follow the same local-persistence and privacy rules as other chat data.

## Deferred settings

These settings do not exist today and must not be normalized or displayed until compression is implemented:

- `compressionThresholdPercent`: default **75**, bounded and validated, always below hard capacity.
- `automaticContextCompression`: default off until the user explicitly enables it and acknowledges that compression sends content to the selected provider in an additional request.

Compression settings must remain per provider, alongside the implemented capacity pair, and follow the same normalization discipline: preserve valid user values, surface invalid or conflicting combinations visibly, and never invent limits from provider names.

## Threshold surface

Show compression at or above the configured threshold, not at hard capacity. The threshold presentation must reuse the existing meter's estimated input, effective capacity, and per-category breakdown, and it must state that the threshold is a percentage of estimated capacity rather than an exact token boundary.

Below the threshold, keep the current estimate presentation. At or above hard capacity, keep the current hard block; compression cannot override it with an unvalidated or over-budget result.

## Compression behavior and privacy

No background compression is allowed. Work starts only after an explicit user submission, uses the captured target and per-note pending guard, and is abortable. A changed note, provider, mode, draft, or target invalidates the pending plan. Do not compress credentials, malformed/stopped/error messages, private full edit responses, or arbitrary vault files.

Compression must be deterministic about provenance. Label summaries as AI-generated, retain enough source metadata to distinguish them from original user/assistant messages, and never present them as provider-verified facts. Failure, cancellation, stale state, or an over-budget compression result leaves the original conversation and note untouched and permits retry. Do not silently fall back to dropping content.

The existing Stage 42 rules continue to apply after compression: rebuild the request, re-run the preflight against the compressed assembly, and let the per-fetch transport guard judge every later Web, reader, or correction round. A compressed request that still exceeds capacity fails exactly as it does today.

## Full-note Edit and Modify Selection safeguards

These safeguards are implemented; compression must preserve them:

- Full-note Edit keeps its complete-source contract. Never truncate, window, summarize, or omit part of the source to make an Edit request fit. If complete source, required prompts/history, and output reserve cannot fit, reject before any edit application with a specific capacity error and no `vault.modify` call.
- History compression may reduce optional chat history only when eligible and explicitly enabled; it must not disguise an oversized complete note.
- Modify Selection continues sending the complete captured selection. Surrounding context can be reduced only within the existing target-preserving rules. If the selection itself plus required prompts/output cannot fit, fail without replacement and ask for a smaller selection.
- Read-only requests may use eligible history/note compression under the explicit policy, but omitted content must remain visible in the request breakdown. No mode may claim that the provider saw content that was actually removed or summarized.
- Existing exact offsets, stale-source/target guards, Operations validation, native undo, Track Changes behavior, and one-guarded-write rules remain unchanged.

## Implementation sequence

Steps 1, 2, 3, and 5 were delivered by Stage 42. Remaining work:

1. ~~Settings types/defaults/normalization and focused tests for independent provider limits, output reserve, and invalid capacity.~~ Done in Stage 42; compression settings remain.
2. ~~A pure request-accounting module over the actual prompt/context/history assembly with labeled category estimates.~~ Done in Stage 42.
3. ~~The accessible composer/selection display and stale-state updates without changing provider transport or submission interfaces.~~ Done in Stage 42.
4. Design the versioned summary representation and privacy acknowledgement before implementing compression, then route compression through the existing explicit submission/pending/abort architecture.
5. ~~Preflight full-note/selection capacity failures before networking, preserving write guards.~~ Done in Stage 42.
6. Update the threshold UI, guides, and real-Obsidian verification only when compression actually exists.

## Required future tests

- Compression (not yet applicable): threshold arithmetic and boundaries, default 75, eligibility rules, provenance labels, and the versioned summary shape.
- Privacy: disabled compression sends no compression request; enabling it discloses exact content and extra provider cost; no background request, credential leakage, or unapproved vault access occurs.
- Editing: an oversized full note produces no provider edit and no write even after eligible compression; complete source is never truncated; Modify Selection still replaces only its captured range and an oversized selection fails safely.
- State: compression abort/stale provider/target failure preserves conversation and note, clears pending state, and allows retry.
- Re-validation: a compressed request still passes through the Stage 42 preflight and per-fetch transport guard, and a still-oversized result fails exactly like today.
- Integration: real Obsidian checks for threshold display, live updates, visible estimated labels, no-write behavior, and reload persistence.

Stage 42's own accounting, meter, preflight, and blocking tests already exist; do not duplicate them here.

## Out of scope for this roadmap item

Online search, provider model-discovery calls, pricing lookups, automatic credential changes, tokenizer downloads, and silent context deletion remain separate or prohibited work. See [Deferred roadmap: web search](future-web-search.md).
