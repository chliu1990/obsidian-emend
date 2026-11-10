# Per-query Web retrieval reader design

## Intent

Replace Emend's fixed 40,000-character shared Web retrieval pool with independent, user-configured output budgets for each Search/Fetch call. Every retrieval result is inspected by a bounded AI reader that extracts information relevant to a reviewable extraction goal rather than blindly summarizing or hard-truncating content. This preserves useful evidence across more queries while keeping every tool response bounded and making provider cost, privacy, and incomplete-results behavior explicit.

This revises open PR #47 before merge. Later feature branches remain paused until the revised PR is reviewed and merged.

## Goals

- Let the user configure one output-character cap applied independently to each Search or Fetch call.
- Invoke a separate AI extraction reader for every Search/Fetch call, regardless of raw result size; the main answering model receives no raw retrieved content.
- Give the reader a concise, reviewable `extractionGoal` supplied with the main model's Search/Fetch call so it extracts goal-relevant information rather than producing a generic summary.
- Let the reader inspect full temporary retrieval content through bounded local grep/read tools rather than receiving one giant prompt or truncating unread content.
- Return compact, source-labelled extracted facts and verbatim evidence whose complete serialized tool response is within the per-call cap.
- Preserve actual-result citations, sequential retrieval, Review/Auto behavior, Stop/abort, sanitized errors, read-only notes, and bounded provider activity.
- Include every reader model round in usage accounting and disclose possible extra provider charges.
- Preserve schema-2 conversation data and persist only existing sanitized ready-message content, citations, and activity metadata.

## Non-goals

- No independent total retrieval-character setting and no fixed 40,000-character shared pool.
- No hardcoded assumption that every provider/model has a 1M-token context window.
- No generic/blind summarization, automatic retry of a failed reader, raw-content fallback, silent answer degradation, or alternative provider.
- No note writer, vault access for the reader, background request, AI session naming/summary, or automatic context compression.
- No new third-party retrieval provider or provider-metadata/pricing request.
- No raw retrieval/request/tool-payload persistence.
- No real-provider verification; use only loopback mocks and dummy credentials.

## Anti-goals

- Truncating a reader response to make it fit.
- Sending raw retrieval of any size to the main answering model, including after reader failure.
- Treating reader-generated text as trusted instructions or inventing sources/citations.
- Allowing per-query budgets to bypass the later per-provider context-capacity safeguards.
- Adding an unbounded agent loop, arbitrary code execution, or a general browsing agent.

## Chosen approach and alternatives

### Chosen: bounded per-query AI extraction reader

Keep full retrieved content temporarily in memory. For every Search/Fetch result, start a separate reader using the same configured DeepSeek provider/model. The reader receives the current user question, reviewed query/URL, reviewed extraction goal, and source catalog, then uses local literal-grep and ranged-read tools to inspect evidence. Its final closed-JSON response is validated and returned to the main Web loop only if it is within the user cap.

This best matches the requested independent-agent behavior, makes extraction consistent for small and large results, and avoids hard-truncating content the reader never inspected.

### Alternative: one-shot summarizer

Send raw results to one structured AI request. Simpler and cheaper, but large inputs still require preselection or chunking. Rejected because it cannot reliably honor the no-hard-truncation goal for arbitrarily large retrieval and does not provide query-driven inspection.

### Alternative: chunked map-reduce

Summarize every source/chunk independently and combine the summaries. Provides systematic coverage but uses more calls and cannot revisit evidence based on earlier findings. Rejected in favor of goal-driven inspection.

## Budget model

Add a per-provider-independent setting, tentatively named `maxWebContentCharactersPerCall`:

