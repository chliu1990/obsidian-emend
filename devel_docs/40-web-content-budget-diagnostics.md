# Stage 40: Per-query Web extraction

## Status and scope

The per-query Web extraction loop is implemented and verified locally on `fix/web-content-budget-diagnostics`. It replaces the former shared retrieval pool and raw-result truncation with independent, goal-directed extraction for every readable DeepSeek Search/Fetch result. No real-provider verification, external publishing, or GitHub CI run was performed for this revision.

Stage 36's provider and read-only boundaries remain intact. Web is available only for DeepSeek `deepseek-flash` and `deepseek-v4-pro` in Ask, Discuss, and Brainstorm. Retrieval never gains a note writer, raw fallback, or fallback provider. The only transport retry is the single Task 10 Search/Fetch retry below; the extractor's single format-correction round and its verifier/up-to-two-refine rounds are bounded model requests defined below.

## Current behavior

### Calls, goals, and independent caps

- `maxWebToolCalls` defaults to 8 and normalizes to integers from 1 through 20, capping executed Search/Fetch calls rather than rejecting an over-limit batch. Every proposal is validated; only the first remaining calls execute in model order, and only those executable calls appear in Review. Skipped calls perform no Search/Fetch/reader work.
- Continuations preserve every proposed call ID, reviewed executable arguments, original skipped arguments, ordinary selected outcomes, and small capped `{"error":{"kind":"call_limit_reached"}}` outcomes for skipped calls. Skipped calls also gain persisted skipped activities.
- After any skipped calls, exactly one forced terminal main-model request omits Web tools and instructs the model to answer from current note/chat and successful evidence. A ready answer may have no evidence but cannot invent citations. Further tool calls in that forced round fail without retrieval or retry.
- Chat appends `Web retrieval reached the <limit>-call limit. N proposed calls were skipped; the answer may be incomplete.` for multiple skips, or `1 proposed call was skipped` for one. This warning occurs once, after the unread, extraction, search, and cap-omission warnings, and persists as ordinary ready content. Exact-limit completion has no skipped-call warning.
- When any Search still fails after its single retry, chat appends exactly one warning, `Emend could not complete N web search. The answer may be incomplete.` (`searches` when N > 1), after the unread and extraction warnings and before the cap-omission and skipped-call warnings. It persists as ordinary content; failed activities keep only `type`/`target`/`status`, while their `network`/`http`/`empty`/`reader` reasons render as folded activity labels and remain transient.
- When the per-call fit must drop a verified claim or a whole source result, chat appends exactly one warning, `Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.`, after the search warning and before the skipped-call warning. It persists as ordinary ready content. A quote prefix shortened to fit is not an omission: it keeps only its `truncated: true` marker.
- Every call requires a nonempty `extractionGoal` of 1–1000 Unicode code points. Review permits editing the goal and query/URL while preserving call IDs and tool names; an invalid goal blocks the batch before retrieval. Auto validates the same fields without the review pause.
- `maxWebContentCharactersPerCall` defaults to 20,000 and normalizes to integers from 1,000 through 100,000, restoring 20,000 for malformed values. It caps the complete serialized extraction tool response, including actual source metadata, verified claims, quoted evidence, truncation markers, and JSON syntax.
- Each call has an independent cap. For cap `C` and `N` executed calls, the payloads contribute at most `C × N` characters; there is no independent total retrieval-character cap.
- `measureWebContent` currently measures UTF-16 `string.length` and returns an explicit character unit behind a token-ready interface. It does not tokenize, and the separate `ceil(characters / 4)` usage fallback is an estimate rather than provider billing data.

### Reader isolation, tools, and grounding

Every readable Search/Fetch result invokes exactly one extraction and verification loop using the same configured DeepSeek provider/model and streaming transport. Canonical title, snippet, summary, and content remain temporarily available without a raw-result size cap. The extractor produces compact, question-focused claims that each carry one to four exact verbatim quotes; it does not generate unsupported facts, summaries, paraphrases, or link labels. Claims are capped at 8 per source and 24 in total before verification. One verifier pass per round, capped at three, decides only whether the supplied quotes fully support each claim. Rejected claims receive up to two no-tools refine rounds; claims that still lack support are dropped in favor of deduplicated quotes-only evidence or `no_relevant_evidence`. The main answering model never receives raw retrieval or unverified AI-generated facts; it receives only actual source metadata plus verified claims with their quotes or quotes-only evidence.

