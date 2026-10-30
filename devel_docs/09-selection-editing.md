# Stage 09: Modify Selection with bounded context and native undo

## Goal

Add an explicit Modify Selection action that captures exact editor offsets, sends the complete selection with bounded surrounding context, validates the complete CriticMarkup response, and replaces only the captured range through native editor undo. Preserve the full-note Edit path and perform no replacement on provider, validation, abort, stale-source, or target-switch failures.

## Plan

1. Write failing selection capture, multiline, whitespace rejection, context-budget, oversized-selection, replacement, stale, target-switch, abort, prompt, and coordinator tests before production code.
2. Add a serializable `SelectionSnapshot` and a focused selection coordinator/editor adapter. Keep the source `MarkdownView` and `Editor` in the adapter, capture both before the instruction modal, and never truncate selected text.
3. Add the `emend:modify-selected-text` editor command and an explicit instruction modal with no request on open, nonempty submission only, and cancellation/abort support.
4. Validate the complete annotated selection through Stage 07, recheck current full text, captured file, current target view, permission, and abort signal, then call `editor.replaceRange` once at captured offsets. Do not use `vault.modify` for selection edits or render annotated output as chat.
5. Update current usage, architecture, privacy, and testing documentation. Run focused red/green tests and the full gate, then verify real Track Changes and native undo in ignored `test_vault/` with a local SSE mock and dummy credentials. Commit implementation and subsequent CI evidence separately.

## Implementation details

- Added `SelectionSnapshot { file, fullText, selectedText, from, to }` to `src/types.ts`. `captureSelectionSnapshot()` reads full text and offsets synchronously, derives selected text by slicing those offsets, and rejects missing files plus empty/whitespace selections.
- Added `src/selection-editor.ts`. `getSelectionContext()` divides the remaining character budget between before/after context and redistributes unused space at note edges. If the selection meets or exceeds the budget, surrounding context is empty and the selection remains complete.
- `SelectionEditRequestCoordinator` freshly loads instructions/skills, uses the Stage 03 selection prompt and Stage 05 streaming transport with no chat history, buffers content privately, rejects post-stream aborts, and validates the entire response against captured selected text through `criticMarkupEditStrategy`.
- `createSelectionEditorAdapter()` captures the source view and file before the modal. `applyPreparedSelectionEdit()` merges the annotated selection into captured full text for no-op handling, then requires exact current-editor equality, captured file identity, original target-view identity, `canWriteToNote('edit')`, and a non-aborted signal. One `editor.replaceRange` at captured offsets is the only selection write. The stale error matches full-note editing.
- Added `src/selection-modal.ts` with the exact question `How do you want to modify this selection?`. Opening does not request; empty input does not submit. Cancel/Stop and modal close abort pending work. Results are notices, never annotated chat answers.
- Registered `emend:modify-selected-text` with `editorCheckCallback` in `src/main.ts`. It is available only for a nonempty Markdown selection and captures the snapshot and adapter before opening the modal. Full-note Edit retains its existing `vault.modify` writer; selection has only the native editor adapter.
- Updated `README.md` and `AGENTS.md` for selection context, immediate annotated replacement, native undo, and the two separate guarded write paths. Smart paragraph expansion remains Stage 15.

## Verification results

- Focused red: `npx vitest run tests/selection-editor.test.ts` failed because `src/selection-editor.ts` did not exist. After the initial implementation, the suite also caught a real adapter file-identity bug and invalid repeated-text test fixtures; the fixtures were corrected and the adapter was fixed to retain captured file identity.
- Focused green: the same command passed all 30 selection tests. Coverage includes exact and multiline capture, empty/whitespace rejection, bounded and redistributed context, oversized selections, only-range replacement, no-op/comment behavior, stale source, target switching, aborts, read-only permission denial, current instructions, no history, invalid output, and provider failures.
- Full local gate: `npm test` passed 10 files and 194 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real Obsidian verification used the production bundle in ignored `test_vault/`, an isolated user-data profile, loopback CORS-enabled SSE mocks, and dummy credentials. Track Changes 2.3.0 was enabled. No real provider/account/key or other vault was used; the user's original Obsidian process and vault remained running and untouched.
- Opening the instruction modal and clicking Modify with empty input produced zero mock requests. A valid single-line request contained exactly `Selected text:\nbeta`, then produced `Alpha {~~beta~>delta~~} gamma.` without changing neighboring lines.
- Track Changes displayed `0 comments · 1 suggestion` and a `REPLACE` card for `beta → delta`. Native Cmd+Z restored the exact original `Alpha beta gamma.` and the panel returned to `0 comments · 0 suggestions`.
- An exact `First\nSecond` selection produced `{~~First\nSecond~>Combined lines~~}` while the heading, `Alpha beta gamma.`, and `Tail.` remained unchanged.
- With the context limit at 1,000 and `TARGET` selected, the logged request contained 6 selected characters, 497 before characters, and 497 after characters (exactly 1,000 total), included `NEAR_BEFORE`/`NEAR_AFTER`, omitted `BEFORE_START`/`AFTER_END`, and had no chat history. Only `TARGET` became `{~~TARGET~>CHECKED~~}`.
- A 1,720-character selection exceeded the same budget without truncation: the request contained all 1,720 characters and zero before/after characters. Both `LONG_SELECTION_START` and `LONG_SELECTION_END` were preserved, and the resulting 1,734-character file ended with `LONG_SELECTION_END\n{++_CHECKED++}`.
- Invalid output left `Invalid09.md` as `# Invalid selection fixture\n\nAlpha beta gamma.\n` with zero suggestions and no replacement.
- During a deterministic 60-second delayed response, the fixture changed to `Alpha beta locally changed.` The completed response applied no markup and preserved only that local text with zero suggestions.
- During another delayed response, the real workspace switched from `Switch09.md` to `Other.md` while the request modal remained open. The response replaced nothing: `Switch09.md` remained `# Switch selection fixture\n\nAlpha beta gamma.\n`, and `Other.md` remained byte-for-byte unchanged.
- Self-review confirmed that the snapshot contains no editor/view, the adapter is captured before the modal, only the selection coordinator receives the native editor adapter, selection code never calls `vault.modify`, and no generated bundle, vault fixture, mock log, profile, credential, or dependency file is tracked.
- Implementation commit `3701a5f184c5d6bf357ff50024aef161cc3926f2`: Gitea run 50 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/50 and job 63 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/50/jobs/63 completed with conclusion **success** on `emend-macos-docker`. Checkout, Node/npm verification, `npm ci`, lint, all 194 tests, and the production build succeeded from 11:22:10+08:00 through 11:23:03+08:00.
