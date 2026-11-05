# Roadmap: remaining web search

## Status and current baseline

DeepSeek online search is current behavior; this document now covers only unimplemented follow-up work. See [Stage 36](36-deepseek-online-search.md) for the implementation record. Kimi/custom search adapters and additional fetch capabilities are not implemented or approved by this roadmap.

The current DeepSeek implementation provides:

- A per-view composer **Web** control with **Off** (the default), **Review**, and **Auto** for Ask, Discuss, and Brainstorm using `deepseek-flash` or `deepseek-v4-pro`.
- Model-directed `web_search` and `web_fetch` calls across multiple rounds, with calls in each batch executed sequentially. Review permits editing each proposed query or URL before that batch runs; Auto runs validated calls directly.
- A default eight-call setting, normalized to 1–20 model-requested calls per submission; a 40,000-character shared retrieved-content budget; and a 12,000-character per-fetch limit.
- Stable source IDs and safe citations derived only from actual HTTP(S) retrieval results, plus conversation schema 2 persistence for ready Web badges and sanitized citation metadata.
- Read-only behavior with no note writer, no automatic retry, and no silent fallback to an unsearched answer. Kimi and custom providers and unsupported DeepSeek models produce a clear unsupported-capability error.
- Disclosure that model-generated arguments can contain note-derived text and that successful DeepSeek search/fetch calls may be billed separately.

Changing the control, opening a note, loading a thread, or rendering citations performs no retrieval. Search/fetch arguments, tool results, and retrieved content are not persisted. Retrieved text remains untrusted external data and never becomes a vault write, instruction, or skill.

## Deferred provider adapters

Kimi and custom providers require independent, source-backed capability declarations, request/response parsers, privacy review, and tests. An OpenAI-compatible chat-completions endpoint does not imply a common web-search schema. Never copy DeepSeek's `tools`, `tool_choice`, retrieval endpoints, citation events, or response shapes into another provider's request.

A future adapter must define:

- The exact supported provider/model combinations and whether retrieval is server-side, a client tool loop, or unsupported.
- Provider-specific request fields, streaming events, result parsing, and credential-safe errors.
- Every retrieval recipient and any separate third-party service or charge.
- Local declarative capability detection, or detection only during an explicit opted-in submission. Background discovery, speculative probes, and periodic refreshes remain prohibited.

Unknown or unsupported capabilities must produce a clear error rather than a best-effort shared payload or an ordinary unsearched response. A deliberate later submission with **Web: Off** is a separate user choice.

## Deferred retrieval enhancements

Changes to page extraction, pagination, source filtering, retrieval budgets, or other fetch behavior require their own design, privacy analysis, and verification. Stage 36 does not implement those enhancements, a general browsing agent, a universal provider tool schema, or configurable third-party retrieval services.

Any follow-up must preserve sequential validated calls, explicit opt-in, Stop/abort behavior, bounded content, credential redaction, and the absence of automatic retries or fallback providers. Search remains unavailable to Edit, quick actions, and Modify Selection unless a separate editing-specific design explicitly changes that boundary.

## Privacy, citations, and persistence requirements for follow-ups

Search can disclose note-derived text through model-generated queries and fetch URLs, and a provider may involve a separate retrieval service. Each adapter must disclose its actual recipient path and possible separate charges before calls run. Model rounds continue to send the ordinary captured note context, recent ready history, selected additional-note snapshots, and instructions/skills only after submission.

Citations must come only from actual provider/tool results with normalized credentialess HTTP(S) URLs. Never invent a URL, treat a model-written link as retrieved evidence, or execute retrieved markup or instructions. Preserve safe Obsidian DOM rendering, the no-`innerHTML` rule, stable source IDs, and citation sanitization on load.

Ready messages may persist only explicitly whitelisted Web badges and citation metadata. Do not persist credentials, request bodies, queries, fetch arguments, tool results, retrieved content, note snapshots, or transient activity. Preserve schema-version protection, malformed-file backups, and existing thread retention when notes are deleted.

## Required future tests

- Provider capability: each supported/unsupported provider-model combination, no shared-schema assumption, no background detection, and no silent unsearched fallback.
- Opt-in/privacy: zero network activity while off or while opening/reloading chat; disclosed note-derived arguments and retrieval recipients; no secret/header leakage; no search during Edit, quick actions, or Modify Selection.
- Streaming and retrieval: provider-specific events, sequential calls, Stop/abort, malformed events, HTTP/search errors, bounded content, no automatic retry, and unchanged note bytes.
- Citations and state: only returned sources render, malformed/missing URLs are rejected, safe schema round trips, absent-citation behavior, and transient/error/stopped states remain unpersisted.
- Integration: real Obsidian with CORS-enabled local provider/search mocks for every new adapter before it is described as verified. Do not make external or paid verification calls without explicit authorization.

## Non-goals

Autonomous agents, scheduled/background searches, a universal provider tool schema, implicit search on ambiguous questions, automatic note edits from retrieved content, and provider pricing/model-discovery calls are not part of this roadmap item. Context accounting and compression are specified separately in [Deferred roadmap: context management](future-context-management.md).