The extractor receives only the current typed question, extraction goal, reviewed target, and source catalog, followed by any bounded local tool continuations. It has empty chat history and receives no active-note snapshot/path, earlier chat, instructions/skills, additional notes, or vault content. The verifier receives only the question, goal, and numbered claims with quotes; it has empty history, no tools, no extractor continuation, and no target, note, chat, instruction, additional-note, or vault context. Every verifier request, including one after a refinement, is capped at 24,000 serialized claim characters; claims outside that budget are neither verified nor refined and fall back to their result-level quotes. Refine requests receive the reviewed target and bounded verifier reasons, with empty history and no tools. Claims, quotes, and verifier reasons are framed as untrusted external data that must never be followed as instructions. Main model rounds continue to receive their ordinary captured context. Review and Auto disclose current-question extractor sharing, extractor/verifier/refine rounds, possible separate charges, and that a transient Search or Fetch failure may be retried once.

Reader tools are local-only closed operations over temporary canonical documents:

- case-insensitive literal grep, optionally scoped to one source, with bounded matches/context;
- UTF-16 ranged read with actual offsets and bounded chunks;
- at most 6 extractor model rounds, 4 local calls per round, 16 local calls total, and 4,000 characters per local tool result, followed by one forced no-tools JSON answer request at the round limit;
- a malformed local call returns a bounded 200-code-point `{"error":{"kind":"invalid_local_call","message":"<reason>"}}` tool result, counts against the same per-round and total bounds, and continues the same extractor loop so the model can retry with valid arguments instead of discarding the extraction.

The extractor has no network, vault, or note-writing tool. Terminal output is parsed tolerantly: a surrounding code fence and prose around the JSON object are ignored, unknown fields at every level are ignored, individually invalid claims/quotes are dropped, and unknown or duplicate source IDs are ignored or merged. A claim has trimmed 1–500-code-point text and 1–4 exact verbatim quotes of 1–1,500 code points each; result-level deduplicated quotes are the quotes-only fallback. Structurally unusable output (no parseable JSON object, missing/unknown outcome, or evidence without a results array) triggers exactly one same-provider, no-tools correction request containing at most 8,000 characters of the invalid reply and the exact violation; a second unparseable reply is a format failure. The reader returns only its verified outcome and transient rounds; `deepseek-web.ts` validates every surviving quote and performs the single deterministic fit to the per-call cap: trailing claims, then trailing evidence, then a verbatim code-point prefix of the last quote marked `truncated`, then empty results, then `no_relevant_evidence`. The fit reports `omitted: true` when it drops a claim or a whole result; a prefix truncation alone leaves it false. Raw retrieval is never passed through. Verified claim results retain their extractor result-level quotes internally, so cap fitting can degrade a result to those quotes when it must drop its claims; the serialized payload still omits result-level evidence while claims exist. A quotes-only result marked `truncated: true` tells the main model that the quote prefix was shortened and may not fully support its claim.

Only actual normalized credentialess HTTP(S) sources represented by successful extraction become stable `S1`, `S2`, ... citations. Staged sources commit only after fitting/mapping/cap/abort checks, preserving retrieval order and contiguous IDs. The main model synthesizes only from supplied claims, quoted evidence, and actual source metadata; every final-answer claim must still be supported by that evidence.

### Failures, usage, and persistence

Expected Fetch retrieval failures and empty pages retain their explicit unread outcome and unread-page warning; they do not invoke a reader. Both return the deterministic 33-character `{"error":{"kind":"fetch_failed"}}` payload without a provider message or URL, and Emend asserts the final serialized outcome against the configured per-call cap before continuing. A Search that still fails after its single retry becomes a per-call `search_failed` outcome; `403`/`404` are not retried, and Search/Fetch HTTP `400/401/402/413` and aborts remain fatal and are never retried (Task 10 below). Every abort cancels the whole submission.

Failed activities carry a transient `failureReason`: `network` (no HTTP status), `http` (non-fatal status), `empty` (empty Fetch page), or `reader` (extraction failure). Chat renders them as `Failed (network)`, `Failed (HTTP)`, `Failed (empty page)`, and `Failed (reader)` labels in the folded activity list; they are not persisted.

