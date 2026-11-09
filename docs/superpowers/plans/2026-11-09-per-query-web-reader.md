# Per-query Web Extraction Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared Web-content truncation with bounded, goal-directed AI extraction for every DeepSeek Search/Fetch result, using independent per-call output caps and source-grounded evidence.

**Architecture:** Add pure character-measurement and extraction-document contracts, a bounded reader that uses local grep/read tools through the existing streaming transport, and staged source registration in the existing DeepSeek Web loop. Keep the current user question separate from assembled note context, include reader rounds in usage, and persist only existing sanitized ready-message data.

**Tech Stack:** TypeScript strict mode, Obsidian desktop API, browser fetch/SSE, Vitest, ESLint, esbuild, real-Obsidian loopback mocks.

**Spec:** `docs/superpowers/specs/2026-11-09-per-query-web-reader-design.md`

## Global Constraints

- Work in `/home/chang/Projects/obsidian-emend` on `fix/web-content-budget-diagnostics`; no worktrees. Use sequential implementation subagents and fresh task reviewers. Do not resume PR2 until revised PR #47 is reviewed and merged.
- Write regression tests first and record observed RED→GREEN evidence. Preserve all existing safety contracts and run `npm test && npm run lint && npm run build && git diff --check` after every task; run `npm ci` for the final clean gate.
- Every Search/Fetch call invokes exactly one reader. The main answering model never receives raw retrieved content, including after reader failure. No hard truncation, automatic reader retry, raw fallback, or alternative provider.
- Default `maxWebContentCharactersPerCall` to **20,000**, normalize to **1,000–100,000**, and apply it to each complete serialized Search/Fetch tool response. There is no independent total cap: `N` calls contribute at most `C × N` characters.
- The current unit is characters, not tokens. Keep measurement behind the Task 1 interface; do not add a tokenizer dependency or represent `ceil(characters / 4)` as exact tokenization.
- Every Web call requires a nonempty reviewable `extractionGoal`. The reader receives the current ready user question and that goal, but never the note snapshot/path, earlier chat history, instructions/skills, additional notes, or vault content.
- Reader tools are local-only, closed, validated literal grep/ranged read operations. Limit each reader to **6 model rounds**, **4 local calls per round**, **16 local calls total**, and **4,000 characters per local tool result**.
- Reader output is closed JSON with source IDs, nonempty extracted-fact/evidence arrays, and verbatim evidence from canonical source text. Invalid/over-cap output becomes `extraction_failed`, never a truncated result.
- Every abort cancels the whole submission. Non-abort reader failures allow a degraded answer from other evidence with one deterministic warning. Existing fatal Search and Fetch HTTP 400/401/402/413 behavior remains unchanged.
- Full-note and selection writers, note bytes, pending locks, SecretStorage, provider capability checks, sequential retrieval, and the 1–20 main Web call limit remain unchanged. No background requests, real providers, telemetry, raw retrieval/reader persistence, or reader-reasoning display/persistence.
- Manual verification uses only ignored `test_vault/`, synthetic content, loopback mocks, and dummy credentials. Do not merge, tag, publish a release, or resume another feature without user authorization.

## Review Focus

- **Failed extraction after earlier successful queries:** later continuations must contain only successful extracted evidence, preserve contiguous actual-source citations, and add exactly one aggregate warning. Task 5 pins mixed success/failure and source ordering.
- **Unicode and canonical offsets:** UTF-16 lengths/offsets and verbatim evidence must remain correct across emoji, CRLF, and all Search fields without confusing character fallback with tokens. Tasks 1 and 3 pin these cases.
- **Prompt-injection-shaped retrieval:** page instructions must remain inert data, with no network/vault tool availability or execution, and no raw page text in the initial reader prompt. Task 4 pins malicious fixtures and closed local tools.
- **Usage/reasoning privacy:** one reader round without provider usage must make the complete total Estimated, while reader reasoning remains absent from visible/persisted reasoning. Task 6 pins the aggregate result and chat save.
- **Review edits and cancellation:** extraction-goal edits must preserve call IDs/names, invalid goals must block Run, and Cancel must prevent retrieval and reader calls. Tasks 2 and 5 pin these paths.

---

### Task 1: Character Measurement and Per-call Settings

