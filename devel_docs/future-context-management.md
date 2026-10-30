# Deferred roadmap: context management

## Status and scope

This is an actionable design for a later change, not a description of current Emend behavior. Context-window/output-reserve settings, a context-cost progress bar, and automatic context compression are **not implemented** in the current release. Do not add them as incidental changes to another feature.

Current behavior remains authoritative: read-only chat uses bounded note context, full-note Edit sends the complete captured note, and Modify Selection sends the complete selection plus bounded surrounding context. Existing provider-reported usage is shown only when a valid response supplies it; otherwise the completed request and response receive clearly labeled character-based estimates.

## Goals

- Make context capacity visible before a request without presenting estimates as provider billing data.
- Configure capacity per provider and reserve output space explicitly.
- Compress only at a deliberate, configurable threshold, with a default threshold of **75%**.
- Explain the privacy and provider-cost consequences of compression before it occurs.
- Never silently truncate full-note Edit input. If the complete edit request cannot fit, fail without writing and direct the user to Modify Selection.

## Proposed settings and accounting model

Add normalized, per-provider settings rather than one global limit:

- `contextWindowTokens`: a positive integer supplied by the user for the configured provider/model.
- `outputReserveTokens`: a positive integer reserved for the response and included in the request's output limit where the provider supports it.
- `compressionThresholdPercent`: default **75**, with a bounded validated range.
- `automaticContextCompression`: default off until the user explicitly enables it and acknowledges that compression sends content to the selected provider in an additional request.

Capacity is provider- and model-specific. Emend must not invent limits from provider names, silently reuse another provider's limits, or add model-metadata/pricing network calls. Preserve valid user overrides through settings normalization and keep API keys in SecretStorage.

Define the effective input capacity as `contextWindowTokens - outputReserveTokens`. Reject invalid or nonpositive capacity in settings and before submission. The progress calculation must include the complete system prompt, loaded instructions/skills, note or selection context, retained ready history, current user input, and output reserve. Avoid double-counting text that appears in more than one assembled component.

Provider-reported usage and estimates serve different purposes:

- **Provider usage** comes only from a complete valid usage triplet returned by that provider. It describes the completed request and remains labeled `Provider usage`.
- **Estimated usage** is a predictive or fallback character-based calculation and remains labeled `Estimated`. It is not exact tokenizer output, billing data, or proof that a request will fit.
- A pre-submit progress bar necessarily uses an estimate until a provider-specific local tokenizer is deliberately added. Display that basis next to the bar and never convert an old response's usage into a claim about the current draft.
- Keep the existing completed-message footer semantics. A progress bar supplements it; it does not replace provider-reported totals or alter persisted usage schema without a versioned migration.

## Progress-bar contract

Show a compact accessible bar near the composer and selection submission controls. Use separate segments and a textual breakdown for:

1. system prompt plus instructions/skills;
2. note or selection context;
3. retained ready chat history;
4. current user prompt; and
5. reserved output.

A condensed presentation may group note/history/user into one input segment, but its details must retain the separate values. Include total estimated input, effective input capacity, threshold, and output reserve in text so color is not the only signal. Update synchronously from captured/draft state where possible, without provider requests or vault scans. Mark values stale when mode, provider, target note, instructions, selection, or draft changes until recomputed.

Below the threshold, show normal capacity usage. At or above it, show the configured compression action if enabled and eligible. At or above hard capacity, disable only the affected submission and explain the required remedy; do not wait for a provider rejection or an edit response before protecting the note.

## Compression behavior and privacy

Compression is an additional provider operation, not a free local transformation. Its design and UI must state:

- exactly which content will be sent (for example, older ready chat history or eligible read-only note context);
- that the selected provider receives that content and that the extra request may incur provider cost;
- whether the user must confirm each compression or has explicitly enabled automatic compression for later submissions; and
- that compressed summaries and resulting request content follow the same local-persistence and privacy rules as other chat data.

No background compression is allowed. Work starts only after an explicit user submission, uses the captured target and per-note pending guard, and is abortable. A changed note, provider, mode, draft, or target invalidates the pending plan. Do not compress credentials, malformed/stopped/error messages, private full edit responses, or arbitrary vault files.

Compression must be deterministic about provenance. Label summaries as AI-generated, retain enough source metadata to distinguish them from original user/assistant messages, and never present them as provider-verified facts. Failure, cancellation, stale state, or an over-budget compression result leaves the original conversation and note untouched and permits retry. Do not silently fall back to dropping content.

## Full-note Edit and Modify Selection safeguards

Full-note Edit has a non-negotiable complete-source contract:

- Never silently truncate, window, summarize, or omit part of the source to make an Edit request fit.
- If complete source, required prompts/history, and output reserve cannot fit, reject before any edit application with a specific capacity error. No `vault.modify` call is permitted.
- History compression may reduce optional chat history only when eligible and explicitly enabled; it must not disguise an oversized complete note.
- The error should direct the user to select a smaller range and use **Modify selected text with AI**. Modify Selection is the fallback workflow, not permission to truncate an oversized selection.

Modify Selection must continue sending the complete captured selection. Surrounding context can be reduced or compressed only within the existing target-preserving rules. If the selection itself plus required prompts/output cannot fit, fail without replacement and ask for a smaller selection. Existing exact offsets, stale-source/target guards, Operations validation, native undo, and Track Changes behavior remain unchanged.

Read-only requests may use eligible history/note compression under the explicit policy, but omitted content must remain visible in the request breakdown. No mode may claim that the provider saw content that was actually removed or summarized.

## Implementation sequence

1. Add settings types/defaults/normalization and focused tests for independent provider limits, output reserve, invalid capacity, and the 75% default.
2. Add a pure request-accounting module that consumes the actual prompt/context/history assembly and returns labeled category estimates. Test boundary arithmetic, zero/empty components, Unicode, and no double counting.
3. Add the accessible composer/selection progress display and stale-state updates without changing provider transport or submission interfaces.
4. Design the versioned summary representation and privacy acknowledgement before implementing compression. Route any compression through the existing explicit submission/pending/abort architecture.
5. Add preflight full-note/selection capacity failures before networking where reliably detectable, preserving all current write guards and exact no-write errors for stale states.
6. Update current guides, architecture documentation, and real-Obsidian verification only when each behavior actually exists.

## Required future tests

- Unit: per-provider normalization, output reserve, 75% default and boundaries, estimated-versus-provider labels, category totals, threshold crossing, hard-capacity rejection, and accessibility text.
- Privacy: disabled compression sends no compression request; enabling it discloses exact content and extra provider cost; no background request, credential leakage, or unapproved vault access occurs.
- Editing: an oversized full note produces no provider edit and no write; complete source is never truncated; Modify Selection still replaces only its captured range, and an oversized selection fails safely.
- State: compression abort/stale target/provider failure preserves conversation and note, clears pending state, and allows retry.
- Integration: real Obsidian checks for live draft/mode/provider updates, visible estimated labels, full-note no-write behavior, selection fallback, reload persistence, and Track Changes.

## Out of scope for this roadmap item

Online search, provider model-discovery calls, pricing lookups, automatic credential changes, and silent context deletion remain separate or prohibited work. See [Deferred roadmap: web search](future-web-search.md).
