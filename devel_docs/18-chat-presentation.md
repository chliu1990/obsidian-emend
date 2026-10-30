# Stage 18: Chat presentation and timed streaming

## Goal

Present the chat as Emend, make streamed content visible immediately without queuing Markdown renders during loading, preserve final Markdown rendering, and provide readable mode-button hover states. Prove the streaming behavior with a real delayed provider stream rather than a synchronous mock.

## Plan

1. Confirm the pre-fix display-name and immediate-loading regressions, then retain the minimal presentation fixes and their delayed-`MarkdownRenderer` unit coverage.
2. Add test-first hover rules for non-active and active mode buttons with `var(--text-normal)` and distinct Obsidian hover backgrounds.
3. Serve four real SSE content chunks 500 ms apart in an isolated Obsidian instance, sample the visible assistant body every 250 ms, and inspect the final rendered Markdown and unchanged fixture note.
4. Run the complete local gate, review rendering guards and the final diff, and record implementation and Gitea CI evidence in focused commits.

## Implementation details

- `src/chat-view.ts` returns `Emend` from `getDisplayText()`, uses the same header text, and renders loading content directly as plain text. Ready and stopped responses continue through `MarkdownRenderer`; the existing closed-view and connected-element checks guard asynchronous completion.
- `src/main.ts` labels the ribbon and command `Open Emend chat` without changing the public command ID or submission contracts. Narrow lint exemptions preserve this required plugin-name label.
- `styles.css` adds explicit `.emend-chat-mode-button:hover` and `.emend-chat-mode-button.is-active:hover` rules. Both use normal text color; their backgrounds are respectively `var(--background-modifier-hover)` and `var(--interactive-accent-hover)`.
- `tests/chat-view.test.ts` covers the display name, immediate loading while `MarkdownRenderer.render` remains pending, and both hover rules. `README.md` and `QUICK_START.md` use the new command label.
- Timed verification helpers, local profile, fixture vault, request log, and sampled results remain only in ignored `test_vault/`. No generated bundle, vault data, profile, or credential is tracked.

## Verification results

- Supplied pre-fix focused red evidence was the expected `Emend` versus `AI chat` display-name failure and an empty immediate-loading body. The preserved minimal fixes passed `npx vitest run tests/chat-view.test.ts` with 22/22 tests before hover work.
- Hover TDD red: the new regression failed because `.emend-chat-mode-button:hover` had no rule (`expected '' to contain 'background: var(--background-modifier-hover);'`). After the minimal CSS change, the focused suite passed 23/23.
- Real timed streaming used production Emend in ignored `test_vault/stage18_vault`, isolated profile `.emend-test-profile-18`, Obsidian 1.11.7 on macOS, CDP 9333, and loopback SSE mock 8798 with dummy credentials. The mock emitted chunks at 101, 602, 1101, and 1602 ms; gaps were 501, 499, and 501 ms.
- `node test_vault/verify-stage18.mjs` passed. Visible loading samples were `Streaming **` at 252 ms, `Streaming **Markdown` at 753 ms, and ``Streaming **Markdown** with `code` `` at 1255 ms. These samples had no rendered `strong` or `code` elements. At 1757 ms the ready body contained bold `Markdown` and `complete` plus inline `code`. `getDisplayText()` and the header were `Emend` in every sample, and `Stream18.md` remained byte-for-byte unchanged. Only the isolated Obsidian process and mock were stopped; the user's existing Obsidian process remained running.
- Full local gate: `npm test` passed 20 files and 408 tests, `npm run build` passed strict TypeScript checking and production bundling, `npm run lint` passed after narrow required-label exemptions, and `git diff --check` passed.
- Self-review confirmed that loading returns before any Markdown-render call, ready/stopped rendering retains the existing asynchronous stale-element guards, no submission/callback interface changed, and no note-writing path was added or exercised. No presentation or rendering-race blocker was found.
