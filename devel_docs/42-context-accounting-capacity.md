# Stage 42: Context accounting and capacity guards

## Status and scope

Context accounting, the composer/modal **Draft estimate**, and hard capacity safeguards are implemented on `feat/context-accounting-capacity`. Each provider has optional **Context window (tokens)** and **Output reserve (tokens)** settings; when both are valid Emend compares every assembled request against `window − reserve` before it reaches the provider, and the composer shows a live estimated input against that effective capacity.

Implemented work: per-provider capacity settings and shared accounting (`b6bfe17`, `37574f9`), assembled-request preflight (`b2823ef`), abort precedence at the transport boundary (`f43ac53`), terminal capacity failures through Web extraction (`b57b0ef`, `63bac57`), the composer meter (`ed4144a`), estimate freshness (`f9f987d`), click-time quick-action rechecks (`17345dd`), shared draft builders and live settings refresh (`bd7d77b`), review follow-ups (`e2d5d19`), per-category token labels (`35797f0`), and final merge-review polish (unified invalid copy, summary-only live region, first-Web-round disclosure, blocked-meter refresh, and terminality tests). Stale test doubles that predated the composer estimate were repaired in `c3954d0` and `ffcdb8a`; no product behavior changed in either.

This stage adds **no compression, no tokenizer, no model-metadata lookup, and no new provider request**. Estimates are predictive character-based numbers, not billing data. Automatic context compression, including the 75% threshold, remains deferred in [future-context-management.md](future-context-management.md).

## Settings and normalization

`ProviderConfig` gains three fields, stored per provider in plugin `data.json`:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `contextWindowTokens` | `number \| null` | `null` | User-supplied input+output window for that provider/model |
| `outputReserveTokens` | `number \| null` | `null` | Locally reserved response space |
| `contextCapacityInvalid` | `boolean` | `false` | Persisted "configured but unusable" marker |

Settings are entered as two numeric inputs (**Context window (tokens)**, **Output reserve (tokens)**, `min=1`, `step=1`) plus a **Clear capacity settings** button in a **Context capacity** status row. A draft pair is previewed immediately for the warning text; values persist on the input's `change` event, so typing alone never saves.

Normalization (`resolveProviderCapacityFields` in `src/settings.ts`) is deterministic:

- Both values absent/null with no marker → `null`/`null`, marker `false`: capacity checks are off.
- Both values absent/null with the persisted marker `true` → `null`/`null`, marker `true`: a broken configuration stays visibly invalid across reloads instead of silently disabling checks.
- Both positive integers with `window − reserve > 0` → kept, marker `false`; a valid pair also clears a stale marker.
- Exactly one value present → the present value is kept, the missing one stays `null`, marker `true`.
- A malformed value (string, `0`, negative, non-integer) → that value becomes `null`; a valid sibling is preserved; marker `true`. Both malformed → `null`/`null`, marker `true`.
- `window === reserve` or `reserve > window` → both values kept, marker `true`.
- Any explicit settings edit states the full pair, so it re-resolves the marker rather than inheriting it. **Clear capacity settings** writes `null`/`null` with marker `false`.

Emend never invents limits: no provider/model defaults are prefilled, no pricing or metadata endpoint is called, and one provider's values are never reused for another. The settings row, the meter, the block Notice, and the typed `ContextCapacityError` all use one authoritative sentence: `Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.`

## Effective input and the local-only reserve

Effective input capacity is `contextWindowTokens − outputReserveTokens` and must be positive; otherwise the configuration is invalid. The reserve is **local accounting only**. It is deducted from the comparison and shown in the details, but it is never sent to the provider: the transport still sends no `max_tokens` field, and existing `requestUsage`/`stream_options` behavior is unchanged.

## Shared counting

`src/context-accounting.ts` counts the request Emend is about to send, not the note alone. `countRequestCharacters` sums UTF-16 `string.length` over five categories:

1. `system` — the assembled system prompt (mode prompt, skills, and `AGENTS.md` when loaded).
2. `user` — the current assembled user prompt: instructions, note or selection context, selection surroundings, and prompt sections. Additional-note sections are counted from their prompt text.
3. `history` — the configured ready-message window after `formatProviderHistory` annotations.
4. `continuation` — tool-continuation messages, including assistant tool-call names and serialized arguments.
5. `tools` — `JSON.stringify` of the tool declarations when present, otherwise `0`.

`accountRequestCharacters` also returns `estimatedInputTokens`, the sum of `max(1, ceil(characters / 4))` per category, where a category with zero characters contributes `0` tokens. Category granularity is therefore part of the approximation: five nonempty categories can estimate higher than `ceil(total / 4)`. Text that appears in two components is counted at each occurrence rather than deduplicated.

The completed-response usage footer is unchanged: provider-reported usage is used only when a complete valid triplet arrives, otherwise the existing character-based estimate is shown and labeled **Estimated**. The draft estimate never reuses an earlier response's usage.

**Caveat:** this is not a tokenizer. Real token counts vary by model, language, and markup, so the estimate can be wrong in either direction. It is also not provider billing data.

## Preflight and transport guards

Submission guards run in this order, so invalid configuration and aborts win over capacity arithmetic:

1. `requireValidContextCapacity(provider)` runs before any await, additional-note read, instruction read, or request. An invalid pair throws the typed `invalid-context-capacity` error with the settings warning text.
2. Coordinators capture the additional-note path array, read fresh additional-note snapshots, and load current instructions/skills.
3. `signal.throwIfAborted()` runs before capacity is judged.
4. `assertRequestWithinCapacity(request, capacity, kind)` compares the assembled request with the effective input capacity using `>=`, so equality with capacity is already rejected. `unconfigured` always passes; `invalid` throws again for a configuration that changed mid-flight.
5. The provider transport re-checks the same rule at each fetch (`kind: 'transport'`) after validating the key/model/base URL and after `signal.throwIfAborted()`.

The per-fetch transport guard is what covers growth after the first request: later Web main rounds with tool continuations, extractor/verifier/refine rounds, and the single Edit correction round each pass through `requestAiResponse`, so each is checked against its own assembled body. Reader and Web capacity errors are re-thrown as capacity failures instead of being converted into `extraction_failed` or an unread page, so a Web request can never be answered from partial evidence after an over-capacity round.

The error is terminal for that submission. It is not retried, does not trigger the Edit correction round, and does not fall back to a smaller request. Guidance depends on where the guard fired:

| Kind | Guidance appended to the error |
| --- | --- |
| read-only | `Reduce context, chat history, additional notes, or Web output.` |
| full-note | `Use a smaller selection.` |
| selection | `Select a smaller target.` |
| transport | `Reduce context, chat history, or Web output.` |

The shared sentence is `This request needs about {N} input tokens, at or above the {M}-token input capacity.` Chat replaces the loading bubble's content with that error, marks it `error`, shows a Notice, persists no assistant or partial answer, and releases the pending per-note lock and Send for retry. As with any failed request, the already-ready user prompt stays in the local thread; that is existing failed-request behavior, not a capacity-specific defect, and no error text is persisted.

## Composer and modal Draft estimate

`src/context-capacity-ui.ts` builds the estimate from the **same** assembly functions used for submission, so the preview and the request cannot drift:

- read-only: `getSystemPrompt(mode, undefined)` + `buildUserPrompt(context, prompt, [])` with the bounded read-only Markdown;
- full note: the Operations full-note system prompt + `buildUserPrompt(context, prompt, [], context.sourceText)` with the complete note;
- Selection: the Operations selection system prompt + `buildSelectionUserPrompt` with the complete selection, the current smart/symmetric context setting, and the current source-character budget.

Composer estimates include the same configured ready-history window the request would send (limited by `historyMessageLimit`) and include the note path only when **Include note path** is enabled. The Command Palette modal estimates its own history-free selection request.

The estimate deliberately excludes content that is only known at submission time or only exists in later rounds:

- loaded instructions and skills;
- additional-note contents (their prompt sections appear only in the real request);
- the first Web round's Web system-prompt suffix and tool declarations (they exist only when Web is enabled for the real request);
- later Web rounds, extraction/verifier/refine rounds, and Edit correction rounds.

It also excludes the output reserve from the compared input, because the comparison is against effective input capacity; the reserve is shown in the details. The always-visible note reads: `Excluded from this estimate: instructions and skills, additional-note contents, the first Web round's system prompt and tool declarations, and later Web or correction rounds; the exact submission check remains authoritative.`

Presentation. The meter root is non-live; the persistent summary node is the only `role="status"`, `aria-live="polite"` region, labeled `Draft token estimate`, so typing updates the changed summary without re-announcing the static details or exclusion line. State classes on the root are `is-valid`, `is-unconfigured`, `is-over-capacity`, `is-invalid`, and `is-unavailable`. Its summary is one of:

- `Estimated input: {N} tokens of {M} effective capacity.`, with ` This draft is over capacity.` appended at or above capacity;
- `Estimated input: {N} tokens. Capacity checks are off.` when unconfigured;
- `Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.`
- `Draft estimate unavailable.` when no target can be captured (for example an Edit Selection draft whose selection vanished).

A folded `Estimate details` block adds `Context window: …`, `Output reserve: …`, `Effective input capacity: …`, the category line `System: N tokens · Draft: M tokens · History: H tokens · Tools: T tokens` with `Continuation: N tokens` only when nonzero, and `Total: N tokens`. Its open state survives meter re-renders. The meter and the exclusion note are plain text; no model output is rendered there.

Freshness. The composer re-estimates after composer typing, mode changes, Edit-target changes, note switches, `editor-change` and `editor-selection-change` workspace events (debounced 150 ms), additional-note store changes, and any settings save, which pushes into every open chat view without a reload. Capture is synchronous from the maintained view, so the estimate performs no vault scan, no additional-note read, and no provider request. A caret-only move changes the estimate because the read-only and Selection prompts depend on the captured caret/selection.

Blocking. A draft blocks only when the settings pair is invalid or the estimate is at/above effective capacity; unconfigured capacity never blocks, however large the draft. Blocked state disables Send, disables each quick action whose own action-prompt estimate is blocked, and makes Enter/Mod+Enter show the block Notice instead of submitting; the block path also refreshes the meter in place (without a full render) so the visible estimate and controls match the Notice. The Notice reads: `This draft is over capacity at about {N} input tokens of {M} effective capacity. Reduce the draft, chat history, or the selected target.` An invalid pair instead produces the settings warning. Submission re-estimates immediately before creating any message, so a stale enabled control or a shortcut cannot start a request that the visible state already rejects; blocked submissions make no provider call, add no message, persist nothing, and write nothing.

The exact preflight remains authoritative. A draft that fits can still be rejected once instructions, additional-note contents, or a larger assembled prompt are counted, and a request that fits can still fail later if a Web continuation or correction round grows past capacity. Both are reported as capacity errors rather than partial results.

The Command Palette **Modify selected text with AI** modal renders the same meter and exclusion line for its captured selection. It disables **Modify selection** and any blocked quick action, re-estimates with the submitted prompt on a refused submit, keeps the modal open with the draft intact, and no-ops before any request. When it is enabled, submission still uses the existing history-free selection coordinator and native writer.

## Privacy and cost

- Capacity values are ordinary non-secret per-provider settings in plugin data. They are not credentials and are not sent to the provider.
- The draft estimate runs locally. It performs no provider call, no telemetry, no tokenizer download, no model-metadata or pricing lookup, and no vault scan; additional-note content is not read to produce it.
- Estimates are approximations. They are never presented as provider billing data, and the stage adds no automatic request, compression, hidden retry, or new write path.
- The guards only reject requests. They do not alter prompts, truncate context, summarize history, or write notes; the preflight runs before any writer, and the transport guard runs before any fetch.

## Automated verification