**Files:**
- Create: `src/web-content-measurement.ts`
- Modify: `src/types.ts`, `src/settings.ts`
- Test: `tests/web-content-measurement.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces: `measureWebContent(value: string): { value: number; unit: 'characters' }`, using UTF-16 `value.length` and no token claim.
- Produces: `EmendSettings.maxWebContentCharactersPerCall: number` and `DEFAULT_SETTINGS.maxWebContentCharactersPerCall = 20000`; normalization clamps finite numbers to integer `1000–100000` and otherwise restores `20000`.

- [ ] **Step 1: Write failing measurement and settings tests**
  - Assert `measureWebContent('')` returns `{value: 0, unit: 'characters'}`, ASCII counts its length, and `'A🙂'` returns `3` to pin UTF-16 rather than tokens/code points.
  - Assert the default is 20000; 19999.9 normalizes to 19999; values below/above range clamp to 1000/100000; malformed/missing values restore 20000; independent provider configs and blank serialized API keys remain unchanged.
- [ ] **Step 2: Verify RED**
  - Run: `npm test -- tests/web-content-measurement.test.ts tests/settings.test.ts`
  - Expected: the new module is missing and the new setting is absent; no fixture errors.
- [ ] **Step 3: Implement the pure measurement and normalized setting**
  - Add the exact interface above, the default/normalization, sanitized deep-clone persistence, and a numeric setting labelled **Web output cap per call (characters)** explaining that each Search/Fetch reader response has an independent cap and total growth is cap × calls.
  - Do not change `maxWebToolCalls`, add a total cap, or send the new setting to a provider outside the Web coordinator.
- [ ] **Step 4: Verify GREEN and the full gate**
  - Run: `npm test -- tests/web-content-measurement.test.ts tests/settings.test.ts && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all tests, lint, build, and diff check pass.
- [ ] **Step 5: Commit**
  - `git add src/web-content-measurement.ts src/types.ts src/settings.ts tests/web-content-measurement.test.ts tests/settings.test.ts && git commit -m "feat: add per-call web output settings"`

### Task 2: Reviewable Extraction Goals

**Files:**
- Modify: `src/web-search.ts`, `src/web-search-modal.ts`, `src/deepseek-web.ts`, `src/chat-view.ts`
- Test: `tests/web-search.test.ts`, `tests/web-search-modal.test.ts`, `tests/deepseek-web.test.ts`, `tests/chat-view.test.ts`

**Interfaces:**
- Changes both `WebToolCall` variants to include `extractionGoal: string`; Search arguments are exactly `{query, extractionGoal}`, Fetch exactly `{url, extractionGoal}`.
- Produces shared `WEB_EXTRACTION_DISCLOSURE`: `Each web call uses an AI reader to extract relevant facts. The reader receives your current question and extraction goal, may use up to 6 model rounds, and may incur separate charges.`
- Reader integration remains later; this task only validates/carries goals and updates fixtures so existing behavior remains green.

- [ ] **Step 1: Write failing parser and modal tests**
  - Require nonempty trimmed extraction goals of 1–1000 Unicode code points, reject missing/extra/wrong-type/empty/overlong goals, and preserve existing query/URL validation.
  - Open Review with goal-bearing calls, edit query/URL and goal independently, and assert returned IDs/names/goals. Assert empty goals block Run with a visible error and Cancel resolves no calls.
  - Assert Review and Auto disclosure contain the exact shared text without making requests.
- [ ] **Step 2: Verify RED**
  - Run: `npm test -- tests/web-search.test.ts tests/web-search-modal.test.ts tests/chat-view.test.ts`
  - Expected: extractionGoal is not parsed/rendered and disclosure is absent.
- [ ] **Step 3: Implement goal validation and Review controls**
  - Add `extractionGoal` to the closed types/schemas and `toProviderToolCall` helpers. Add a labelled goal input per call and the shared disclosure to the modal; validate all fields before resolving.
  - Append the same disclosure to `WEB_SEARCH_DISCLOSURE` for Auto/tooltips. Update main Web tool declarations to require the new property without adding reader calls.
