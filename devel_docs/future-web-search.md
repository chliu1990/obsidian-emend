# Roadmap: remaining web search

## Status and current baseline

DeepSeek online search and per-query AI extraction are current behavior. See [Stage 36](36-deepseek-online-search.md) for the provider integration and [Stage 40](40-web-content-budget-diagnostics.md) for the reader, budget, diagnostics, and verification record. This document covers only unimplemented follow-up work; Kimi/custom search adapters and additional retrieval capabilities are not implemented or approved by this roadmap.

The current DeepSeek implementation provides:

- A per-view composer **Web** control with **Off** (the default), **Review**, and **Auto** for Ask, Discuss, and Brainstorm using `deepseek-flash` or `deepseek-v4-pro`.
- Model-directed `web_search` and `web_fetch` calls across multiple rounds, with calls in each batch executed sequentially and a required extraction goal per call. Review permits editing each query/URL and goal before that batch runs; Auto runs validated calls directly.
- A default eight-call setting normalized to 1–20 model-requested calls. A separate per-call serialized-output cap defaults to 20,000 characters and normalizes to 1,000–100,000; `N` calls contribute at most `C × N` characters with no independent total cap.
- Exactly one bounded AI extractor and verifier loop for every readable Search/Fetch result. The extractor receives the current question, extraction goal, target, and source catalog, then uses local literal grep/ranged-read tools for at most 6 model rounds, 4 local calls per round, 16 local calls total, and 4,000 characters per local result. It has no note context, chat history, instructions/skills, additional notes, vault access, or network tools. The verifier receives only the question, goal, and numbered claims with quotes.
- Verified claims with exact verbatim quotes, or quotes-only evidence when no claim survived, for the main model, which never receives raw retrieval. Claims that remain unsupported after up to two refine rounds are dropped. Stable citations derive only from successfully represented actual HTTP(S) results. Extractor/verifier/refine reasoning, payloads, and evidence extracts remain transient.
- Distinct unread-Fetch, aggregate extractor-failure, failed-Search, cap-fitting-omission, and skipped-call warnings, appended in that order. Verification failure falls back to quotes rather than raw content; aborts and Search/Fetch HTTP 400/401/402/413 remain fatal without retry.
- All-round main+extractor+verifier+refine provider-versus-estimated usage, possible separate model-round charges, and schema-2 persistence limited to ready Web badges, sanitized citation metadata, folded activity, main reasoning, and usage.
- Read-only behavior with no note writer or raw fallback; the only retrieval retry is the single bounded Search/Fetch retry, and no failure silently becomes an unsearched answer. Kimi/custom providers and unsupported DeepSeek models produce a clear unsupported-capability error.

Changing the control, opening a note, loading a thread, or rendering citations performs no retrieval. Retrieved text remains untrusted external data and never becomes a vault write, instruction, or skill.

## Deferred provider adapters

Kimi and custom providers require independent, source-backed capability declarations, request/response parsers, privacy review, and tests. An OpenAI-compatible chat-completions endpoint does not imply a common web-search schema. Never copy DeepSeek's tools, tool choice, retrieval endpoints, reader protocol, citation events, or response shapes into another provider's request.

A future adapter must define:

- The exact supported provider/model combinations and whether retrieval is server-side, a client tool loop, or unsupported.
- Provider-specific request fields, streaming events, result parsing, and credential-safe errors.
- Every retrieval and extraction recipient and any separate third-party service or charge.
- Local declarative capability detection, or detection only during an explicit opted-in submission. Background discovery, speculative probes, and periodic refreshes remain prohibited.

Unknown or unsupported capabilities must produce a clear error rather than a best-effort shared payload or an ordinary unsearched response. A deliberate later submission with **Web: Off** is a separate user choice.

## Deferred retrieval and measurement enhancements

Changes to page extraction, pagination, source filtering, reader behavior, retrieval budgets, or other fetch behavior require their own design, privacy analysis, and verification. Current per-call caps do not reserve provider context capacity; the separate context-management design remains responsible for actual assembled-request accounting and output reserve.

`measureWebContent` currently measures UTF-16 characters, not tokens. A future exact-token cap requires a deliberately compatible tokenizer, a visible token-denominated setting/migration, and tests for the selected model. Unknown model tokenizers must not silently borrow another encoding, and the existing character-based usage estimate must not be presented as exact tokenization.

Any follow-up must preserve sequential validated calls, explicit opt-in, current-question/goal privacy, Stop/abort behavior, bounded content and reader loops, credential redaction, the single bounded Search/Fetch retry with no retry for HTTP 400/401/402/413 or aborts, no raw fallback, and no fallback provider. Search remains unavailable to Edit, quick actions, and Modify Selection unless a separate editing-specific design explicitly changes that boundary.

## Privacy, citations, and persistence requirements for follow-ups

Search can disclose note-derived text through model-generated queries and fetch URLs, and a provider may involve separate retrieval and reader services. Each adapter must disclose its actual recipient paths and possible charges before calls run. Main model rounds continue to send ordinary captured context only after submission; extraction readers must not inherit note context, history, instructions/skills, additional notes, or vault access by default.

Citations must come only from actual provider/tool results with normalized credentialess HTTP(S) URLs and successful source representation. Never invent a URL, treat a model-written link as retrieved evidence, or execute retrieved markup or instructions. Preserve safe Obsidian DOM rendering, the no-`innerHTML` rule, stable source IDs, and citation sanitization on load.

Ready messages may persist only explicitly whitelisted Web badges, citation metadata, sanitized query/URL/outcome activity, main reasoning, and usage. Do not persist credentials, raw request bodies/tool arguments/results, retrieved content, reader payloads/evidence/reasoning, note snapshots, or transient activity. Preserve schema-version protection, malformed-file backups, and existing thread retention when notes are deleted.

## Required future tests

- Provider capability: each supported/unsupported provider-model combination, no shared-schema assumption, no background detection, and no silent unsearched fallback.
- Opt-in/privacy: zero network activity while off or while opening/reloading chat; disclosed note-derived arguments, current-question reader sharing, retrieval/reader recipients, and charges; no secret/header leakage; no search during Edit, quick actions, or Modify Selection.
- Streaming and retrieval: provider-specific events, sequential calls, Stop/abort, malformed events, HTTP/search errors, per-call and reader bounds, grounded output, the single bounded Search/Fetch retry and its fatal-status exclusions, no raw fallback, and unchanged note bytes.
- Citations and state: only successfully represented returned sources render, malformed/missing URLs are rejected, safe schema round trips, absent-citation behavior, and transient/error/stopped states remain unpersisted.
- Integration: real Obsidian with CORS-enabled local provider/search/reader mocks for every new adapter before it is described as verified. Do not make external or paid verification calls without explicit authorization.

## Non-goals

Autonomous agents, scheduled/background searches, a universal provider tool schema, implicit search on ambiguous questions, automatic note edits from retrieved content, and provider pricing/model-discovery calls are not part of this roadmap item. Context accounting and compression are specified separately in [Deferred roadmap: context management](future-context-management.md).
