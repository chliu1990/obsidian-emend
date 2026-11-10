# Stage 36: DeepSeek online search

## Status and scope

DeepSeek online search is implemented for Ask, Discuss, and Brainstorm with `deepseek-flash` and `deepseek-v4-pro`. The composer Web control defaults to **Off** and offers **Review** and **Auto**. Edit, quick actions, Modify Selection, Kimi/custom providers, and unsupported DeepSeek models do not gain Web retrieval; unsupported combinations fail clearly without an ordinary unsearched fallback.

All provider evidence in this record is loopback-only. No real-provider or paid verification was performed.

## Retrieval and extraction architecture

The main model receives only `web_search` and `web_fetch` declarations and directs sequential calls across multiple rounds. Every call includes a required, nonempty extraction goal of 1–1000 Unicode code points. **Review** displays and permits editing each query/URL and goal before that batch runs while preserving call IDs and tool names; **Auto** performs the same validation without the pause. Retrieval and reader requests begin only after submission and, in Review, consent.

Every readable Search/Fetch result invokes exactly one AI extraction reader using the same configured provider/model and streaming transport. Canonical retrieved title, snippet, summary, and content remain temporarily available to local reader tools without a raw-size truncation limit. The main answering model never receives raw retrieved content; it receives only a closed, validated payload containing source IDs, extracted facts, and verbatim evidence. Only successfully represented actual HTTP(S) results become stable citations.

The reader receives the current typed question, reviewed extraction goal and target, and a source catalog. It has empty chat history and receives no active-note snapshot/path, earlier chat, instructions/skills, additional notes, or vault content. Its only tools are local, case-insensitive literal grep and UTF-16 ranged read over temporary canonical sources. Limits are 6 reader model rounds, 4 local calls per round, 16 local calls total, and 4,000 characters per local tool result. It has no network, vault, or note-writing tool.

Reader terminal output must be closed JSON with either grounded evidence or an explicit no-relevant-evidence outcome. Emend rejects malformed, duplicate, invented, ungrounded, or over-cap output rather than truncating it or passing raw retrieval to the main model. Reader reasoning and reader artifacts are transient and are not appended to main-answer reasoning.

## Budgets, privacy, and cost

- `maxWebToolCalls` defaults to 8 and normalizes to 1–20 model-requested calls. An over-cap batch executes none of its calls.
- `maxWebContentCharactersPerCall` defaults to 20,000 and normalizes to 1,000–100,000. It applies independently to each complete serialized Search/Fetch extraction payload. For cap `C` and `N` calls, tool payloads contribute at most `C × N` characters; there is no independent total retrieval cap.
- `measureWebContent` currently reports UTF-16 character length behind a token-ready measurement interface. Emend does not claim exact tokenization, and `ceil(characters / 4)` remains only a usage fallback estimate.
- Main Web rounds receive ordinary captured note context, recent ready history, additional notes, and instructions/skills. Search/Fetch endpoints receive only the validated query or URL. Reader requests receive only the isolated question/goal/target/catalog and bounded local tool continuations.
- Review and Auto disclose that model arguments may contain note-derived text, the current question is sent to the reader for every call, retrieval and reader model rounds may incur separate charges, and sanitized activity metadata is stored locally. Changing controls, opening notes, and loading threads perform no request.

## Failures, usage, and persistence

Expected Fetch failures, including empty pages and target-site extraction/policy failures, return explicit unread outcomes without invoking a reader. Their deterministic unread-page warning remains distinct from extraction failures. Search failures and Fetch HTTP 400/401/402/413 remain fatal. Every abort cancels the entire submission.

A non-abort reader/provider/output/cap failure produces only `extraction_failed`, excludes that query's unextracted sources, and permits the main model to use other successful evidence. Chat appends exactly one aggregate warning: `Emend could not extract information from N web query. The answer may be incomplete.` for one, or the corresponding `N web queries` plural. The warning persists as ordinary ready content. There is no automatic reader retry or raw-content fallback.

Usage covers every main and reader model round. Provider-sourced totals require a complete valid usage triplet from every round; otherwise all rounds are independently estimated and labelled **Estimated**. Search, retrieval, and reader prices or token counts are not invented.

Conversation schema 2 continues to persist only ready Review/Auto badges, sanitized result-backed citations, folded query/URL/outcome activity, main-answer reasoning, and usage. Raw retrieval, request bodies/tool arguments/results, reader payloads, evidence extracts, reader reasoning, transient extraction state, and loading/error/stopped states are not persisted. Web retrieval has no note writer.

## Implementation boundaries

`provider-stream.ts` owns streamed function-call parsing and continuation messages. `web-search.ts` owns shared Web types, closed Search/Fetch/extraction-goal validation, disclosures, and provider/model support. `web-search-modal.ts` owns editable batch review. `web-extraction.ts` owns canonical documents, bounded local tools, output grounding, and serialized-cap checks. `web-content-measurement.ts` isolates character measurement. `web-extraction-reader.ts` owns the bounded reader loop. `deepseek-web.ts` owns retrieval, sequential main-loop integration, staged source registration, and failure outcomes. Read-only coordination supplies the isolated current question and configured cap and aggregates all-round usage without gaining a writer.

## Verification

The original Stage 36 matrix exercised the real-Obsidian Off/Review/Auto controls, sequential retrieval, citations, fatal and unread Fetch behavior, Stop/retry, unsupported providers, editing boundaries, safe rendering, schema-2 reload, and note-byte preservation through local mocks. The per-query reader replacement supersedes the former raw-retrieval and shared-truncation behavior; its current automated and real-Obsidian evidence is recorded in [Stage 40](40-web-content-budget-diagnostics.md).

Run the local gate from the repository root:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Use only the ignored `test_vault/emend-web-verify/` synthetic vault, loopback mocks, and dummy credentials for manual reproduction. No real-provider smoke is claimed.
