# Stage 11: Support sequential multi-turn edits and request isolation

## Goal

Support successive full-note edits against the latest annotated source while retaining concise chat history and earlier Track Changes markup. Isolate requests per note across full-note chat, read-only chat, and Modify Selection so two paths cannot race on one file, without weakening stale-source, target, permission, or post-await abort guards.

## Plan

1. Drive the real plugin/chat submission boundary with tests for three successive edit sources and histories, cross-path pending rejection in both directions, independent-note target switching, and retry after success, provider error, abort, validation error, and stale failure.
2. Add one plugin-owned pending-note-path registry around both public submission paths after basic prompt/target validation. Release each captured path in `finally` after its coordinator settles.
3. Preserve the existing captured mode/source, privately buffered responses, concise ready history, and all full-note/selection write guards. Keep the single chat view's own one-submission UI behavior.
4. Update current usage and architecture documentation. Run focused red/green tests and the full local gate, then verify real three-edit Track Changes, cross-path concurrency, note switching, and Stop/error retry with an isolated vault and loopback SSE mock.
5. Self-review, commit and push the implementation, verify the dedicated Gitea runner, then record that evidence in a documentation-only commit and verify its run.

## Implementation details

- `src/main.ts` now owns the pending path set shared by `requestChatCompletion()` and `requestSelectionEdit()`. `withNoteRequest()` acquires the exact captured `TFile.path` before instruction loading or provider work and rejects a duplicate with exactly `Wait for the current Emend request to finish.`
- Both public submission methods reject an empty prompt before acquiring pending state. Chat target/source capture and selection snapshot capture remain synchronous before their respective submission flows. Different note paths have independent pending entries; the existing single chat view still disables duplicate UI submissions while it is sending.
- The registry releases the captured path in `finally` only after the selected coordinator resolves or rejects. Success, provider errors, CriticMarkup validation errors, stale failures, Stop/abort, and view/modal-close aborts therefore permit subsequent requests. The implementation awaits coordinator completion inside the guard rather than releasing when a promise is returned.
- Submission mode and source remain captured at start. Sequential full-note edits recapture the latest annotated editor text, and `src/critic-markup.ts` continues to preserve earlier markup. Assistant history and storage contain only concise edit results, never full annotated responses.
- No changes were made to `applyPreparedEdit()`, `applyPreparedSelectionEdit()`, their post-await abort checks, exact-source and active-target checks, permission checks, or single-write adapters.
- Added `tests/request-isolation.test.ts` with real coordinator/chat/plugin behavior and a mocked transport. Three edits assert every complete source and history payload, all three writes, stacked markup, concise assistant messages, and sanitized persistence snapshots. Cross-path tests prove both blocking directions and successful release. Further tests prove independent A/B snapshots and histories, no old-note write after a target switch, and retry after provider error, abort, validation error, and stale failure.

## Verification results

- Focused red: `npx vitest run tests/request-isolation.test.ts` failed the two intended cross-path tests because selection and chat both proceeded instead of returning the exact pending error. The three-edit source/history, independent-note, and target-switch regressions passed on the baseline and were retained as coverage. Earlier fixture-only failures were corrected before this valid behavioral red run.
- Focused green: `npx vitest run tests/request-isolation.test.ts tests/main.test.ts tests/chat-view.test.ts tests/request-coordinator.test.ts tests/selection-editor.test.ts` passed 5 files and 63 tests.
- Full local gate: `npm test` passed 14 files and 220 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real Obsidian verification used the production bundle in a separate ignored `test_vault/stage11_vault`, isolated profile `.emend-test-profile-11`, CDP port 9226, Track Changes, and a loopback CORS-enabled SSE mock on port 8791 with dummy credentials. The user's existing Obsidian processes and other vault data were not modified.
- Three actual chat Edit submissions produced, in order, `Alpha {~~beta~>delta~~} gamma.`, then `Alpha {~~beta~>delta~~} {~~gamma~>epsilon~~}.`, then `Alpha {~~beta~>delta~~} {~~gamma~>epsilon~~}.{++ Tail++}` in the fixture body. Mock request 2 used the first annotated result as complete source with only `First edit` and its concise summary as history. Request 3 used the second annotated result with the two user prompts and two concise summaries. Persisted history contained those six ready messages and no `{~~` or `{++` response payload.
- The real Track Changes review panel displayed `0 comments · 3 suggestions` and exactly three cards: `REPLACE beta → delta`, `REPLACE gamma → epsilon`, and `INSERT Tail`. Live Preview retained two substitution pairs and one addition.
- During a delayed real full-note request on `Stage11Concurrent.md`, the actual public selection submission with a live editor adapter rejected with exactly `Wait for the current Emend request to finish.` while chat remained in flight. The mock log contained no selection request. The full-note request then applied only `Alpha{++ full++} beta.`; no selection replacement raced it.
- During a delayed `Stage11Switch.md` request, opening `Stage11Other.md` aborted the old chat request. Both files remained byte-for-byte unchanged, the active chat target became `Stage11Other.md`, and sending state cleared.
- Clicking the real chat Stop button during `stop request` left `Stage11Retry.md` unchanged and produced stopped state. `retry after stop` then succeeded with `Retry{++ recovered++} source.` A separate HTTP 500 produced `API request failed with HTTP 500.\nStage 11 expected error`, left the reset fixture unchanged, and `retry after error` succeeded with the same recovered markup.
- Self-review confirmed shared acquisition before any await, awaited `finally` release, unchanged writer boundaries and stale/abort checks, concise history/storage, no new dependency, and no generated bundle, vault content, mock log, local profile, credential, or other ignored file in git.
