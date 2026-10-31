# Stage 10: Persist conversations per note

## Goal

Persist ready chat conversations locally per note with a versioned schema, bounded SHA-256-keyed filenames, atomic writes, safe malformed-data recovery, and protection against async note-switch races. Keep credentials, request payloads, note snapshots, transient messages, and buffered edit responses out of storage.

## Plan

1. Write failing schema, round-trip, filtering, path, atomic-write, corruption, future-version, serialization, note-switch, close-cleanup, and ready-transition tests before production changes.
2. Add a focused `ConversationStore` using browser SHA-256 and Obsidian's config-directory `DataAdapter`. Serialize writes per note and preserve malformed data before replacement.
3. Integrate target-note loading and ready-message saving into the chat view. Guard stale loads by generation, abort active work on note switches, and preserve the per-view selected mode.
4. Verify separate two-note threads, actual Obsidian reload restoration, malformed-file preservation and backup, and sanitized stored data in ignored `test_vault/` with a loopback SSE mock and dummy credentials.
5. Update current architecture and privacy documentation, run the full local gate, self-review, then commit implementation and CI evidence separately.

## Implementation details

- Added `ChatMessage` to `src/types.ts`, including timestamp and optional provider token usage. `src/provider-stream.ts` remains the only provider transport.
- Added `src/conversation-store.ts` with schema version 1. Threads live under `<configDir>/emend/chats/`; filenames contain a sanitized basename of at most 40 characters plus the full SHA-256 hash of the exact note path. Raw note paths and `../` components never become storage paths.
- The store validates the root schema and filters invalid or non-ready message entries on load. Mode, reasoning, source path, timestamp, and optional usage round-trip. Saves snapshot ready messages at invocation and serialize writes per note; loads wait for writes already queued for that note.
- Saves stage a temp file and rename it into place. Real Obsidian rejects rename-over-existing, so the store falls back to the documented atomic `DataAdapter.process` operation and removes the staged temp file. No destination remove precedes replacement.
- Malformed loads return no messages, leave the original bytes untouched, and issue a non-secret warning. The next save writes those bytes to one reusable `.corrupt` backup before atomically replacing the thread. Unsupported schema versions reject saves without any backup or replacement.
- `src/main.ts` constructs the store from `app.vault.adapter` and `app.vault.configDir` and notifies open chat views of target-note changes through one shared callback registered for both `active-leaf-change` and `file-open`. This covers same-leaf A→B navigation; repeated same-note events return without incrementing the generation. `src/chat-view.ts` loads the captured note, disables submission during loads, uses generation and current-target checks to reject stale async results, and clears load state on close.
- Switching notes aborts an active request and keeps request-specific message arrays separate from the newly loaded view. The selected chat mode remains unchanged. Ready user messages save before provider submission; completed ready assistant messages save afterward. Loading, stopped, and error messages are excluded.
- Read-only assistant usage is retained when supplied. Edit entries persist only concise result summaries, never privately buffered CriticMarkup or note snapshots.

## Verification results

- Focused red: `npx vitest run tests/conversation-store.test.ts` failed because `src/conversation-store.ts` did not exist. The first chat run failed all three new tests because note-load guards and persistence did not exist. The rename-fallback regression failed with `Destination file already exists!`, and the close-cleanup regression failed because thread-loading state remained true. The workspace regression in `tests/main.test.ts` failed because `file-open` had no registered handler.
- Focused green: `npx vitest run tests/main.test.ts tests/chat-view.test.ts tests/conversation-store.test.ts` passed 18 tests. The workspace regression drives the actual `main.ts` event wiring with a file-open-only same-leaf A→B transition, holds A's read until B completes, proves stale A cannot win, submits a B prompt with only B history, and confirms A is absent from B storage. Repeated events for the same note do not increment the generation.
- Full local gate: `npm test` passed 13 files and 212 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real Obsidian verification used the production bundle in ignored `test_vault/`, isolated profile `.emend-test-profile-10`, CDP port 9224, and a loopback CORS-enabled SSE mock on port 8790 with dummy credentials. The user's original Obsidian process and vault remained untouched. Both Stage 10 fixture notes remained byte-for-byte unchanged.
- A streamed Ask exchange in `Stage10First.md` restored two ready messages with Markdown content, local reasoning, and usage `{ promptTokens: 12, completionTokens: 5, totalTokens: 17 }`. A separate exchange in `Stage10Second.md` created a second SHA-256-keyed file. Switching back restored only the first note's two messages.
- After an actual Obsidian `location.reload()`, Emend loaded automatically and restored the first note's exact two ready messages while retaining Ask mode. No loading or earlier error message was restored.
- A real malformed second-note thread returned `[]` on load and remained byte-for-byte untouched. The next save preserved the exact malformed bytes in the single `.json.corrupt` backup and wrote a valid version-1 replacement with no remaining temp files.
- Sanitized inspection stored only the concise `Edit applied — 1 changes tracked. Review in Track Changes.` message. Its persisted keys were `id`, `role`, `content`, `reasoning`, `mode`, `sourcePath`, `status`, and `timestamp`; the dummy API key, request-body marker, note-snapshot marker, and full-edit-payload marker were absent.
- Real same-leaf verification used isolated profile `.emend-test-profile-10-same-leaf` and CDP port 9225. Opening `Stage10SameLeafB.md` reused the exact Markdown leaf that had displayed `Stage10SameLeafA.md`. Obsidian emitted one `file-open` for B and two `active-leaf-change` notifications in this manual run; the file-open-only path is covered by the unit regression. Chat loaded only `B-ONLY`, provider history contained only `B-ONLY`, stored B remained `['B-ONLY']`, stored A remained `['A-ONLY']`, and both note files remained byte-for-byte unchanged.
- Self-review confirmed browser-only production cryptography, DataAdapter-only persistence, per-note write ordering, stale-load protection, ready-only serialization, concise edit history, unchanged note-writing boundaries, and no generated bundle, vault fixture, mock script, local profile, credential, or dependency file in git.
- Implementation commit `8ed23bb1d33444e4e389419de036f2250fd4a124`: Gitea run 52 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/52 and job 65 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/52/jobs/65 completed with conclusion **success** on `emend-macos-docker`. Checkout, Node/npm verification, `npm ci`, lint, all 211 tests, and the production build succeeded from 12:06:10+08:00 through 12:06:53+08:00.