A non-abort extractor provider/format/limit failure returns only `{"error":"extraction_failed"}`, excludes that query's unextracted sources, and allows the main model to use other successful evidence. Chat appends exactly one aggregate warning:

```text
Emend could not extract information from N web query. The answer may be incomplete.
```

For multiple failures, `query` becomes `queries`. The warning persists as ordinary ready content. Ready answers append at most one warning per condition in the order unread pages, extraction failures, failed searches, cap-fitting omissions, then skipped calls; the failed-search warning is `Emend could not complete N web search. The answer may be incomplete.`, with `searches` when N > 1, and the omission warning is `Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.` Verification failure never becomes `extraction_failed`: the loop stops with any verified claims collected so far, or with the extractor's quotes-only outcome when none were verified. Oversized payloads are deterministically fitted rather than failing the call. The only retrieval retry is the single Task 10 Search/Fetch retry, and there is no raw-content fallback.

Usage covers every main, extractor, correction, verifier, and refine model round in chronological order. Provider-sourced totals require complete valid usage triplets from every round; otherwise every round is independently estimated and the total is labelled **Estimated**. Extractor, verifier, and refine reasoning is not displayed or persisted, but its transient round data participates in fallback estimation. Retrieval, Search, and reader prices or token counts are not invented.

Conversation schema 2 persists only ordinary ready content, sanitized citations/activity (`type`/`target`/`status`, never failure reasons), main reasoning, and usage. Raw retrieval, extractor/verifier/refine requests/results, extracted payloads, evidence extracts, reader reasoning/rounds, transient failure state, and stopped/loading/error messages remain unpersisted.

## Automated verification

Tasks 1–5 used regression-first coverage for character measurement and normalization, Review goals, canonical documents and local tools, reader bounds/grounding, main-loop integration, failure diagnostics, and all-round usage. The completed Task 5 gate passed **39 Vitest files and 971 tests**, ESLint, strict TypeScript/production build, and `git diff --check`. Task 6 adds no runtime code; its final locked-install clean gate is recorded in the Task 6 report.

Task 7 replaced the old over-limit terminal-error expectation with failing partial-execution tests before implementation. The focused RED run failed 14 intended tests; the focused GREEN run passed **4 files and 236 tests**. The final locked-install gate passed **39 Vitest files and 979 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

Task 8 (historical, superseded by Task 9) introduced closed verbatim-only fixtures and genuine-quote drift rejection tests before implementation. The focused RED run failed 10 intended tests while 126 passed, including acceptance of `extractedFacts` beside genuine evidence and missing reader/main-model guidance. The focused GREEN run passed **4 files and 136 tests**. A self-review follow-up changed the Review/Auto disclosure expectations first, watched two intended failures, then passed **2 files and 90 tests** with verbatim-selection wording. The final `npm ci` locked-install gate passed **39 Vitest files and 986 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

Focused runtime tests cover tolerant fenced/prose-wrapped claim parsing with unknown fields, invalid-claim/quote dropping and source-ID merge/drop; claim text and quote code-point bounds; verbatim enforcement; exact verified-claims and quotes-only payloads; deterministic fitting of trailing claims, trailing evidence, code-point prefix truncation with `truncated`, and the no-evidence floor; temporary-ID fitting with staged final IDs; the all-supported one-extractor/one-verifier path; rejected-to-refine-to-supported; the three-verifier-pass and two-refine-round budget; unchanged and empty refinements; one format correction and terminal format failure; the forced final request at the six-round limit; JSON-mode request bodies; verification parse/provider failure falling back to quotes; aborts; extractor/verifier/refine rounds in usage; small/large Search/Fetch; exact serialized-cap boundaries; independent heavy calls; mixed success/failure/no-evidence outcomes; unread-Fetch versus extraction diagnostics; contiguous citations; no raw continuation; prompt-injection-shaped content; provider errors; Review/Auto; partial execution and forced no-tools completion; zero remaining slots; exact 20 and skipped 21; malformed forced-round calls; skipped counts and exact singular/plural warnings; provider-versus-estimated usage; and sanitized reload persistence.

## Real-Obsidian loopback evidence

