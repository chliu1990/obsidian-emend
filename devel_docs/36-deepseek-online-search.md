# Stage 36: DeepSeek online search

## Status and scope

Implementation is in progress on `feature/deepseek-online-search`. This record describes the approved design; verification evidence is added only after the behavior passes.

The feature adds opt-in web research to Ask, Discuss, and Brainstorm for the DeepSeek preset with `deepseek-flash` or `deepseek-v4-pro`. It does not add search to Edit, quick actions, or Modify Selection, and it does not implement Kimi/custom adapters.

## Chosen approach and alternatives

The chosen design is a DeepSeek-specific, bounded tool loop around the existing OpenAI-compatible streaming transport. The model receives only `web_search` and `web_fetch` function declarations, decides whether retrieval is needed, and may make multiple calls across multiple rounds. Emend executes each batch sequentially, supplies raw DeepSeek Search/Fetch API results as untrusted tool data, and accepts a final answer only from a terminal no-tool round.

A one-shot AI-generated query followed by one answer was rejected because it cannot browse follow-up sources or perform additional searches when the first results are insufficient. A general provider-neutral agent framework was rejected because OpenAI-compatible endpoints do not share a universal web-search schema and the additional abstraction would obscure paid-call and privacy boundaries.

## Controls, privacy, and cost

- The per-view **Web** control defaults to **Off**. **Review** displays each proposed call batch with editable queries/URLs before execution; **Auto** executes the same validated calls without that pause. Both modes disclose that model-generated arguments may contain note-derived text, DeepSeek performs retrieval, and successful search/fetch calls may be billed separately.
- Search/fetch endpoints receive only their visible tool arguments. Model rounds receive the ordinary captured context, history, additional notes, and instructions/skills. No request occurs when the control is changed, a note is opened, or a thread is loaded.
- Search uses five results and no full page content. Fetch is the explicit page-browsing path. Calls have no automatic retry or unsearched fallback. An enabled model may choose zero calls, in which case Emend does not claim retrieval happened.
- `maxWebToolCalls` defaults to 8 and accepts integers from 1 through 20. Every model-requested call counts; an over-cap batch is rejected before any call in that batch executes.
- Model-facing retrieved content has a 40,000-character per-submission budget and fetched pages have a 12,000-character per-page limit. Truncation uses `[...]` and explicit metadata. Further calls after budget exhaustion skip retrieval and receive an explicit tool result.

## Sources, usage, and persistence

Only actual HTTP(S) results become sources. Returned URLs are deduplicated in retrieval order and assigned stable `S1`, `S2`, ... IDs. Search/fetch arguments and retrieved content never become vault writes, instructions, or skills.

Usage covers every model round. It is provider-sourced only if every round supplies a complete valid usage triplet; otherwise Emend labels an estimate based on the exact round requests and responses. Search pricing and token counts are not invented.

Conversation schema 2 persists only the ready user's Review/Auto badge and ready assistant citation `{ id, title, url, snippet? }` metadata. Version 1 threads migrate on load/save, while future versions remain protected. Queries, fetch-call arguments, tool results, request bodies, retrieved content, and transient activity are not persisted.

## Implementation boundaries

`provider-stream.ts` adds standard streamed function-call parsing and continuation messages without changing ordinary requests. `web-search.ts` owns shared web types and validation; `deepseek-web.ts` owns provider retrieval and the bounded loop. Read-only coordination routes supported submissions without gaining a writer. Chat UI owns review/activity/source rendering, and conversation storage explicitly whitelists citation metadata.

Real-provider smoke verification, if performed, uses only the maintainer-provided temporary key already entered in the isolated `test_vault` SecretStorage. The key is never read through shell tools, printed, copied into source, or included in evidence. Loopback verification remains the required matrix; any real calls are minimal and explicitly authorized by the maintainer.