- [ ] **Step 4: Update existing Web fixtures and verify GREEN**
  - Add deterministic goals to existing Search/Fetch fixtures and expected edited calls. Preserve the 20/21-call boundary and all current behavior.
  - Run: `npm test -- tests/web-search.test.ts tests/web-search-modal.test.ts tests/deepseek-web.test.ts tests/chat-view.test.ts && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all checks pass.
- [ ] **Step 5: Commit**
  - `git add src/web-search.ts src/web-search-modal.ts src/deepseek-web.ts src/chat-view.ts tests/web-search.test.ts tests/web-search-modal.test.ts tests/deepseek-web.test.ts tests/chat-view.test.ts && git commit -m "feat: review web extraction goals"`

### Task 3: Canonical Documents, Local Tools, and Output Validation

**Files:**
- Create: `src/web-extraction.ts`
- Test: `tests/web-extraction.test.ts`

**Interfaces:**
- `WebExtractionDocument = { sourceId: string; title: string; url: string; snippet?: string; canonicalText: string }`.
- `buildSearchExtractionDocuments(results: readonly {title; url; snippet; summary; content}[]): WebExtractionDocument[]` and `buildFetchExtractionDocument(page: {title; content}, url: string): WebExtractionDocument[]`; assign temporary IDs `R1`, `R2`, … in retrieval order.
- Canonical text is exactly `Title: <title>\nSnippet: <snippet>\nSummary: <summary>\nContent: <content>`; Fetch supplies empty snippet/summary and no extra trailing newline.
- `grepRetrievalDocuments(documents, {query, sourceId?}): string` performs case-insensitive literal search; `readRetrievalDocument(documents, {sourceId, offset, length}): string` uses UTF-16 offsets. Both return bounded JSON with actual offsets and at most 4000 characters.
- `WebExtractionOutcome` is `{outcome: 'evidence'; results: Array<{sourceId; extractedFacts: string[]; evidence: string[]}>}` or `{outcome: 'no_relevant_evidence'; results: []}`.
- `parseWebExtractionOutcome(content: string, documents): WebExtractionOutcome` validates the closed shape, outcome consistency, unique known IDs, nonempty arrays/strings, and verbatim evidence.
- `buildWebExtractionToolPayload(outcome, documents, idByTemporaryId: ReadonlyMap<string,string>): string` emits `{extraction: 'ai-reader', outcome, results}` with mapped IDs/titles/URLs and no canonical content.
- `assertWebExtractionWithinCap(payload: string, cap: number): void` uses Task 1 measurement and throws on `> cap`, allowing exact equality.

- [ ] **Step 1: Write failing canonical/tool/output tests**
  - Pin exact canonical Search/Fetch text, temporary IDs, Unicode/CRLF offsets, all-field grep access, literal rather than regex matching, source scoping, bounded matches/results, and invalid arguments.
  - Validate one grounded result and `no_relevant_evidence`; reject malformed/extra keys, unknown/duplicate IDs, empty facts/evidence, invented extracts, and inconsistent empty outcomes.
  - Assert mapped payload contains extracted facts/evidence but not canonical content, and exact-cap passes while cap+1 fails without slicing. Include an injection-shaped page string and assert it remains data.
- [ ] **Step 2: Verify RED**
  - Run: `npm test -- tests/web-extraction.test.ts`
  - Expected: module/functions do not exist.
- [ ] **Step 3: Implement the pure extraction contracts**
  - Use deterministic separators and source IDs. Bound grep to 8 whole matches with at most 120 context characters on each side, dropping later whole matches and marking `truncated` rather than splitting JSON.
  - Bound read requests to at most 3500 requested characters. If JSON escaping would push a result over 4000 characters, shorten only that explicitly ranged read chunk with actual start/end offsets and `truncated: true`, so the reader can request the next chunk; never split the JSON or hide that more content remains.
  - Reject unknown sources, invalid offsets/lengths, empty/over-256-character grep queries, regex semantics, and any output/cap violation. Keep all functions synchronous and free of provider/vault access.
- [ ] **Step 4: Verify GREEN and the full gate**
  - Run: `npm test -- tests/web-extraction.test.ts && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all checks pass.
- [ ] **Step 5: Commit**
  - `git add src/web-extraction.ts tests/web-extraction.test.ts && git commit -m "feat: validate grounded web extraction"`

### Task 4: Bounded AI Extraction Reader

**Files:**
- Create: `src/web-extraction-reader.ts`
- Test: `tests/web-extraction-reader.test.ts`

**Interfaces:**
- `WebExtractionReader.extract(options: {question: string; extractionGoal: string; target: string; documents: readonly WebExtractionDocument[]; maxOutputCharacters: number; signal: AbortSignal}): Promise<{outcome: WebExtractionOutcome; payload: string; rounds: Array<{request: AiProviderRequest; result: StreamResult}>}>`.
- Constructor dependencies are `{provider: ProviderConfig; request: typeof requestAiResponse}` for deterministic tests and the existing transport.
- `payload` uses Task 3 with identity temporary-ID mapping and is within `maxOutputCharacters`; `rounds` contains every actual reader model round in order.