- Date: 2026-11-10, Asia/Shanghai.
- Runtime: official Obsidian 1.15.0 AppImage assets already under ignored `test_vault/emend-web-verify/tools/`, isolated Xvfb `:99`, CDP `19222`, and CORS loopback chat/Search/Fetch mock at `127.0.0.1:8765`.
- Data: only synthetic notes, instructions, additional-note context, configuration, and a dummy SecretStorage credential under ignored `test_vault/emend-web-verify/runtime-reader/`. No real provider/account/key, external or paid request, other vault, retry beyond the explicit Stop/retry scenario, fallback, or note write was used.
- Bundle: root and tested `main.js` SHA-256 were both `814e39c5f1652533c188392ea85add2e6c339b86c6b8a4ac708df884c7ed8405`.
- Command: `node test_vault/emend-web-verify/verify.mjs --reader` using `mock-reader.mjs` for distinct fragmented main and reader SSE rounds.
- Result: **12/12 scenarios and 80/80 assertions passed**, covering both supported models. The request audit covered 14 captured logs and 128 entries with zero header violations and zero dummy-credential leaks. Owned Obsidian, Xvfb, and mock processes were stopped after the run.

### Scenario matrix

For each of `deepseek-flash` and `deepseek-v4-pro`:

1. **Review small/large Search and Fetch:** one reviewed batch contained small Search, large Search, small Fetch, and large Fetch. Exact order was main → Search → three reader rounds → Search → reader → Fetch → reader → Fetch → reader → terminal main. Review disclosed current-question sharing/cost, an empty edited goal blocked all retrieval, and the edited query/goal executed. Small Search used local literal grep then ranged read. All four serialized payloads were within the actual 20,000 setting (lengths 262, 274, 272, 272), four citations rendered, and usage was Estimated because not every round supplied usage.
2. **Two heavy Auto Searches:** setting 20 and an actual 1,000-character per-call cap produced two independent 649-character payloads from five 30,000-character raw results per Search. Exact order was main/Search/reader/main/Search/reader/terminal main. Two citations rendered, no shared-budget or extraction warning appeared, and all five main+reader rounds produced provider-sourced `75 total · 50 prompt · 25 completion` usage.
3. **Unread Fetch failures at cap 1,000:** one long nonfatal provider error with a long URL and one empty page with a long URL ran in exact main → Fetch → Fetch → terminal main order without a reader. Both main-model tool payloads were exactly the 33-character `{"error":{"kind":"fetch_failed"}}` without provider messages or URLs. Chat displayed `Emend could not read 2 requested pages. The answer may be incomplete.` without an extraction warning or citations, and schema-2 persistence retained only the warning and sanitized failed activities.
4. **Mixed extraction failure and reload:** one valid reader result and one invalid reader result each ran once. The terminal main request contained one grounded payload and only `{"error":"extraction_failed"}` for the failure. The successful source remained `S1`, the failed source was excluded, and exactly one `Emend could not extract information from 1 web query. The answer may be incomplete.` warning appeared and persisted. An actual application reload restored the same warning/citation without duplication, with six requests before and after reload.
5. **Stop and retry:** Stop during a held reader produced two completion requests and one Search with no terminal main continuation. A fresh retry completed main/Search/reader/terminal main with one citation. Stopped content and reader artifacts did not persist.
6. **Nine actual Searches at setting 20:** exactly nine ordered Search calls and nine readers ran before terminal main, for 19 completion requests total. Every Search requested five results with content. Nine independent 258-character payloads and nine citations appeared with no shared-budget or extraction warning.

The Review privacy fixture placed distinct note, ready-history, additional-note, and instruction markers in the initial main request. Every reader request contained the exact current typed question and goal with empty history and only local grep/read declarations; none contained those markers or initial canonical page content. Main-model tool continuations contained grounded extraction payloads, not the synthetic raw markers.

All scenarios asserted byte-for-byte unchanged notes. Schema-2 audits excluded raw retrieval, extracted-fact arrays, reader rounds, and an injected `READER_REASONING_SECRET`; main reasoning remained visible/persisted. Estimated and provider usage labels and totals survived as ordinary ready-message usage.

Evidence is retained under ignored paths:

- `test_vault/emend-web-verify/evidence-reader/summary.json`
- `test_vault/emend-web-verify/evidence-reader/reader-evidence.json`
- `test_vault/emend-web-verify/evidence-reader/request-log.json`
- `test_vault/emend-web-verify/evidence-reader/logs/`
- `test_vault/emend-web-verify/evidence-reader/reader-*.png`

