# Stage 06: Streamed read-only chat

## Goal

Deliver streamed Ask, Discuss, and Brainstorm chat with immutable note context, current instruction/skill prompts, safe Markdown and folded reasoning, mode controls, and request cancellation. Remove the legacy inline-suggestion and JSON response UX without adding Edit behavior or deleting the dormant diff module.

## Plan

1. Specify context snapshots and bounded windows with focused tests for short and long notes, caret/selection centering, budget redistribution, exact omission markers, and opt-in paths.
2. Specify a writer-free coordinator with tests for all read-only modes, streaming callbacks, per-request instructions, skill/AGENTS ordering, eight-message history, prompt privacy, abort signals, and error/abort behavior.
3. Run both suites against missing modules, implement the domain layer to green, then replace the legacy chat and plugin orchestration with streamed callbacks and synchronous context capture.
4. Add per-session segmented modes, badges/placeholders, model labels, Stop, copy, animation-frame Markdown rendering, folded reasoning, and close cleanup. Remove inline suggestions and legacy JSON adapters/branching while retaining the dormant diff module.
5. Update current-behavior documentation, run the full gate, self-review, exercise the built plugin in ignored `test_vault/` against a local CORS-enabled SSE mock with dummy credentials, and verify implementation and evidence commits on the dedicated Gitea runner.

## Implementation details

- Added `src/context.ts` with `RequestContext`, synchronous `captureRequestContext()`, and `getBoundedContext()`. Snapshots retain the target `TFile`, full source, selection offsets, note label, optional vault-qualified path, and bounded Markdown before asynchronous work.
- Added `src/request-coordinator.ts` with a submission contract restricted to `Exclude<Mode, 'edit'>`. Its dependencies contain only the active provider, instruction loader, and streaming transport—no writer. Every submission reloads instructions, builds the mode prompt with skills before AGENTS, caps history at eight messages, and forwards content/reasoning events through callbacks.
- Reworked `src/main.ts` to capture the active or last-active still-open Markdown view and construct the read-only coordinator. Removed inline command/extension logic and legacy JSON edit branching. The dormant diff extension and module remain registered for Stage 08, but chat cannot create previews or writes.
- Rewrote `src/chat-view.ts` for streamed content and reasoning. It provides Ask/Discuss/Brainstorm segmented controls, per-session mode retention, badges/placeholders, model labels, copy, duplicate-submit prevention, and AbortController-backed Stop. Success, errors, and stops clear loading state; stopped/error messages are not ready history.
- Assistant responses use Obsidian `MarkdownRenderer` with the captured file path as source path. Stream rendering is coalesced to one animation frame, stale asynchronous renders cannot replace newer content, and close cancels pending frames and aborts active work. Reasoning uses plain text in a closed `details` element; no model output uses `innerHTML`.
- Deleted `src/inline-suggestions.ts`, `src/providers.ts`, their legacy adapter tests, inline styles, and the old JSON protocol. Updated `README.md`, `AGENTS.md`, and the default-mode setting description to match current read-only behavior and instruction/skill privacy.

## Verification results

- Focused red: `npx vitest run tests/context.test.ts tests/request-coordinator.test.ts` failed both suites because `src/context.ts` and `src/request-coordinator.ts` did not exist. This was the expected missing-feature state with zero tests collected.
- Focused green: the same command passed 2 files and 18 tests after the domain implementation.
- Intermediate verification: `npx tsc -noEmit -skipLibCheck` and `npm test` passed with 7 files and 86 tests. Initial lint identified a popout-safe animation-frame API and test callback method signatures; those issues were corrected before the final gate.
- Final local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed on the implementation. Vitest reports 7 files and 86 tests; the production build includes strict TypeScript checking. An earlier gate run caught sentence-case setting copy, which was corrected before the successful complete rerun.
- Self-review found no chat writer, legacy adapter/inline reference, active diff-preview creation path, or model-output `innerHTML`. Note mutations remain only in the retained dormant diff callbacks. No dependency was added, and generated bundles, `test_vault/` content, request logs, and dummy plugin data are ignored and absent from git.
- Real Obsidian verification used the production `main.js`, `manifest.json`, and `styles.css` in ignored `test_vault/` with a loopback CORS-enabled OpenAI-compatible SSE mock and dummy credentials. No real account, key, provider, or other vault was used.
- Observed in Obsidian: Ask streamed and completed as a rendered heading, bold text, an external link, inline `$x^2$`, display `$$x^2$$`, and a list; reasoning was closed initially and expanded to reveal its text. Mode badges, model label, placeholders, and duplicate-submit disabling were visible. Stop cleared the stalled first request and displayed a stopped state. Discuss remained selected after switching from `Stage06.md` to `Other.md`, then streamed a Discuss response with `Other.md` captured. Brainstorm selection and its placeholder were also observed.
- Mock request-body inspection confirmed current skill text before AGENTS text, zero path fields with **Include note path** disabled, and ready-history counts that excluded the stopped assistant response. The Discuss request contained `Other.md` context. SHA-256 before/after values stayed `8dab9ffa5e40498e04672762f245e6b991edff69fbd36433888108b4c4e49e51` for `Stage06.md` and `21b048d5f8793825b533cddab635d8cedee178fe7bbd2ba35c94ef26a3be8dca` for `Other.md`.
- Manual-mock correction: the first mock listened to the request stream's normal `close` event and cancelled its own chunk timer. A `curl` reproduction returned zero bytes; changing cleanup to the response's `close` event produced a complete six-chunk stream before the successful Obsidian retry. This was a fixture fix, not a production-code change.
- Not exercised and therefore not claimed: provider-error rendering, a request with opt-in note-path inclusion, and a completed Brainstorm UI response. After the successful Discuss request, the computer-use service preserved an unresolved editor receipt and blocked all further keyboard/paste/set-value input, including after an Obsidian reload. No alternate input channel was used to bypass that guard. These scenarios have automated coordinator/transport coverage but still need UI follow-up.
- Implementation and documentation-evidence Gitea runs are recorded below after execution.