- [ ] **Step 1: Write failing reader-loop tests**
  - Script grep/read tool rounds followed by grounded terminal JSON. Assert the initial request contains the exact question/goal/target and source catalog but no canonical page content, note snapshot, history, instructions, or additional notes; only `retrieval_grep`/`retrieval_read` tools are declared.
  - Assert local calls execute sequentially, continuations carry bounded tool outputs, identity-mapped payload fits, and every round is returned. Include malicious page instructions and prove they are not executed or exposed as tools.
  - Reject malformed/over-cap/ungrounded terminal output, a fifth call in one batch, a seventeenth total call, a seventh model round, and invalid local arguments. Assert provider errors and aborts propagate unchanged and there is no retry.
- [ ] **Step 2: Verify RED**
  - Run: `npm test -- tests/web-extraction-reader.test.ts`
  - Expected: reader module is missing.
- [ ] **Step 3: Implement the bounded reader**
  - Build requests with empty history, a fixed extraction-only system prompt, the current question/goal/target/catalog, local tool declarations, and no-op event forwarding. Do not forward reader reasoning/content to chat.
  - Execute at most 4 closed local calls per round and 16 total across at most 6 rounds. Append assistant/tool continuations, parse terminal content through Task 3, enforce the cap, and return all rounds. Never catch aborts into a degraded result.
- [ ] **Step 4: Verify GREEN and the full gate**
  - Run: `npm test -- tests/web-extraction-reader.test.ts && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all checks pass.
- [ ] **Step 5: Commit**
  - `git add src/web-extraction-reader.ts tests/web-extraction-reader.test.ts && git commit -m "feat: add bounded web extraction reader"`

### Task 5: Main Web-loop and Chat Integration

**Files:**
- Modify: `src/deepseek-web.ts`, `src/web-search.ts`, `src/request-coordinator.ts`, `src/chat-view.ts`
- Test: `tests/deepseek-web.test.ts`, `tests/request-coordinator.test.ts`, `tests/chat-view.test.ts`, `tests/token-usage.test.ts`, `tests/conversation-store.test.ts`

**Interfaces:**
- Adds `WebSearchRunOptions.question: string` and `maxContentCharactersPerCall: number`.
- Adds optional DeepSeek coordinator dependency `reader?: Pick<WebExtractionReader, 'extract'>`; production constructs the reader with the same provider/request.
- Replaces `WebToolLoopResult.contentBudgetExhausted: boolean` with `failedExtractions: number`; `rounds` interleaves main and reader rounds in actual chronological order.
- `ReadOnlyWebSearchOptions` omits `question`; `ReadOnlyRequestCoordinator` supplies `question: submission.prompt` separately from assembled note context and forwards the configured cap.
- `ChatStreamResult` exposes `failedExtractions: number` (ordinary chat returns 0).
- For `N > 0`, chat appends exactly `Emend could not extract information from N web query. The answer may be incomplete.` for one, or `Emend could not extract information from N web queries. The answer may be incomplete.` for multiple.
- Keeps temporary reader IDs private; staged actual-source registration commits only after the final globally mapped payload passes the cap, in original retrieval order without citation gaps.

- [ ] **Step 1: Write failing integration tests**
  - For small and large Search/Fetch results, assert exactly one reader per call, exact question/goal/target/documents, no raw tool payload to the main model, and final mapped evidence/citations.
  - Replace the old two-heavy-Search shared-truncation characterization with two independently bounded reader outputs at setting 20, asserting no shared skip/truncation and `2 × cap` maximum across two calls. Preserve exact 20/21-call execution/rejection.
  - Pin mixed successful/failed/no-relevant calls: `failedExtractions` counts only failures, failed sources are excluded, successful source IDs remain contiguous, continuations contain no raw content, and one small `extraction_failed` result lets the terminal answer proceed.
  - Assert reader rounds are included in result rounds, reader reasoning is not appended to main reasoning, reader provider failures degrade only that query, all aborts reject the submission, and existing fatal retrieval behavior is unchanged.
  - Assert the coordinator supplies only the typed prompt as `question`, forwards the cap/failure count/all rounds, and never substitutes `buildUserPrompt` output.
  - With valid usage on every main/reader round, assert provider-sourced sums; with one reader round missing usage, assert every round is independently estimated and labelled Estimated. Assert reader reasoning is absent from ready/persisted reasoning.
  - Assert singular/plural warnings appear exactly once in visible and final saved content, coexist correctly with unread-Fetch warnings, and no old 40000 warning remains. Reload persistence retains ordinary sanitized content/citations/activity only.
- [ ] **Step 2: Verify RED**
  - Run: `npm test -- tests/deepseek-web.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts tests/token-usage.test.ts tests/conversation-store.test.ts`
  - Expected: reader options/results/warnings are absent and raw shared-budget behavior remains.
- [ ] **Step 3: Implement staged extraction in `DeepSeekWebSearchCoordinator`**
  - Remove shared/per-item `takeWebText` truncation and the old budget flag. Build canonical documents for every successful retrieval and invoke the reader once with the isolated current question and goal.
  - Map successful temporary IDs to staged actual sources, build and cap-check the final payload, then commit sources in original retrieval order. On non-abort reader/final-validation failure, discard staged sources and return only a generic `extraction_failed` tool outcome with failed activity.
  - Append reader rounds without reader reasoning, keep activities as existing Search/Fetch completed/failed records, return `failedExtractions`, and preserve sequential calls and all existing fatal/abort paths.
- [ ] **Step 4: Implement coordinator and chat propagation**
  - Supply the isolated typed prompt/cap, replace the old flag, aggregate `resolveRoundTokenUsage` over every returned round, and append the exact aggregate warning once. Do not add schema fields, reader reasoning, raw payloads, or evidence extracts to persistence.
- [ ] **Step 5: Verify GREEN and the full gate**
  - Run: `npm test -- tests/deepseek-web.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts tests/token-usage.test.ts tests/conversation-store.test.ts && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all checks pass; no test asserts the removed shared 40000/6000/12000 truncation behavior.