The first harness attempt copied a stale fixture plugin and failed before exercising the new setting. After installing the actual root bundle, verifier-only corrections distinguished terminal main requests from accumulated continuations, unique local calls from repeated reader history, and rendered Markdown whitespace from persisted newlines. The first unread-Fetch fixture attempt also used an overlong generated extraction goal; short explicit goals corrected that verifier-only fixture before the final passing run. No runtime defect was found in these harness corrections and no result JSON was edited to conceal a failure.

### Task 7 graceful over-limit completion

- Date: 2026-11-10, Asia/Shanghai.
- Runtime: the same official Obsidian 1.15.0 AppImage assets, isolated Xvfb `:99`, CDP `19222`, and CORS loopback chat/Search/Fetch mock at `127.0.0.1:8765`.
- Data: only synthetic notes, instructions, configuration, and a dummy SecretStorage credential under ignored `test_vault/emend-web-verify/runtime-over-limit/`. No real provider/account/key, external retrieval, other vault, fallback, or note write was used.
- Bundle: root and tested `main.js` SHA-256 were both `638c67f3f8cce87f519e9cf9eb7beb4722f0442740bab6fd8dda39a7db999224`.
- Command: `node test_vault/emend-web-verify/verify.mjs --over-limit` using `mock-reader.mjs` for fragmented main and reader SSE rounds.
- Result: **8/8 scenarios and 58/58 assertions passed**, covering both supported models. The request audit covered 10 captured logs and 124 entries with zero header violations and zero dummy-credential leaks. Owned Obsidian, Xvfb, and mock processes were stopped after the run.

For each of `deepseek-flash` and `deepseek-v4-pro`:

1. **Review partial execution and reload:** four proposals at setting 3 displayed only three Review calls. The edited first query/goal and two original executable queries ran in model order; the fourth did no Search/reader work. The forced no-tools continuation contained all four IDs, edited executable arguments, exact original skipped arguments, three grounded outcomes, and one `call_limit_reached` outcome. Three citations and five-round provider usage `75 total · 50 prompt · 25 completion` survived with one singular warning and four activities. Actual reload restored all of them without new retrieval.
2. **Auto no-evidence completion:** three proposals at setting 1 executed only the first Search/reader, which returned no relevant evidence; two skipped calls caused no retrieval. The forced no-tools answer had no citations, one exact plural warning, three activities, and three-round provider usage `45 total · 30 prompt · 15 completion`.
3. **20/21 boundary:** exactly twenty ordered Search/reader pairs ran before the 21st proposal was skipped without work. One forced no-tools request preserved both assistant batches and all 21 outcomes. Twenty citations, 21 activities, one singular warning, and 23-round provider usage `345 total · 230 prompt · 115 completion` persisted.
4. **Stop and retry:** Stop during a held reader produced no forced continuation or skipped-call retrieval. A fresh retry executed one Search/reader and one forced answer, preserving one citation, skipped activity/warning, and all-round usage while stopped artifacts remained transient.

Every Task 7 scenario asserted byte-for-byte unchanged notes and schema-2 persistence without raw tool outcomes, extracted-fact arrays, or reader reasoning. Evidence is retained under ignored paths:

- `test_vault/emend-web-verify/evidence-over-limit/summary.json`
- `test_vault/emend-web-verify/evidence-over-limit/over-limit-evidence.json`
- `test_vault/emend-web-verify/evidence-over-limit/request-log.json`
- `test_vault/emend-web-verify/evidence-over-limit/logs/`
- `test_vault/emend-web-verify/evidence-over-limit/over-limit-*.png`

The first Task 7 harness attempt passed Review and 20/21 on both models but exposed two verifier-only fixture mistakes: it expected empty `webSources` to serialize as an array and clicked Stop before the held reader started. The final verifier accepts the existing omitted-empty-sources schema and waits for the reader request before Stop. No runtime code was changed for those corrections, and the final passing evidence was regenerated rather than edited.

### Task 8 verbatim-only reader output (historical, superseded by Task 9)

The following records the earlier Task 8 contract at commit `1efbf26`; Task 9 below replaces all-or-nothing verbatim rejection with verified claims, quotes-only fallback, and a bounded verifier/refine loop.

