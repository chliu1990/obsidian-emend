# Stage 36: DeepSeek online search

## Status and scope

Implementation is complete on `feature/deepseek-online-search`, with focused automated tests and real-Obsidian loopback verification covering the transport, retrieval loop, coordination, UI, settings, and schema migration. No real-provider or paid verification was performed or required.

The feature adds opt-in web research to Ask, Discuss, and Brainstorm for the DeepSeek preset with `deepseek-flash` or `deepseek-v4-pro`. It does not add search to Edit, quick actions, or Modify Selection, and it does not implement Kimi/custom adapters. Unsupported providers/models produce a clear error and never silently fall back to ordinary unsearched chat.

## Chosen approach and alternatives

The implementation is a DeepSeek-specific, bounded tool loop around the existing OpenAI-compatible streaming transport. The model receives only `web_search` and `web_fetch` function declarations, decides whether retrieval is needed, and may make multiple calls across multiple rounds. Emend executes each batch sequentially, supplies raw DeepSeek Search/Fetch API results as untrusted tool data, and accepts a final answer only from a terminal no-tool round. Reasoning can stream across rounds; intermediate tool-round prose is not emitted as the final answer.

A one-shot AI-generated query followed by one answer was rejected because it cannot browse follow-up sources or perform additional searches when the first results are insufficient. A general provider-neutral agent framework was rejected because OpenAI-compatible endpoints do not share a universal web-search schema and the additional abstraction would obscure paid-call and privacy boundaries.

## Controls, privacy, and cost

- The per-view composer **Web** control defaults to **Off** and offers **Review** and **Auto** in read-only modes. **Review** displays each proposed call batch with editable queries/URLs before execution; **Auto** executes the same validated calls without that pause. Both modes disclose that model-generated arguments may contain note-derived text, DeepSeek performs retrieval, successful search/fetch calls may be billed separately, and query/URL/outcome metadata is stored locally with ready chats.
- Search/fetch endpoints receive only their visible tool arguments. Model rounds receive the ordinary captured context, history, additional notes, and instructions/skills. No request occurs when the control is changed, a note is opened, or a thread is loaded.
- Search requests five results with page content when available, allowing the model to answer without a separate Fetch. Search result content is capped at 6,000 characters per result with explicit truncation. Fetch is reserved for necessary page content that Search did not provide, rather than routine result-page browsing.
- Expected Fetch failures, including site-policy/extraction failures and empty pages, return an explicit unread tool outcome and let the model finish with other evidence. The ready answer includes a deterministic `Emend could not read N requested page(s). The answer may be incomplete.` warning. Aborts and Search failures remain fatal, as do Fetch HTTP 400/401/402/413. No automatic retry occurs.
- `maxWebToolCalls` defaults to 8 and normalizes to integers from 1 through 20. Every model-requested call counts; an over-cap batch is rejected before any call in that batch executes.
- Model-facing retrieved content has a 40,000-character per-submission budget and fetched pages have a 12,000-character per-page limit. Truncation uses `[...]` and explicit metadata. Further calls after budget exhaustion skip retrieval and receive an explicit tool result.

## Sources, usage, and persistence

Only actual HTTP(S) results become sources. Returned URLs are deduplicated in retrieval order and assigned stable `S1`, `S2`, ... IDs. Ready answers can render folded Web activity and source lists with safe external links and optional provider snippets; copying includes that source list. Search/fetch arguments and retrieved content never become vault writes, instructions, or skills.

Usage covers every model round. It is provider-sourced only if every round supplies a complete valid usage triplet; otherwise Emend labels an estimate based on the exact round requests and responses. Search pricing and token counts are not invented.

Conversation schema 2 persists the ready user's Review/Auto badge, ready assistant citation `{ id, title, url, snippet? }` metadata, and folded activity `{ type, target, status }` where status is completed, failed, or skipped. Search targets are validated single-line queries and fetch targets are credentialess HTTP(S) URLs. Version 1 threads load normally and are written as schema 2 on the next save, while future versions remain protected. Raw tool arguments/results, request bodies, retrieved content, and transient activity are not persisted. Chat also preserves the reader's position when not following latest. New submissions and streaming follow the bottom, successful completion aligns the completed response's header and beginning to the top after current Markdown layouts settle, and unrelated re-renders preserve upward readers.

## Implementation boundaries

`provider-stream.ts` adds standard streamed function-call parsing and continuation messages without changing ordinary requests. `web-search.ts` owns shared web types and validation; `deepseek-web.ts` owns provider retrieval and the bounded loop; `web-search-modal.ts` owns editable batch review. Read-only coordination routes supported submissions without gaining a writer. Chat UI owns the Off/Review/Auto control, disclosure, activity, and source rendering, and conversation storage explicitly whitelists citation metadata.

## Verification evidence

- Date: 2026-11-06, Asia/Shanghai.
- Runtime: official Obsidian 1.15.0 AppImage, isolated Xvfb `:99`, CDP port `19222`, synthetic vault/configuration under ignored `test_vault/emend-web-verify/`.
- Provider: CORS loopback chat/search/fetch mock at `127.0.0.1:8765`, fragmented SSE tool calls, dummy SecretStorage credential. No real account/key, external/paid call, private note, or pre-existing vault/profile was used.
- Result: **17/17 real-Obsidian scenarios and 57 UI/runtime assertions passed**, plus **21 mock smoke assertions**. No final failures or unexercised requested matrix items remained.
- Evidence: `test_vault/emend-web-verify/evidence/summary.json`, 24 screenshots, sanitized request logs, persistence audit, and mock smoke output. Reproduction: `node test_vault/emend-web-verify/verify.mjs` after starting the isolated runtime through that script.