- [ ] **Step 6: Commit**
  - `git add src/deepseek-web.ts src/web-search.ts src/request-coordinator.ts src/chat-view.ts tests/deepseek-web.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts tests/token-usage.test.ts tests/conversation-store.test.ts && git commit -m "feat: extract evidence for every web call"`

### Task 6: Documentation and Real-Obsidian Verification

**Files:**
- Modify: `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `ROADMAP.md`, `devel_docs/36-deepseek-online-search.md`, `devel_docs/40-web-content-budget-diagnostics.md`, `devel_docs/future-web-search.md`, `test_vault/emend-web-verify/`
- Test: final clean gate and loopback evidence; add focused regression tests only if verification exposes a defect

**Interfaces:**
- Consumes the completed Task 5 behavior; no new runtime interface is planned.

- [ ] **Step 1: Rewrite current documentation**
  - Update Stage 40 and all listed current guides to describe per-call extraction for every result, the 20000 default, derived `C × N` growth, extraction goals/current-question privacy, reader bounds/cost, failure warnings, usage, and token-ready character measurement without claiming a tokenizer or real-provider verification.
  - Remove stale shared-budget warning/truncation contracts rather than layering contradictory behavior. Record only evidence actually obtained.
- [ ] **Step 2: Run real-Obsidian loopback verification**
  - Update the ignored mock/verifier for main and reader SSE rounds. On both supported models exercise small/large Search and Fetch, two heavy Searches at setting 20, grep/read extraction, goal editing, reader failure with one warning, Stop/retry, Review consent, Auto, citations, usage, reload, and unchanged note bytes.
  - Assert exact request order/content privacy, per-call cap, no raw main-model continuations or persisted reader artifacts, and nine actual searches at setting 20 without a shared-budget warning. Record scenario/assertion counts and environment limits in Stage 40.
- [ ] **Step 3: Run the final clean gate and commit**
  - Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`
  - Expected: all checks pass and tracked status contains only intended source/tests/docs.
  - Commit docs with `git commit -m "docs: verify per-query web extraction"`; keep ignored loopback evidence uncommitted.

## Completion and Review

- Generate each task review from its recorded BASE through HEAD; resolve every Critical/Important finding before continuing.
- Run a fresh whole-branch review over the complete PR #47 rewrite, including the Review Focus cases, then update the PR description/evidence and require green GitHub CI.
- Leave PR #47 unmerged for user review. Resume PR2 only after the user merges revised PR1 and asks to continue.