`tests/context-accounting.test.ts` (39 tests) covers configuration resolution, category reconciliation, exact history annotation accounting, continuation tool calls, duplicate text across categories, UTF-16 length, the one-token-below boundary, equality rejection, and typed errors. `tests/context-capacity-ui.test.ts` (31 tests) covers the estimate builders against direct request assembly, bounded read-only Markdown, the note-path override, blocked classification, the summary-only live region, the display's attributes and states, continuation details, folded-state preservation, and destroy behavior. Chat-view tests (150) cover live refresh, blocked Send/quick actions/keyboard, the blocked-submission meter refresh, the safe estimate fallback, and the submission recheck; coordinator and selection tests add full-note and Selection abort-over-capacity terminality; `tests/quick-actions.test.ts` covers the click-time blocked quick action showing its Notice without submitting; modal tests cover its meter and disabled controls; settings tests cover the normalization matrix; transport tests cover the per-fetch guard; Web and extraction tests prove capacity errors stay fatal instead of degrading.

The last full local gate ran at commit `fccb3fd` (the review-polish code plus its fixture repair): **42 Vitest files and 1352 tests**, ESLint clean, `tsc -noEmit -skipLibCheck` plus the production esbuild bundle, and a clean `git diff --check`. An earlier gate at `ffcdb8a` recorded 1347 tests; the merge-review polish added the five focused terminality/refresh tests and one fixture-only repair. After the polish wave, `npm run build` at `895a219` produced bundle SHA-256 `12733ffeb44f68277fe1cea9b7c28fed956fe1595711bb22285aef2ef1efdb86`, the loaded-copy-equals-root check passed, and the focused suites, ESLint on the changed files, and `git diff --check` are clean. The loopback evidence below was produced with that exact bundle.

## Real-Obsidian loopback evidence

- Date: 2026-11-11, Asia/Shanghai; evidence summary generated `2026-11-11T09:12:00.671Z`.
- Runtime: official Obsidian **1.15.0** AppImage under isolated Xvfb `:101`, CDP `19224`, workspace `test_vault/emend-selection-chat-verify/`.
- Provider: loopback OpenAI-compatible SSE mock at `127.0.0.1:18766` plus a loopback `/v1/tools/fetch`, dummy SecretStorage credential. No real provider, account, external network, or paid call.
- Tested HEAD: `895a219`; loaded and root bundle SHA-256 `12733ffeb44f68277fe1cea9b7c28fed956fe1595711bb22285aef2ef1efdb86` (the harness asserts the loaded copy equals the root `main.js`).
- Commands: `npm run build`, then `node test_vault/emend-selection-chat-verify/verify.mjs`. Wall time 77 s.
- Result: **26/26 scenarios and 504/504 assertions passed** (348 pre-existing plus 156 capacity assertions). Scenarios 01–17 re-ran unchanged.