- Date: 2026-11-10, Asia/Shanghai.
- Runtime: the same official Obsidian 1.15.0 AppImage assets, isolated Xvfb `:99`, CDP `19222`, and CORS loopback chat/Search mock at `127.0.0.1:8765`.
- Data: only synthetic notes, configuration, and a dummy SecretStorage credential under ignored `test_vault/emend-web-verify/runtime-verbatim/`. No real provider/account/key, external or paid request, other vault, fallback, or note write was used.
- Bundle: root and tested `main.js` SHA-256 were both `73cca5f84f44f1b2b049d661aa33ab4169f2fca16571b55ada76000428e7c5cb`.
- Command: `node test_vault/emend-web-verify/verify.mjs --verbatim` using `mock-reader.mjs` for fragmented main and reader SSE rounds.
- Result: **6/6 scenarios and 48/48 assertions passed**, covering both supported models. The request audit covered six captured logs and 24 entries with zero header violations and zero dummy-credential leaks. Owned Obsidian, Xvfb, and mock processes were stopped after the run.

For each of `deepseek-flash` and `deepseek-v4-pro`, three fresh Auto submissions ran in exact main → Search → reader → terminal-main order with exactly one reader and no automatic reader retry:

1. **Accurate extraction:** the reader returned exactly `sourceId` and the verbatim release-day passage. The terminal continuation contained only `S1`, the actual title/URL, and that passage. Final synthesis used the actual source title with one correct citation and no extraction warning.
2. **Invented-fact/wrong-label drift:** the reader returned a genuine Monday quote alongside an invented Tuesday `extractedFacts` statement and `WRONG_LINK_LABEL`. Closed validation rejected the result. The terminal main request contained only `{"error":"extraction_failed"}` for that call; neither invented marker nor the genuine quote reached any main-model request. The ready answer had exactly one extraction warning and no citation.
3. **Fresh verbatim-only retry:** a separate new submission returned exact verbatim retry evidence and completed final synthesis with the actual retry source title/URL and one correct citation.

Every scenario asserted main-model evidence-only/supported-claim guidance, isolated reader inputs, schema-2 persistence without reader payloads/evidence/reasoning, and byte-for-byte unchanged notes. Evidence is retained under ignored paths:

- `test_vault/emend-web-verify/evidence-verbatim/summary.json`
- `test_vault/emend-web-verify/evidence-verbatim/verbatim-evidence.json`
- `test_vault/emend-web-verify/evidence-verbatim/request-log.json`
- `test_vault/emend-web-verify/evidence-verbatim/logs/`
- `test_vault/emend-web-verify/evidence-verbatim/verbatim-*.png`

The first Task 8 harness run passed accurate/retry on both models but failed the drift assertion because it compared rendered DOM text with raw Markdown newlines. The persisted content already exactly matched the expected answer plus one warning. The verifier now checks rendered warning presence and exact persisted content separately; no runtime code was changed for that correction, and the final passing evidence was regenerated.

### Task 9 claims, verifier, and refine

Task 9 replaced all-or-nothing verbatim rejection with a bounded extraction loop. It added the claims-plus-quotes outcome, tolerant JSON-object parsing, one format-correction round, optional `response_format: { type: 'json_object' }` on extractor/correction/verifier/refine requests, a same-provider verifier with up to two refine rounds, deterministic per-call fitting, and the updated main-model prompt. The earlier Task 8 verbatim-only contract above is historical and no longer current behavior.

TDD: the focused RED run failed **3 files / 28 tests with 68 passing**; `tests/web-extraction-reader.test.ts` additionally failed to import the new typed parse error. The RED failures covered the new claim shape, tolerant parsing, fit precedence, verifier/refine/correction loops, JSON mode, and coordinator fallback behavior. The focused GREEN run passed **3 files / 131 tests**. The final local gate passed **39 Vitest files / 1004 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

Review follow-up tightened bounded work and data framing: claims are capped at 8 per source and 24 total with Set-based duplicate detection; the verifier request is capped at 24,000 serialized claim characters, with overflow claims neither verified nor refined and falling back to result-level quotes; verifier/refine prompts frame claims, quotes, and reasons as untrusted data; verified claim results retain extractor quotes so fitting can degrade them to quotes; failed reader requests are recorded as empty synthetic rounds for usage; unchanged-revision comparison includes evidence; accepted claims dedupe by source and normalized text; and the main prompt explains `truncated: true`. The follow-up RED run failed **20 tests with 126 passing**; the focused GREEN run passed **3 files / 147 tests**; the final gate passed **39 Vitest files / 1020 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