- Default: **20,000 characters**, chosen by the user.
- Normalize to a finite integer; proposed builder-owned UI range is **1,000–100,000**, with malformed values restored to 20,000.
- The current unit is explicitly **characters**, not tokens. Isolate all cap checks and output-length calculations behind one measurement interface that returns both the value and its unit. Do not present the existing `ceil(characters / 4)` usage estimate as an exact tokenizer.
- When a compatible local tokenizer is deliberately added, use exact token length for this boundary and expose a token-denominated setting/migration with the unit visible in settings and diagnostics. Unknown model tokenizers must not silently borrow another model's encoding. This PR implements only the token-ready interface and character fallback, not a tokenizer dependency.
- Apply the same cap to Search and Fetch.
- The cap covers the complete serialized tool message returned to the main model, including source IDs, titles, URLs, extracted facts/evidence, JSON punctuation, and diagnostic fields—not just extracted prose. It is a maximum, not a target length.
- Remove the existing shared `WEB_CONTENT_BUDGET`, shared-pool skip behavior, and its `contentBudgetExhausted` warning.
- Remove the existing fixed 6,000-character Search-result and 12,000-character Fetch hard truncation. Raw content is inspected only through the reader and is never sliced to fit or passed directly to the main answering model.

For per-call cap `C` and `N` executed Search/Fetch calls, retrieval tool messages contribute at most `C × N` characters. The configured worst case is `C × maxToolCalls`; there is no separate total-cap input. The existing 1–20 model-requested call limit and atomic over-limit batch rejection remain unchanged.

The planned context-accounting PR remains responsible for checking each actual assembled provider request against the explicitly configured provider context window and output reserve. A 1M-token window may be configured by the user but must not be inferred from a model name.

## Main Web loop integration

1. The main model proposes Search/Fetch calls with a required concise `extractionGoal` alongside each query or URL. Review validates/edits the goal and target; Auto validates both without the review pause.
2. Calls execute sequentially. Raw Search/Fetch responses are parsed and held only for the current call/submission.
3. Emend creates the canonical source catalog without truncating content and invokes one reader for every call. The main answering model never receives the raw payload.
4. A valid reader response becomes the bounded tool payload and registers only the sources represented successfully in that response. Activities identify extraction and its outcome.
5. The main loop continues with the extracted-facts tool response. Terminal answering behavior remains unchanged.

Search and Fetch error behavior that is currently fatal remains fatal before extraction. Expected Fetch failures still produce explicit unread outcomes. Stop aborts retrieval, reader, and answering requests.

## Reader inputs and privacy

The reader uses the same configured DeepSeek provider/model and streaming chat transport. It receives only:

- the current ready user question captured for this submission;
- the reviewed `extractionGoal` and Search query or Fetch URL;
- a catalog of retrieved source IDs, titles, normalized URLs, and canonical-content lengths;
- bounded outputs from its local grep/read tool calls; and
- a system prompt declaring retrieved content untrusted and requiring goal-directed extraction with source-grounded output.

The user question supplies semantic context while the extraction goal focuses what to find. The reader is explicitly instructed to extract only information relevant to those inputs, not to produce a generic summary. Review/Auto disclosure states that the current user question is sent to the same provider for every reader invocation and may contain note-derived text.

For each Search result, Emend creates one canonical UTF-16 text layout containing labelled `Title`, `Snippet`, `Summary`, and `Content` fields in that order, with deterministic separators. Fetch uses the same layout with empty snippet/summary fields. The catalog lengths and all grep/read offsets refer to this canonical layout. The reader can inspect and quote any of these retrieved fields; titles and URLs are also supplied separately as metadata.

The reader must not receive the active note snapshot, note path, earlier chat history, instructions/skills, additional notes, API keys in prompts, or any vault file/content. It has no vault or note-writing dependency. Raw content is never written to conversation storage, logs, settings, or persistent files.

**Review** displays the extraction policy in the existing batch-review modal before Run: every call invokes one reader with a bounded number of model rounds and possible separate provider charges, and the reader receives the current user question plus the reviewed extraction goal. Run consents to retrieval plus readers for that batch. **Auto** skips the pause but shows the same policy in the Web tooltip/settings. No additional per-reader modal is added.

## Reader tool contract

The reader has no network tools. It may use only closed, validated local operations over the current call's temporary canonical content:

- `retrieval_grep`: case-insensitive literal search, optionally scoped to one source ID, with bounded context and bounded matches. No regular-expression execution.
- `retrieval_read`: exact source ID plus UTF-16 character offset and bounded length, returning a labelled chunk with its actual offsets.

Every argument and result is validated. Tool outputs are bounded so a reader round cannot reintroduce the full raw document into its prompt. Unknown source IDs, invalid offsets/lengths, excess calls, and oversized tool results fail the reader rather than silently widening the limits.

Builder-owned initial limits, to be pinned in tests and documented rather than exposed as more settings:

- at most **6 reader model rounds** per Search/Fetch call;
- at most **4 local tool calls per round** and **16 per reader**;
- at most **4,000 characters per local read or grep result**.

Exhausting any reader limit produces the unread-query outcome below; there is no automatic retry or raw fallback.

## Reader output and grounding

The reader's terminal response must be a bare closed-JSON object with exactly:

- `outcome`: either `evidence` or `no_relevant_evidence`; and
- `results`: an ordered array.

With `outcome: 'evidence'`, `results` is nonempty and each item contains only:

- `sourceId` from the supplied catalog;
- `extractedFacts`: a nonempty array of concise, goal-relevant factual statements supported by that source; and
- `evidence`: a nonempty array of short verbatim supporting extracts from that source's canonical text.

With `outcome: 'no_relevant_evidence'`, `results` must be empty and Emend returns an explicit no-relevant-evidence tool outcome rather than registering sources from that reader response.

Emend validates the closed shape and outcome consistency, unique known IDs, nonempty extracted-fact/evidence arrays and strings, verbatim occurrence of every extract in the corresponding canonical source, and a complete serialized main-loop tool payload within the user cap. Missing, malformed, invented, duplicated, ungrounded, or over-cap output fails closed as unread; Emend never truncates it.

The extracted payload includes the reader outcome and labels extracted facts as AI-extracted, untrusted external evidence. The main answering model continues to cite only supplied source IDs. Actual normalized source URLs remain the basis of citations; reader-written URLs do not create sources.

Reader reasoning is used only for transient request/response usage accounting. It is not appended to main-answer reasoning, displayed, or persisted, because it may contain retrieved content or evidence extracts.

## Reader failure and incomplete answers

A reader provider error, malformed output, grounding failure, or exhausted limit returns a small explicit `extraction_failed` tool outcome containing no raw content. The query's activity is failed/unread and its unextracted sources are not offered as usable evidence.

Every abort—including Stop, note switch, chat close, view close, or another existing request-cancellation path—aborts the entire submission immediately. No abort becomes an unread-query outcome or permits the main model to continue answering.

The main model may answer from other successful evidence after a non-abort reader failure. The ready answer receives one deterministic warning stating how many queries Emend could not extract and that the answer may be incomplete. This is the user-selected degraded-answer behavior, not a silent fallback. The warning persists as ordinary ready content; raw reader requests/results, reader reasoning, and transient extraction state do not persist.

Existing fatal main-loop Search errors and fatal Fetch HTTP 400/401/402/413 behavior remain unchanged.

## Over-limit graceful completion

`maxWebToolCalls` limits executed Search/Fetch calls; it does not make an over-limit conversation fail. When a proposed batch would exceed the limit, Emend executes only the first remaining calls in model order and skips the excess. All proposed arguments are validated first. Review presents only the executable calls for editing/consent; skipped calls perform no retrieval or reader work.

The continuation preserves every proposed call ID. Executed calls use their reviewed arguments and ordinary extracted/failed outcomes; each skipped call receives only a small `call_limit_reached` tool outcome and skipped activity. After the allowed executions, Emend makes exactly one forced terminal main-model request with Web tools removed and an instruction to answer from the current note/chat and successfully gathered evidence without further retrieval. A provider response attempting more tools at this boundary is malformed and fails without retrieval.

The forced answer is a ready answer whenever the provider completes normally, even if no evidence was gathered. It must acknowledge missing evidence rather than inventing retrieval or citations. Only successfully extracted sources remain available. The forced round and all selected reader rounds participate in ordinary all-round usage, and all aborts still cancel the whole submission.

