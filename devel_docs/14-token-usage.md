# Stage 14: Display actual or estimated token usage

## Goal

Show provider-reported token usage when a valid usage event arrives and a clearly labeled character-based estimate otherwise. Add a per-provider compatibility control for requesting usage, display total/prompt/completion values on completed assistant messages including Edit summaries, and persist usage without changing the existing conversation schema or request/write guards.

## Plan

1. Add test-first coverage for SSE usage validation, request-body compatibility, provider-versus-estimated resolution, exact estimate inputs, completed-message footers, Edit results, settings normalization, and conversation round trips.
2. Add a focused token-usage module and resolve usage at the chat coordinator boundary. Preserve the transport's numeric provider shape and add the source only to chat results.
3. Add `requestUsage` to provider settings, send `stream_options: { include_usage: true }` only when enabled, and leave provider rejection as an error without retrying.
4. Render usage only for ready assistant messages, persist its source in schema version 1, and normalize legacy source-less usage as provider-reported.
5. Run the full local gate and real isolated Obsidian checks with a loopback SSE mock and dummy credentials. Verify provider usage, estimates, actual reload restoration, and toggle-off request bodies without a paid provider call.
6. Update usage/privacy guidance, self-review, commit and push the implementation, verify the dedicated Gitea runner, then record CI evidence in a documentation-only commit and verify that run too.

## Implementation details

- `src/token-usage.ts` defines `TokenUsage`, which extends the Stage 05 numeric provider shape with `source: 'provider' | 'estimated'`. Valid provider values, including zero, take precedence. Otherwise prompt and completion counts are estimated independently as `max(1, ceil(characterCount / 4))`; estimated total is their sum.
- Prompt estimates count the exact system prompt, retained history content, and constructed current user prompt. Completion estimates count response content plus reasoning. `formatTokenUsage()` labels the source and displays total, prompt, and completion values. No pricing, tokenizer, model-metadata request, or new dependency was added.
- `src/provider-stream.ts` accepts only complete nonnegative integer usage triplets and ignores absent, partial, nonnumeric, negative, or fractional usage. It adds `stream_options.include_usage` only when the active provider's `requestUsage` is true. HTTP and streaming failures retain the existing credential-safe behavior and are never retried automatically.
- `src/settings.ts` defaults DeepSeek and Kimi to request usage and custom providers to opt in explicitly. Normalization preserves valid booleans and falls back per provider for missing or invalid values without changing keys, models, or base URLs. The active provider settings include a **Request token usage** toggle with compatibility guidance.
- `src/request-coordinator.ts` resolves usage from the exact request and completed stream for read-only chat and full-note Edit. Edit results now carry usage alongside the existing applied/change-count fields; selection editing and note-writer contracts are unchanged.
- `src/chat-view.ts` displays the formatted footer only on ready assistant messages, including concise Edit confirmations and no-op summaries. Loading, stopped, error, and user messages do not show a usage footer. Existing streaming, abort, ready-transition, persistence, and write guards remain in place.
- `src/conversation-store.ts` persists usage and its source in the existing version-1 schema. Legacy provider usage without a source remains readable and is normalized to `source: 'provider'`; malformed usage entries are still filtered.
- `styles.css`, `README.md`, and `AGENTS.md` document and style the new footer, compatibility setting, estimate semantics, local persistence, and privacy behavior.

## Verification results

- Focused RED: `npx vitest run tests/token-usage.test.ts tests/provider-stream.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts tests/conversation-store.test.ts tests/settings.test.ts` failed on the missing token-usage module and 14 behavior assertions. The failures covered missing source resolution, missing footers, missing source persistence, negative/fractional SSE counts, absent opt-in request options, missing Edit usage, and missing provider defaults. Existing no-retry and transient-footer guards passed as intended.
- Focused GREEN: the same six-file run passed 104 tests after implementation. The only intermediate failure was a footer test helper searching the outer container instead of the actual nested message element; correcting the helper did not change production behavior.
- Full local gate after implementation: `npm test` passed 17 files and 289 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real verification used the production bundle in ignored `test_vault/stage14_vault`, isolated profile `.emend-test-profile-14`, Obsidian 1.14.5 on macOS, CDP port 9229, and a CORS-enabled loopback SSE mock on port 8794 with dummy credentials. No real or paid provider call was made. The fresh vault's trust prompt was accepted only in this disposable profile, and both isolated processes were stopped afterward.
- The valid-usage stream displayed `Provider usage · 17 total · 12 prompt · 5 completion`. The no-usage stream displayed `Estimated usage · 112 total · 102 prompt · 10 completion`. The estimate matched the actual request's system prompt, retained history, current user prompt, response content, and reasoning.
- The version-1 thread stored the provider and estimated sources with the displayed numbers. After an actual `location.reload()`, the two completed exchanges and both footers returned with identical content, values, and sources.
- The rendered **Request token usage** toggle changed the custom provider from true to false. The first two logged requests contained `stream_options: { include_usage: true }`; the next request omitted `stream_options` and still displayed a clearly estimated footer. Model and base URL remained unchanged.
- The fixture note remained byte-for-byte unchanged at SHA-256 `c0b9631c5a2f3cbca4e04058524dde385c2250af2efa16b4ae45fb839673061e` before and after all real checks. No generated bundle, vault content, mock request log, local profile, or credential belongs in either commit.
- Self-review confirmed one opt-in streaming transport, no retry or pricing path, no new dependency, no change to selection/note-writer contracts, no usage footer outside ready assistant messages, schema-1 legacy compatibility, and no generated, vault, mock-log, local-profile, or secret file in the git diff.
