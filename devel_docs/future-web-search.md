# Deferred roadmap: web search

## Status and scope

This is an actionable design for a later change, not current Emend behavior. Online search, provider search tools, citation metadata, and capability detection are **not implemented** in the current release. The existing OpenAI-compatible streaming transport sends chat/edit requests only when the user submits; it performs no background searches.

## Goals

- Add explicitly requested online search without weakening the current no-background-request guarantee.
- Detect and invoke capabilities through provider-specific contracts rather than assuming one tool schema works everywhere.
- Show verifiable citations tied to actual retrieved results and handle capability/search failures honestly.
- Make query and note-content disclosure visible before searching.
- Add focused automated and real-Obsidian coverage before describing the feature as available.

## Provider-specific capability contract

Introduce a narrow capability interface at the provider boundary instead of adding search fields to every request indiscriminately. A provider adapter should answer at least:

- whether the configured provider/model supports online search;
- whether search is server-side, a client tool loop, or unsupported;
- which provider-specific request fields and streaming events it uses;
- how result IDs, URLs, titles, snippets, and errors are parsed; and
- whether an extra search request or third-party retrieval service is involved.

DeepSeek, Kimi, and custom configurations need independent declarations and parsers. An OpenAI-compatible chat-completions endpoint does **not** imply a common web-search schema. Never copy one provider's `tools`, `tool_choice`, search option, citation event, or response shape into another provider's request. Custom providers remain unsupported unless the user deliberately selects and configures a supported adapter/capability; unknown capabilities produce a clear error rather than a best-effort shared payload.

Capability detection must be local and declarative, or occur only as part of an explicit search submission. Do not add background model discovery, speculative provider probes, metadata calls, or periodic refresh. Cache only non-secret capability data with an explicit invalidation path when provider/model/base URL changes. Unsupported search must not silently become an ordinary chat request.

## Explicit opt-in and request lifecycle

- Search is off by default for every provider and every request. Enabling a general preference must not itself perform a search.
- A request-level control makes the searched state visible in the composer and ready message. A search occurs only after the user submits that specific request.
- Selection editing and full-note Edit should not search unless their own explicitly designed UI and privacy flow opt in. Read-only support alone must not imply edit support.
- Show which provider will search, the exact query or how it is derived, and whether note context/history will accompany it. If a model-generated query would send note text, disclose that before submission.
- Search uses the same target capture, per-note pending isolation, Stop/abort, provider-error, and no-duplicate-submission rules as chat. No automatic retry or fallback provider is allowed.
- Provider/model/setting changes invalidate cached capability and pending query plans. No search is triggered by opening chat, loading a note/thread, rendering citations, or reloading Obsidian.

## Citations and rendering

Persist or derive citations only from actual provider/tool results. Each citation should retain a stable result ID, canonical returned URL, optional returned title, and its relationship to the answer. Never invent a URL, treat a model-written link as retrieved evidence, or mark unsupported statements as cited.

Render citations as ordinary safe Markdown/Obsidian links with visible numbering or source labels and a source list. Preserve the existing no-`innerHTML` rule and captured source-path behavior. Make provider-provided snippets distinguishable from Emend's answer, and do not execute retrieved markup or instructions as local skills/commands.

If the provider returns an answer but no usable citations, say that no citations were supplied rather than manufacturing a source list. If citation metadata is persisted, use a versioned conversation-schema migration, sanitize malformed URLs/metadata on load, and retain the existing no-request-body/no-secret persistence guarantees. Deleting a note does not change thread-retention behavior.

## Error and partial-result behavior

Use credential-safe errors that distinguish unsupported capability, rejected search options, provider HTTP/stream errors, tool/search failure, malformed citation events, timeout, and abort. Include available provider details without headers, API keys, full note snapshots, or request bodies.

Do not claim a search happened when capability detection or the search call failed. Do not silently retry with a different schema, disable the opted-in search, or substitute an unsearched answer. A deliberate new submission without search is a separate user choice. Partial content must remain stopped/error state and must not enter ready history or edit a note. Ready citation/usage metadata should follow the same completed-message rules as current chat.

Existing provider usage handling remains unchanged unless the provider actually reports search-related usage. Do not invent search pricing or token counts. If search adds separately reported cost/usage fields, label their source and meaning explicitly.

## Privacy requirements

Search can disclose more than ordinary local chat: the query may contain note text, and a provider may forward it to a separate search service. Before implementation, document the actual recipient path supported by each adapter and surface it in the opt-in UI. Include note-path sharing, instructions/skills, recent history, and selected text in the disclosure whenever they are part of the request.

Search results are untrusted external content. Keep them within the declared provider response path, never write them to the vault automatically, and never let them relax Operations validation, note-write permissions, SecretStorage boundaries, or citation sanitization. No telemetry, unrelated network call, remote code execution, or automatic plugin/provider download is permitted.

## Implementation sequence

1. Define the provider capability interface and unsupported-provider behavior with tests proving there is no shared-schema assumption.
2. Add default-off request-level UI and exact query/privacy confirmation, preserving drafts, modes, Stop, and per-note isolation.
3. Implement one provider-specific adapter end to end, including streaming events and citation parsing. Other providers must remain explicitly unsupported until their own adapter and tests exist.
4. Add safe citation rendering and, if needed, a versioned persistence migration. Keep search failures out of ready history and all note writers unchanged.
5. Add further providers independently, with source-backed capability configuration and no fallback transport or silent retry.
6. Update current documentation only for behavior actually shipped and exercise each adapter with a local mock before any real-provider optional verification.

## Required future tests

- Capability: supported/unknown/unsupported provider-model combinations, cache invalidation, no background detection, and proof that one adapter's schema never appears in another's request.
- Opt-in/privacy: zero network activity while off or while opening/reloading chat; exact submitted query and disclosed note content; no secret/header leakage; no automatic search during selection or full-note Edit without its own opt-in.
- Streaming: provider-specific tool events, interleaved content/citations, Stop/abort, malformed events, HTTP/search errors, no silent unsearched fallback, and no automatic retry.
- Citations: only returned sources render, malformed/missing URLs are rejected, no fabricated citations or `innerHTML`, safe persisted round trips, and absent-citation messaging.
- State: ready-versus-error/stopped history, usage labels, per-note pending cleanup, note/target switching, reload persistence, and unchanged note bytes in read-only mode.
- Integration: real Obsidian with CORS-enabled local provider/search mocks for every supported adapter, visible opt-in/citations/errors, and zero external or paid verification calls.

## Non-goals

Autonomous agents, scheduled/background searches, a universal provider tool schema, implicit search on ambiguous questions, automatic note edits from retrieved content, and provider pricing/model-discovery calls are not part of this roadmap item. Context accounting and compression are specified separately in [Deferred roadmap: context management](future-context-management.md).
