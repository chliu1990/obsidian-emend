# Stage 05: Desktop streaming provider

## Goal

Implement one desktop streaming transport for DeepSeek, Kimi, and custom OpenAI-compatible providers. Expose content, reasoning, usage, and completion events while preserving the temporary legacy chat and inline-suggestion runtime through accumulating adapters.

## Plan

1. Specify the SSE parser with focused tests for line endings, comments, multi-line data, split JSON and UTF-8, content and reasoning deltas, usage, done sentinels, malformed data, provider errors, and missing deltas.
2. Run the parser tests against the missing module, then implement incremental `TextDecoder` and line buffering until they pass.
3. Specify the fetch transport and legacy adapters with mocked streams, including exact request construction, bounded history, aborts, HTTP and network errors, empty responses, credential-safe errors, and the legacy JSON protocol.
4. Replace `requestUrl` with the streaming transport, retain only thin temporary adapters and the legacy parser, and mark the plugin desktop-only.
5. Update current-behavior guidance, run the full local gate, self-review the diff, and verify both implementation and documentation-evidence commits on the dedicated Gitea runner.

## Implementation details

- Added `src/provider-stream.ts` with the Stage 05 request, event, result, and token-usage contracts. `createSseParser()` buffers incomplete lines across reads, decodes split UTF-8 with `TextDecoder` in streaming mode, joins multi-line `data:` fields, ignores comments, and emits typed content, reasoning, usage, and done events.
- `requestAiResponse()` validates HTTP(S) base URLs and required credentials/model settings, trims trailing slashes, and appends `/chat/completions`. It sends a bearer key, `stream: true`, `temperature: 0.3`, the configured `reasoning_effort`, a system message, at most the last eight history messages, and the current user message. `stream_options` is intentionally deferred to Stage 14.
- The transport reads only the response's `ReadableStream`, emits parsed events, and returns accumulated content and reasoning with optional usage. It propagates aborts, reports provider HTTP/stream/network errors, rejects responses with no text, redacts credentials from errors, and never retries or falls back to another transport.
- Replaced the old provider HTTP implementation in `src/providers.ts`. The deprecated Stage 05 chat and inline adapters create a local `AbortController`, accumulate through `requestAiResponse()`, and retain the existing prompt builders and answer/edit JSON parser. They do not render incrementally or write note content during streaming. Stage 06 owns their removal and chat UI streaming.
- Set `manifest.json` `isDesktopOnly` to `true`. Updated `README.md` and `AGENTS.md` to describe desktop `fetch`/SSE transport, bounded history, reasoning effort, credential handling, and the still-accumulating legacy UI.
- Added `tests/provider-stream.test.ts` and `tests/providers.test.ts`. All HTTP and stream behavior uses mocked `fetch`, `Response`, and `ReadableStream`; tests contain only fake credentials and make no provider requests. No runtime dependency was added.

## Verification results

- Parser red: `npx vitest run tests/provider-stream.test.ts` failed because `src/provider-stream.ts` did not exist. Parser green after implementation: 11 tests passed. A malformed multi-line JSON test fixture was corrected before the green run; the implementation was not changed to accommodate the invalid fixture.
- Transport red: the focused suite failed all 12 new transport tests because `requestAiResponse` was not implemented, while the 11 parser tests remained green. Transport green: all 23 parser/transport tests passed with mocked streams.
- Adapter red: four of five legacy adapter tests failed because the old path still called `requestUrl`; the remaining invalid-response test already rejected. Adapter green: `npx vitest run tests/providers.test.ts tests/provider-stream.test.ts` passed 2 files and 28 tests.
- Full local gate: `npm test` passed 6 files and 73 tests; `npm run lint` passed; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed. An intermediate lint run caught deprecated annotations, the Obsidian `fetch` restriction, and strict test typing issues; these were resolved and the complete gate was rerun successfully.
- Self-review confirmed one OpenAI-compatible HTTP stack, no Gemini/Claude transport, no `stream_options`, no silent retry, no partial note writes, no incremental-chat claim, no real credentials/provider calls, and no generated bundle or vault content in git. Obsidian UI and real-provider behavior were not exercised in this stage.