Final follow-up removed the reader's duplicate fit: the reader returns only the verified outcome and transient rounds, while the coordinator performs the single cap-minus-margin fit. It also applies the 24,000-character verifier budget after every refinement, with a post-refine budget test proving the request stays bounded while the source keeps its result-level quotes. The focused gate passed **3 files / 147 tests**; the full gate passed **39 Vitest files / 1020 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

JSON-mode compatibility with streaming, tool declarations, and `stream_options.include_usage` was verified live against `deepseek-flash` and `deepseek-v4-pro` on 2026-11-10 (recorded in the PR1 resilience design) and was not repeated. Task 9 used unit tests and local doubles only: no real provider call, paid request, or real-Obsidian loopback was performed. Real-provider extraction quality, verifier reliability, refine usefulness, latency, and billing remain unverified.

### Task 10 transport retry and Search degradation

Task 10 adds bounded transport resilience without changing the extraction loop. Search and Fetch each get exactly one immediate retry with no delay, backoff, or setting. A retry happens only for a failure without an HTTP status (transport/DNS/TLS failure or malformed/non-JSON response), status `429`, status `500`–`599`, or an empty Fetch page. Any other HTTP status, including `403` and `404`, is not retried. The retry emits one pending activity, `Retrying search: <query>` or `Retrying fetch: <url>`; a successful retry produces the ordinary completed activity and no warning.

HTTP `400`, `401`, `402`, `413`, and every abort remain fatal and throw without a retry. Every other failure becomes a per-call outcome. An exhausted Search retry returns `{"error":{"kind":"search_failed"}}`, records a failed activity, increments the new `failedSearches` count, and lets the model continue with other evidence. An exhausted Fetch retry keeps the existing `{"error":{"kind":"fetch_failed"}}` unread outcome. A Search that succeeds and then fails extraction remains an extraction failure: it increments `failedExtractions` and records `failureKind: 'extraction'` with `failureReason: 'reader'`, and does not increment `failedSearches`.

Failed activities carry transient `failureReason` metadata: `network` (no HTTP status), `http` (non-fatal status), `empty` (empty Fetch page), or `reader` (extraction reader failure). In this task those reasons were not yet rendered and `failedSearches` was only propagated through `ReadOnlyRequestCoordinator` and set to `0` for ordinary chat; Task 10b below adds the labels and warning. Raw provider messages remain excluded from payloads, activities, and persistence.

TDD: the focused RED run failed **2 files / 25 tests with 94 passing**. RED covered the retry/exhaustion matrix, empty-page retry, non-retryable `403`/`404`, Search degradation and `search_failed` continuation, reader failure reasons, and `failedSearches` propagation. The focused GREEN run passed **2 files / 119 tests**; the full local gate passed **39 Vitest files / 1039 tests**, ESLint, strict TypeScript/production build, and `git diff --check`. This task used unit tests only: no real provider call, paid request, or real-Obsidian loopback was performed.

Review follow-up pinned the attempt boundaries: a fatal status on the retry attempt throws after exactly two attempts and emits no completed outcome; a retryable first attempt followed by `403`/`404` yields `failureReason: 'http'` with no third attempt; an empty first page followed by a transport error reports `failureReason: 'network'`; an exhausted Search `5xx` retry reports `failureReason: 'http'` after exactly two attempts; aborting between the retry activity and the retry call rejects with the abort reason and makes no second retrieval call; and schema-2 persistence drops `failureKind` and `failureReason` on both save and load. The abort case exposed a real race: the coordinator announced the retry and then invoked the retrieval function even though the signal had aborted inside the activity callback, so an abort re-check now runs after that activity. Focused GREEN passed **2 files / 96 tests** and the full gate passed **39 Vitest files / 1046 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

### Task 10b search warning and activity reason labels

