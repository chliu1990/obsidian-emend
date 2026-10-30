# Stage 08: Guarded immediate full-note editing

## Goal

Enable Edit mode to send a complete captured note, stream reasoning while privately buffering the response, validate CriticMarkup, reject stale or invalid edits, and write the annotated result once through `vault.modify`. Keep read-only modes writer-free, store only edit summaries in chat, and remove Emend's dormant diff UI so Track Changes is the only review surface.

## Plan

1. Write failing writer, permission, stale-note, target-switch, and Edit coordinator tests before production code. Cover one write after completion, full-source prompting, no-op and comment-only behavior, and zero writes for read-only, invalid, provider-error, abort, or stale outcomes.
2. Add a focused note-writer boundary with current-text reading, active-target verification, final mode permission checking, and a `vault.read`/`vault.modify` adapter. Add a separate Edit coordinator while preserving the writer-free read-only coordinator.
3. Wire Edit into chat with its existing icon and a full-note placeholder. Buffer annotated documents out of chat and record only applied/no-op summaries in ready history.
4. Delete the dormant diff module, extension registration, callbacks, styles, and unused CodeMirror dependencies. Update current behavior and privacy documentation without claiming selection editing.
5. Run focused red/green tests and the full local gate, then exercise the production bundle in isolated ignored `test_vault/` with a local SSE mock and dummy credentials. Inspect actual Markdown and Track Changes behavior, self-review, and verify implementation and documentation-evidence commits on `emend-macos-docker` through the tea API.

## Implementation details

- Added `src/note-writer.ts` with `NoteWriter`, `EditResult`, `createVaultNoteWriter()`, and `applyPreparedEdit()`. Read-only and unchanged responses return without reading or writing. A changed Edit response re-reads the captured file, requires exact captured-source equality and the same active target, rechecks `canWriteToNote()` immediately before the write, and calls `vault.modify` once. Stale source or target changes throw `The note changed while Emend was responding. No edits were applied.`
- Added `EditRequestCoordinator` in `src/request-coordinator.ts`. Only this coordinator receives a writer. It sends `context.sourceText` rather than bounded `context.markdown`, forwards reasoning, accumulates content privately until completion, checks abort, validates through `criticMarkupEditStrategy`, and delegates the single application path. `ReadOnlyRequestCoordinator` remains writer-free.
- `src/main.ts` constructs the Edit writer only for Edit submissions and checks the current target at application time. `src/chat-view.ts` enables all four modes, honors a saved Edit default, displays Edit reasoning/progress without leaking the document, and stores only `Edit applied — N changes tracked. Review in Track Changes.` or `No changes were needed.` in assistant history.
- Comment-only edits may write with `changeCount` zero. Provider, abort, validation, stale, read-only, and no-op outcomes perform no write.
- Deleted `src/document-diff-preview.ts` and all diff registration/callbacks/styles. Removed the now-unused `@codemirror/state` and `@codemirror/view` dependencies. Track Changes is the only review UI; selection-only editing remains for Stage 09.
- Updated `README.md`, `AGENTS.md`, and the default-mode setting description for current editing and complete-note privacy behavior.

## Verification results

- Focused red: `npx vitest run tests/note-writer.test.ts tests/request-coordinator.test.ts` failed because `src/note-writer.ts` and `EditRequestCoordinator` did not exist. The writer suite collected zero tests and all seven new Edit behavior tests failed for the missing feature; the existing 12 coordinator tests still passed.
- Focused green: after implementation and correction of an invalid stale-test fixture, the same command passed both files and all 28 tests. `npx tsc -noEmit -skipLibCheck` passed.
- Full local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed. Vitest reports 9 files and 162 tests; lint has no findings and the production build includes strict TypeScript checking. Intermediate lint runs caught test-double method-binding warnings and one redundant cast, which were corrected before the successful complete rerun.
- Real Obsidian verification used the production `main.js`, `manifest.json`, and `styles.css` in ignored `test_vault/` with an isolated `--user-data-dir` under that vault, a loopback CORS-enabled OpenAI-compatible SSE mock, and dummy credentials. No real account, key, provider, or other vault was used. The user's original Obsidian PID 49139 remained running after the isolated processes were stopped.
- Observed exact resulting Markdown: insertion `Alpha{++ inserted++} beta gamma.`, deletion `Alpha {--beta --}gamma.`, replacement `Alpha {~~beta~>delta~~} gamma.`, comment `Alpha beta gamma.{>>Review wording.<<}`, and highlight `Alpha {==beta==} gamma.`. Chat showed one-change confirmations for text edits and `Edit applied — 0 changes tracked. Review in Track Changes.` for the comment.
- A sequential second edit produced `Alpha{++ inserted++} beta {~~gamma~>delta~~}.`, preserving the original insertion exactly while adding the substitution. Mock history contained only edit summaries, not either annotated document.
- Invalid output displayed `Response reject view differs from the original reject view.` and left `Invalid08.md` as `# Invalid-output fixture\n\nAlpha beta gamma.\n` with no write.
- A real in-editor local edit made during a delayed response produced the exact stale error and preserved only the local text, with no AI markup. Switching from `Switch08.md` to `Other.md` during another delayed response produced the same stale error and left both notes unchanged.
- With the context limit set to 1,000, a 1,595-character note was sent whole: the mock request contained all 18 paragraphs, `LONG_START`, `LONG_END`, and no omission markers. The resulting file retained every line and changed only the ending to `LONG{++_CHECKED++}_END`.
- Track Changes 2.3.0 was installed and enabled through the normal Community Plugins interface in the isolated vault. It rendered the applied substitution inline and showed a `REPLACE` review card for `beta → delta`. Clicking Reject restored `Alpha beta gamma.` and changed the panel to `0 comments · 0 suggestions`.
- Self-review confirmed that only the Edit coordinator receives a writer, source capture precedes asynchronous work, the annotated document never enters chat history, and no diff module/style/import or generated/vault/secret file is tracked. The change adds 16 focused tests and removes the two unused runtime dependencies without changing provider transport.