| Scenario | Observed capacity behavior |
| --- | --- |
| 18 draft meter states | 4000/1000 effective 3000: Ask `Estimated input: 378 tokens of 3000 effective capacity.`; typing raised it to 389; Edit full note read 941; Edit Selection read 767. **Clear capacity settings** produced `Estimated input: 767 tokens. Capacity checks are off.` Details read `System: 104 tokens · Draft: 274 tokens · History: 0 tokens · Tools: 0 tokens` and `Total: 378 tokens`; the persistent summary carried `role="status"` and `aria-live="polite"` while the meter root carried neither, and the folded-then-preserved details and new exclusion copy were asserted. |
| 19 caret-only and content freshness | A pure caret move changed `375` → `376` tokens with unchanged note bytes, proving the runtime `editor-selection-change` registration; typing 200 characters changed `136` → `186`, and native undo restored `136`. |
| 20 over-capacity blocking | 300/200 effective 100: meter `Estimated input: 374 tokens of 100 effective capacity. This draft is over capacity.`; Send and all three quick actions disabled; Enter and Ctrl+Enter consumed with the block Notice; zero provider requests, messages, or writes. |
| 21 exact preflight vs passing draft | Draft passed at `380 tokens of 381 effective capacity`; adding a 4.5 KB additional note kept the same draft and left Send enabled. Submission was rejected by the exact preflight: `This request needs about 658 input tokens, at or above the 381-token input capacity. Reduce context, chat history, additional notes, or Web output.` Zero provider requests, no assistant or error persisted, no write, both notes byte-identical. |
| 22 no-write and native undo | 6000/1000: full-note Edit performed exactly one plugin `vault.modify`; composer Selection performed exactly one native replacement, and native undo/redo restored the original and the annotated text. At 300/200 both targets showed over-capacity meters, disabled Send, consumed Enter, and left all bytes unchanged with zero requests. |
| 23 Web round growth | Probe measured 778 tokens for round 1 and 827 for the continuation. At effective 783 the first main round ran and its single fetch happened; the continuation was rejected with `This request needs about 827 input tokens, at or above the 783-token input capacity. Reduce context, chat history, or Web output.` Exactly one `/chat/completions` and one fetch, no second main round, no ready answer, no write. Raising capacity produced the terminal answer plus the unread-page warning. |
| 24 correction growth | First candidate request 580 tokens, correction 695. At effective 585 the candidate ran, the correction was rejected at the transport guard with `This request needs about 695 input tokens, at or above the 585-token input capacity. Reduce context, chat history, or Web output.` No write, pending state released, only the ready user prompt stored. Retry after raising capacity succeeded with two completion rounds and one native replacement. |
| 25 settings persistence and live refresh | Changing settings to 7000/2000 updated the open chat meter to `376 tokens of 5000` without reload; `data.json` showed `7000`, `2000`, marker `false`. A real `app:reload` restored values, marker, and meter. Invalid 2000/2000 showed the settings warning and live meter `Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.`, blocked Send and Enter, and made zero requests; reload restored `contextCapacityInvalid: true`. Fixing to 8000/1000 recovered the meter, cleared the marker, and the next Ask succeeded. |
| 26 modal meter and narrow layout | Modal at effective 100: `Estimated input: 544 tokens of 100 effective capacity. This draft is over capacity.`, Modify and quick actions disabled, Ctrl+Enter refused with `Emend: This draft is over capacity at about 550 input tokens of 100 effective capacity. Reduce the draft, chat history, or the selected target.`, modal stayed open, no write. At effective 19000 it submitted one history-free request and one native replacement. A 240 px sidebar kept meter, summary, exclusion, actions, and Send inside the composer with no horizontal overflow, and Enter still submitted. |

The harness exercised only the ignored `test_vault/`, loopback mocks, and a dummy credential. Four observations were recorded rather than treated as defects: the ready user prompt persists after an exact-preflight rejection (existing failed-request behavior); category units are the `35797f0` form pinned above; correction-growth guidance is the transport wording because that guard fires first; and Obsidian 1.15.0 renders settings in a separate renderer without an `app` global, so the harness reads state from the main window. The settings warning and invalid meter now share the single authoritative sentence quoted in scenario 25.

## Unverified items

- Linux only. Windows and macOS were not exercised, and keyboard input used trusted CDP-dispatched events in the live composer rather than physical OS-level typing.
- No real provider, account, credential, external network, or paid call was used; no tokenizer, exact-token, or billing claim is made.
- Web and correction growth were exercised on the loopback mock. The probe technique derives capacities from observed wire bodies and assumes the documented per-category `max(1, ceil(chars / 4))` estimate with empty chat history (set to 0 for that block, restored to 8 afterward).
- The narrow-layout evidence is geometric (`scrollWidth`/`clientWidth` and bounding boxes), not a visual review of every glyph.
- Unit tests, not real Obsidian, cover the full normalization matrix (including malformed, equal, and reversed pairs), zero-length categories, duplicate text across categories, and the `Continuation:` details line.
- The reader refine-branch test remains parked for a future reader-focused pass; current extraction tests cover the verifier/refine loop at the coordinator level.
- No compression, threshold behavior, or compressed-summary persistence exists to verify; those remain deferred.
