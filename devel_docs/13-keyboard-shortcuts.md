# Stage 13: Add composer and mode keyboard shortcuts

## Goal

Add reliable composer submission shortcuts and non-submitting Ask/Edit mode commands. Enter and Mod+Enter must use the normal guarded submission path, Shift+Enter must remain a newline, unavailable composers must not shortcut-submit, and mode changes must preserve drafts and affect only the next request.

## Plan

1. Add test-first coverage for pure Meta/Ctrl shortcut matching, modifier conflicts, newline behavior, unavailable controls, and Ask/Edit mappings.
2. Exercise the real composer key handler, draft-preserving mode setter, pending-request behavior, command registration, default Mod hotkeys, and absence of provider or note writes from mode-only commands.
3. Register `emend:switch-to-ask-mode` and `emend:switch-to-edit-mode` with Obsidian `Mod+Shift+A/E` defaults. Open/focus chat before changing mode without adding a request or writer path.
4. Verify the production bundle in an isolated real Obsidian vault with actual key events, Command Palette access, a delayed loopback SSE mock, dummy credentials, request counts, and a fixture-note hash. Record Ctrl unit coverage separately from unexercised Windows/Linux UI coverage.
5. Run the full local gate, self-review, commit and push the implementation, verify the dedicated Gitea runner, then add CI evidence in a documentation-only commit and verify its run.

## Implementation details

- `src/chat-shortcuts.ts` exports pure composer and mode matchers. Ordinary Enter and exactly one of Meta/Ctrl plus Enter produce `send`; Shift+Enter produces `newline`; Alt, simultaneous Meta+Ctrl, Mod+Shift+Enter, unrelated keys, and unavailable sending/loading states cannot submit. Mod+Shift+A/E map to Ask/Edit with the same conflict guards.
- `src/chat-view.ts` delegates the existing textarea keydown behavior to the pure matcher. It also registers Mod+Enter on the view's Obsidian `Scope`, restricted to the current composer. Real Obsidian verification showed that the window-level keymap otherwise prevents Cmd+Enter from reaching a textarea bubble listener.
- The public `setMode()` method captures and restores the composer value around rendering, immediately updates the active mode and placeholder, and does not touch the active abort controller. Existing submission captures its mode before awaiting, so a pending request keeps its original mode while the command changes only the next request.
- `src/main.ts` registers both commands with sentence-case names and Obsidian default hotkeys. Narrow lint suppressions cover only the required Stage 13 command IDs and default hotkeys. `activateChatMode()` reuses `activateChatView()` and then calls `setMode()`; it has no submission, provider, coordinator, persistence, or writer call.
- `tests/chat-shortcuts.test.ts`, `tests/chat-view.test.ts`, and `tests/main.test.ts` cover the pure rules, actual handler and scope callback, draft preservation, pending mode isolation, command defaults, and no-request/no-write behavior. `tests/mocks/obsidian.ts` adds the small built-in `Scope` surface needed by those tests. No dependency was added.
- `README.md` documents Enter, Mod+Enter, Shift+Enter, both mode commands, platform Mod mapping, draft preservation, and next-request semantics. `AGENTS.md` records the new module, command IDs, scope integration, and manual-testing expectations.

## Verification results

- Focused pure red: `npx vitest run tests/chat-shortcuts.test.ts` failed because `src/chat-shortcuts.ts` did not exist. The minimal matcher then passed 21 tests, including both Meta and Ctrl paths and modifier conflicts.
- Focused UI/command red: the combined shortcut, chat-view, and main run failed 11 tests because the key handler, mode setter, and mode commands were absent. The first implementation passed 37 tests across those three files.
- Real Obsidian initially exposed an integration gap that unit tests could not catch: its window keymap swallowed Cmd+Enter before the textarea listener. A new scope-registration test failed because `registerComposerScope()` was absent, then passed with the built-in `View.scope` implementation. The final focused run passed 3 files and 38 tests. TypeScript-only fixture corrections were made after build checks without changing the tested behavior.
- Full local gate after the final code changes: `npm test` passed 16 files and 268 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real verification used the production bundle in ignored `test_vault/stage13_vault`, isolated profile `.emend-test-profile-13`, Obsidian 1.14.5 on macOS, CDP port 9228, and a CORS-enabled loopback SSE mock on port 8793 with dummy credentials and 2-second delayed responses. Existing Obsidian profiles and other vaults were not modified.
- Real Cmd+Shift+A/E key events switched Ask/Edit immediately and preserved `Draft line`; the actual Command Palette result `Emend: Switch to edit mode` also executed and preserved `Palette draft`. These mode-only actions produced zero provider requests, zero chat messages, and no note write. Shift+Enter changed the draft to `Draft line\n` with zero requests and zero messages.
- After the `View.scope` integration, a real Cmd+Enter key event submitted `Cmd Enter prompt` through the normal Ask path, disabled the pending composer, and displayed Ask badges. A separate uninterrupted check submitted `Pending switch prompt`, immediately used Cmd+Shift+E while the composer still showed Stop, and retained Ask badges on the in-flight messages while showing Edit for the next request. Both responses completed without abort or error.
- The mock contained exactly two requests, both for the two intentional Cmd+Enter submissions with `stream: true`; mode-only switches and Shift+Enter added none. The fixture note remained byte-for-byte unchanged at SHA-256 `94d72dada5ba5a5e3522748e53bc6a45df50fbd5d474d12239d2ec5690bf30e0` before and after all checks.
- Unit tests explicitly cover Ctrl+Enter and Ctrl+Shift+A/E matching. No physical Windows/Linux environment was available, so Ctrl platform UI behavior was not exercised and is not claimed.
- Self-review confirmed that mode commands add no provider, request, pending-registry, persistence, or note-writing path; normal submission remains unchanged apart from keyboard delegation. Existing write guards are untouched. No generated bundle, vault content, mock log, local profile, credential, or other ignored file belongs in either commit.
- Implementation commit `a616b4b575d3b4c96080b172fb37b2c9591857e2`: Gitea run 59 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/59 completed with conclusion **success**. Job 74 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/59/jobs/74 ran on `emend-macos-docker`; checkout, Node/npm verification, `npm ci`, lint, all 268 tests, and the production build succeeded from 14:08:25+08:00 through 14:09:33+08:00.
