# Stage 40: Per-query Web extraction

## Status and scope

The per-query Web extraction reader is implemented and verified locally on `fix/web-content-budget-diagnostics`. It replaces the former shared retrieval pool and raw-result truncation with independent, goal-directed extraction for every readable DeepSeek Search/Fetch result. No real-provider verification, external publishing, or GitHub CI run was performed for this revision.

Stage 36's provider and read-only boundaries remain intact. Web is available only for DeepSeek `deepseek-flash` and `deepseek-v4-pro` in Ask, Discuss, and Brainstorm. Retrieval never gains a note writer, automatic retry, raw fallback, or fallback provider.

## Current behavior

### Calls, goals, and independent caps

- `maxWebToolCalls` defaults to 8 and normalizes to integers from 1 through 20, capping executed Search/Fetch calls rather than rejecting an over-limit batch. Every proposal is validated; only the first remaining calls execute in model order, and only those executable calls appear in Review. Skipped calls perform no Search/Fetch/reader work.
- Continuations preserve every proposed call ID, reviewed executable arguments, original skipped arguments, ordinary selected outcomes, and small capped `{"error":{"kind":"call_limit_reached"}}` outcomes for skipped calls. Skipped calls also gain persisted skipped activities.
- After any skipped calls, exactly one forced terminal main-model request omits Web tools and instructs the model to answer from current note/chat and successful evidence. A ready answer may have no evidence but cannot invent citations. Further tool calls in that forced round fail without retrieval or retry.
- Chat appends `Web retrieval reached the <limit>-call limit. N proposed calls were skipped; the answer may be incomplete.` for multiple skips, or `1 proposed call was skipped` for one. This warning occurs once, coexists with unread/extraction warnings, and persists as ordinary ready content. Exact-limit completion has no skipped-call warning.
- Every call requires a nonempty `extractionGoal` of 1–1000 Unicode code points. Review permits editing the goal and query/URL while preserving call IDs and tool names; an invalid goal blocks the batch before retrieval. Auto validates the same fields without the review pause.
- `maxWebContentCharactersPerCall` defaults to 20,000 and normalizes to integers from 1,000 through 100,000, restoring 20,000 for malformed values. It caps the complete serialized extraction tool response, including source metadata, facts, evidence, and JSON syntax.
- Each call has an independent cap. For cap `C` and `N` executed calls, the payloads contribute at most `C × N` characters; there is no independent total retrieval-character cap.
- `measureWebContent` currently measures UTF-16 `string.length` and returns an explicit character unit behind a token-ready interface. It does not tokenize, and the separate `ceil(characters / 4)` usage fallback is an estimate rather than provider billing data.

### Reader isolation, tools, and grounding

Every readable Search/Fetch result invokes exactly one reader using the same configured DeepSeek provider/model and streaming transport. Canonical title, snippet, summary, and content remain temporarily available without a raw-result size cap. The main answering model never receives raw retrieval; it receives only validated source-grounded extracted facts and verbatim evidence.

The reader receives only the current typed question, extraction goal, reviewed target, and source catalog, followed by any bounded local tool continuations. It has empty chat history and receives no active-note snapshot/path, earlier chat, instructions/skills, additional notes, or vault content. Main model rounds continue to receive their ordinary captured context. Review and Auto disclose current-question reader sharing, up to 6 reader model rounds, and possible separate retrieval/reader charges.

Reader tools are local-only closed operations over temporary canonical documents:

- case-insensitive literal grep, optionally scoped to one source, with bounded matches/context;
- UTF-16 ranged read with actual offsets and bounded chunks;
- at most 6 reader model rounds, 4 local calls per round, 16 local calls total, and 4,000 characters per local tool result.

The reader has no network, vault, or note-writing tool. Its terminal response must be closed JSON with either nonempty grounded evidence or `no_relevant_evidence`. Emend validates source IDs, nonempty facts/evidence, and verbatim evidence occurrence, then rebuilds the payload with actual source IDs and enforces the per-call cap. Malformed, duplicate, invented, ungrounded, or over-cap output fails without slicing or raw passthrough.

Only actual normalized credentialess HTTP(S) sources represented by successful extraction become stable `S1`, `S2`, ... citations. Staged sources commit only after final mapping/cap/abort checks, preserving retrieval order and contiguous IDs.

### Failures, usage, and persistence

Expected Fetch retrieval failures and empty pages retain their explicit unread outcome and unread-page warning; they do not invoke a reader. Both return the deterministic 33-character `{"error":{"kind":"fetch_failed"}}` payload without a provider message or URL, and Emend asserts the final serialized outcome against the configured per-call cap before continuing. Search failures and Fetch HTTP 400/401/402/413 remain fatal. Every abort cancels the whole submission.

A non-abort reader/provider/output/cap failure returns only `{"error":"extraction_failed"}`, excludes that query's unextracted sources, and allows the main model to use other successful evidence. Chat appends exactly one aggregate warning:

```text
Emend could not extract information from N web query. The answer may be incomplete.
```

For multiple failures, `query` becomes `queries`. The warning persists as ordinary ready content. There is no automatic reader retry or raw-content fallback.

Usage covers every main and reader model round in chronological order. Provider-sourced totals require complete valid usage triplets from every round; otherwise every round is independently estimated and the total is labelled **Estimated**. Reader reasoning is not displayed or persisted, but its transient round data participates in fallback estimation. Retrieval, Search, and reader prices or token counts are not invented.

Conversation schema 2 persists only ordinary ready content, sanitized citations/activity, main reasoning, and usage. Raw retrieval, reader requests/results, extracted payloads, evidence extracts, reader reasoning/rounds, transient failure state, and stopped/loading/error messages remain unpersisted.

## Automated verification

Tasks 1–5 used regression-first coverage for character measurement and normalization, Review goals, canonical documents and local tools, reader bounds/grounding, main-loop integration, failure diagnostics, and all-round usage. The completed Task 5 gate passed **39 Vitest files and 971 tests**, ESLint, strict TypeScript/production build, and `git diff --check`. Task 6 adds no runtime code; its final locked-install clean gate is recorded in the Task 6 report.

Task 7 replaced the old over-limit terminal-error expectation with failing partial-execution tests before implementation. The focused RED run failed 14 intended tests; the focused GREEN run passed **4 files and 236 tests**. The final locked-install gate passed **39 Vitest files and 979 tests**, ESLint, strict TypeScript/production build, and `git diff --check`.

Focused runtime tests cover small/large Search/Fetch, exact serialized-cap boundaries, independent heavy calls, mixed success/failure/no-evidence outcomes, failed-round accounting, unread-Fetch versus extraction diagnostics, contiguous citations, no raw continuation, prompt-injection-shaped content, aborts, provider errors, Review/Auto, partial execution and forced no-tools completion, zero remaining slots, exact 20 and skipped 21, malformed forced-round calls, skipped counts and exact singular/plural warnings, provider-versus-estimated usage, and sanitized reload persistence.

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

## Environment limits

All provider behavior was deterministic loopback behavior on Linux/Xvfb, not a real DeepSeek response. The mock exercised both model names and real Obsidian UI/runtime paths, but cannot establish real-provider extraction quality, pricing, tokenization, model behavior, or real-provider forced-limit compliance. Character measurement is verified; no tokenizer or real-provider verification is claimed. Every requested Task 6, final unread-Fetch, and Task 7 scenario was exercised; no requested scenario was skipped.