The matrix covered:

1. Off streaming with no advertised tools or retrieval and unchanged note bytes.
2. Review displaying the generated query, executing its edited form, and rendering the actual source.
3. Review cancellation preventing the entire batch and any ready response.
4. Auto performing two sequential searches across rounds plus fetch, continuing tool results, and rendering two deduplicated sources with first-seen titles.
5. A model-chosen zero-tool answer with no retrieval or Sources section.
6. Ready content and citations surviving actual application reload.
7. Default limit 8 rejecting a nine-call batch before any call and producing no ready partial response.
8. Search HTTP 503 producing no ready response, followed by a successful fresh retry.
9. Stop producing only a stopped non-ready response, followed by a successful retry.
10. Unsupported custom provider producing zero requests and no unsearched fallback.
11. Edit disabling Web, advertising no tools, making no retrieval, and applying the expected tracked change.
12. Quick action advertising no tools, making no retrieval, and applying the expected tracked change.
13. Schema-2 persistence and transient-data audit across all synthetic threads.
14. Modify Selection advertising no tools, making no retrieval, replacing only the captured range, and preserving native undo/redo.
15. Target-note switching aborting a pending stream before retrieval, leaving both notes unchanged, and permitting a successful retry.
16. Explicit fetch truncation to 12,000 content characters plus `[...]`, and malformed credentialed citation URLs being discarded before safe UI rendering.
17. Review/Auto disclosure through the Web selector tooltip, live activity, actual Copy with only actual sources, provider/estimated usage labels, and a 240px composer without horizontal overflow or a large bottom disclosure.

The original baseline audit covered **19 sanitized scenario logs and 36 request entries**, with zero header/credential leaks. All **15 persisted chat threads** used schema 2. Before folded activity was requested, generated queries, tool arguments/results, request bodies, web activity, stopped/error content, unsafe URLs, oversized retrieved content, and dummy credentials were absent; only ready Web badges and citation metadata remained. Follow-up verification for folded activity, latest-message scrolling, and Fetch recovery is recorded below after completion.

An independent whole-branch code/security review found no Critical issues and two Important transport issues. Regression tests now prove fragmented tool-call IDs/names assemble correctly and undeclared tool-only Off responses retain the empty-response error. Both fixes passed RED→GREEN verification and the full suite. The review's Minor items are deferred and recorded in the implementation ledger, not hidden in release claims.

## Issue #29 follow-up verification

A second independent review confirmed the activity, retrieval, and HTTP-status boundaries but identified a completion-relayout scroll bug and a lint failure. The scroll fix now waits for all current-generation Markdown layouts before restoring an upward-reading position, with stale generations ignored. Both findings passed RED→GREEN regression tests; a later successful Fetch of the same URL also clears its unread warning.

The targeted real-Obsidian matrix used the same isolated runtime and loopback-only policy. Result: **7/7 scenarios and 38 assertions passed**, with **14 screenshots**, no runtime defects, and no unexercised requested items. Evidence is under `test_vault/emend-web-verify/evidence-issue29/`, with concise results in `issue29-evidence.json` and full results in `summary.json`.

- Review edited actual Search/Fetch targets; folded completed/failed outcomes and sanitized schema-2 activity survived actual reload without raw results/page content.
- Four seed responses plus streamed Markdown stayed at distance zero from newest on submission, streaming, final render, and reload. An upward reader's position remained exactly `120 → 120` across an unrelated mode re-render.
- Search sent `need_content: true`, truncated returned content to 6,000 characters plus `[...]`, and required zero Fetch calls.
- GitHub 403 and empty Fetch each ran once sequentially with no retry; the answer remained ready with a two-page unread warning and folded failed outcomes.
- Fetch 401 and Search 503 remained fatal without continuation/retry or a ready partial response.
- Seven scenario logs contained 21 request entries with zero header/credential leaks; all six follow-up threads used schema 2 and excluded raw tool/page content and credentials.

Reproduce with `node test_vault/emend-web-verify/verify.mjs --issue29`. All tested notes remained byte-for-byte unchanged. No real-provider smoke was run.

## Compact disclosure verification

The compact UI follow-up passed **1/1 real-Obsidian scenario with 4 assertions**: zero `.emend-chat-web-disclosure` bottom blocks, full note-context/billing/local-activity disclosure in the Web selector tooltip, no horizontal overflow at 240px, and a reduced 141.5px composer height. Evidence is in `test_vault/emend-web-verify/evidence-compact-ui/compact-ui-evidence.json` and `compact-ui-240.png`. The verified plugin bundle matched the production root bundle. A separate future UI PR for compact quick-action and additional-note controls is recorded in `future-discovery-and-workflows.md`.

## Clean local gate

Run from the repository root:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: locked install succeeded; **31 Vitest files and 622 tests passed**; ESLint reported no findings; strict TypeScript and production esbuild succeeded; `git diff --check` reported no whitespace errors. No real-provider smoke was run. All owned mock, Xvfb, and Obsidian processes were stopped after verification.