The transient result includes `skippedWebCalls: number` (ordinary chat returns zero). For `N > 0`, ready chat appends exactly one additional warning: `Web retrieval reached the <limit>-call limit. N proposed calls were skipped; the answer may be incomplete.` with singular `1 proposed call was skipped`. It can coexist with unread-Fetch and extraction warnings and persists as ordinary sanitized content. Exactly reaching the limit without an excess proposal produces no warning.

## Usage, activity, and persistence

- Reader rounds are included in the existing all-round provider-versus-estimated usage calculation. Provider-sourced usage requires complete valid triplets from every main and reader model round; otherwise all rounds are independently estimated and labelled Estimated.
- Retrieval Search/Fetch charges and reader model charges are not priced or invented.
- Folded activity may record extracting/completed/failed outcomes and reader-round counts without raw content.
- Only sanitized ready answer content, actual-source citations, query/URL/outcome activity, main-answer reasoning, and usage persist through existing schema 2. Reader reasoning, extracted tool payloads, and verbatim evidence extracts remain transient and are not persisted directly.

## Settings and migration

The new per-call setting is non-secret local plugin data. Existing `maxWebToolCalls` keeps its 1–20 normalization and limits executed Search/Fetch calls as specified above. No credentials move out of SecretStorage, and sanitized settings saves continue to write blank API-key fields.

There is no conversation-schema migration. The PR1 shared-budget flag/warning is removed before it ever reaches a merged release, so no compatibility path is needed for unreleased `contentBudgetExhausted` data. Current documentation and Stage 40 are rewritten to describe the final per-call reader behavior rather than layering contradictory contracts.

## Verification

Write regression tests first and record RED→GREEN evidence for:

- settings default, normalization, independent per-call cap, explicit character unit, token-ready measurement boundary, and no total-cap setting;
- required nonempty `extractionGoal` validation and Review editing for Search and Fetch;
- small and large Search/Fetch results each invoking exactly one reader with the current user question and extraction goal, but no note snapshot/history/instructions/additional-note leakage;
- two heavy Searches at a 20-call limit succeeding without shared-pool truncation; derived `C × N` output bounds; exact 20-call completion without a warning and 20/21 partial-execution/skipped-call completion with a no-tools final answer;
- literal grep/ranged-read validation, source/offset bounds, tool-result caps, and round/call exhaustion;
- valid source-labelled extraction, exact serialized-cap boundaries, verbatim evidence grounding, malformed/invented/duplicate/over-cap output, and no hard truncation or raw passthrough;
- unread-query outcomes with no raw fallback, one incompleteness warning, failed activity, and excluded unread sources;
- Stop/note-switch/close aborts, existing fatal retrieval errors, no automatic retry/fallback, sequential calls, and unchanged note bytes;
- Review consent text and Auto disclosure of reader cost/current-question sharing without extra review modals or requests while changing controls/loading chats;
- all-round main+reader usage and provider/estimated labels;
- sanitized schema-2 persistence/reload with no raw retrieval, reader payloads, evidence extracts, reader reasoning, or transient state.

Run the complete clean gate and real-Obsidian loopback scenarios on both supported DeepSeek models, including small and large Search/Fetch extraction, two heavy Searches at setting 20, successful grep/read extraction, reader failure, Stop/retry, Review consent, Auto, partial over-limit execution with a no-tools final answer and skipped-call warning, reload persistence, usage, citations, and unchanged notes. Use only ignored `test_vault/`, synthetic content, local mocks, and dummy credentials.

The revised PR requires fresh independent task and whole-branch reviews, green GitHub CI, and user review/merge before PR2 resumes.

## Builder-owned decisions

The implementation builder may choose focused module/file names, exact internal TypeScript and measurement interfaces, the proposed UI normalization range and reader limits above, precise accessible disclosure/warning wording, and test-fixture organization. These choices must remain within the approved budgets, privacy, extraction, failure, and no-truncation contracts and be documented in the implementation plan before coding.