Task 10b consumes the propagated `failedSearches` count and the transient `failureReason` metadata in chat without changing retrieval. A ready Web answer with one or more failed Searches appends exactly one warning, `Emend could not complete N web search. The answer may be incomplete.` with `searches` when N > 1, after the unread-page and extraction warnings and before the skipped-call warning; it is ordinary ready content and persists with the message. Failed rows in the folded activity list render `Failed (network)`, `Failed (HTTP)`, `Failed (empty page)`, or `Failed (reader)`; completed and skipped rows remain unchanged, and an unknown or absent reason adds no parentheses. `getUnreadPageCount` still excludes failed Fetches with `failureKind: 'extraction'` even when the reason is `reader`, and schema 2 still drops `failureKind`/`failureReason` on save and load.

TDD: re-running the Task 10b test file against the pre-change `chat-view.ts` failed **7 intended tests with 90 passing** in `tests/chat-view.test.ts`, covering the singular and plural search warnings, warning order, and the four reason labels. The focused GREEN run passed **1 file and 97 tests**. The full local gate passed **39 Vitest files and 1058 tests**, ESLint, strict TypeScript/production build, and `git diff --check`. This task used unit tests and local doubles only: no real provider call, paid request, or real-Obsidian loopback was performed.

### Task 11 loopback verification: claims and current verbatim

Two real-Obsidian loopback runs re-verified the current Tasks 9–10b behavior against local mocks only. Both used official Obsidian 1.15.0 under isolated Xvfb `:99`, CDP `19222`, and the CORS loopback chat/Search mock at `127.0.0.1:8765` from ignored `test_vault/emend-web-verify/` fixtures, with synthetic notes, a dummy SecretStorage key, and no real provider, external, or paid request. The tested root bundle matched the repository `main.js` (SHA-256 `638dafbb31f77d8a5c389af0553acf3428b8c05bd4b5462dff33262bf3d6cf72`).

`node test_vault/emend-web-verify/verify.mjs --claims` passed **10/10 scenarios and 86/86 assertions** (five scenarios per supported model). The 56 captured requests had zero header violations and zero dummy-credential leaks. Per model it asserted exact request sequences for verified claims (`main → Search → extractor → verifier → main`), rejected-to-refined claims (`main → Search → extractor → verifier → refine → verifier → main`), quotes-only fallback (`main → Search → extractor → verifier → refine → main`), retry (`main → Search 503 → Search 200 → extractor → verifier → main`), and search failure (`main → Search 503 → Search 503 → main`); JSON mode and local tools on extractor requests; JSON mode, no tools, empty history, and no note/instruction/additional-note/vault markers on verifier and refine requests; no JSON mode on main rounds; exact claims-with-quotes, quotes-only, and `search_failed` payload shapes; usage-bearing citations; exactly one singular search warning with no citation; the confirmed `Retrying search:` activity and the transient `Failed (HTTP)` row; unchanged note bytes; sanitized schema 2 without raw retrieval/claims or `failureKind`/`failureReason`; and an actual reload that restored the warning and activity without new requests or retrieval.

`node test_vault/emend-web-verify/verify.mjs --verbatim` passed **6/6 scenarios and 48/48 assertions** (three scenarios per model) across 24 captured requests with zero header/credential violations. Accurate and fresh retry still made one extractor request and no verifier, with the exact main prompt guidance, one S1 payload, and one citation. Drift now verifies the tolerant path: the genuine quote is retained as quotes-only S1 evidence, `extractedFacts` and `linkLabel` are dropped, no `INVENTED_FACT` or `WRONG_LINK_LABEL` reaches any main request, the degraded answer cites the actual source with no extraction warning, schema 2 contains no invented markers, and note bytes are unchanged.

Evidence is retained under ignored `test_vault/emend-web-verify/evidence-claims/` and `test_vault/emend-web-verify/evidence-verbatim/`; the harness files are ignored and were not committed.

## Environment limits

All provider behavior was deterministic loopback behavior on Linux/Xvfb, not a real DeepSeek response. The mock exercised both model names and real Obsidian UI/runtime paths, but cannot establish real-provider extraction quality, final-answer grounding, verifier reliability, pricing, tokenization, model behavior, or real-provider forced-limit compliance. Character measurement and the extraction/verification contract are unit-verified; no tokenizer or real-provider correctness is claimed. Every requested Task 6, final unread-Fetch, Task 7, and Task 8 scenario was exercised; Tasks 9, 10, and 10b were covered by unit tests and local doubles, and Task 11 re-exercised their current claims/verifier/refine/retry/search-failure and verbatim paths in real Obsidian against local mocks only.
