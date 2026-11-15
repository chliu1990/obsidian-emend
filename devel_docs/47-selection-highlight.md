# Stage 47: Preserve the live selection highlight while chatting

## Status and scope

The marker-based fix is implemented on `feat/2.10-selection-highlight` at product commit `b3d8d56b5b67b843771d162cd79fcd754c383164` (`fix: preserve selection highlight while chatting`). Emend now keeps every nonempty current CodeMirror selection visibly decorated when the editor loses focus to chat. The change is presentation-only: it does not change selection offsets, Edit targeting, focus, requests, persistence, or either guarded writer.

The shipped branch contains only the Task 3B live-state module. The CSS-only/native-marker alternative was not shipped. Final verification used the production bundle rebuilt from that product commit; no product or test file changed during Task 4.

## Baseline diagnosis: Markers, not Styling or Offsets

Task 1 ran the unfixed diagnostic in official Obsidian 1.15.0:

```bash
npm run build && node test_vault/emend-selection-chat-verify/verify.mjs --selection-highlight --selection-diagnose
```

The command exited 0 with **1/1 diagnostic scenario and 8/8 assertions**. Evidence is preserved separately in ignored `test_vault/emend-selection-chat-verify/evidence-selection-highlight-diagnostic/`; the baseline root/loaded bundle SHA-256 was `939a2b3ba6032f82c23479e38f5440e7e6b7308ce79adaf08ef76c470b34413e`.

The decisive focused-versus-chat traces and matched-CSS captures show:

- The public editor selection remains exactly `from: 25`, `to: 99`, with `Alpha first line with selected start.\nAlpha second line with selected end.` in both states. This rules out an offset or selection-preservation fix.
- The focused editor has a visible browser DOM selection with two nonempty rectangles. The chat-blurred editor loses that native DOM selection, while the logical CodeMirror selection survives.
- `.cm-selectionBackground` and `.emend-selection-highlight` counts are both zero in the blurred state. The native `.cm-selectionLayer` remains `display: block`, `visibility: visible`, and `opacity: 1`, but has no marker children to style.
- Both matched-CSS traces contain `markers: []`. There is no surviving native marker node or rectangle whose cascade, color, opacity, or geometry could explain the defect. This rules out the evidenced need for a styling-only override.
- The diagnostic made zero provider requests, zero post-reset vault/adapter content reads, and zero full-note or native-selection writes.

Key baseline files are `traces/selection-a-editor.json`, `traces/selection-a-chat.json`, both `selection-a-*-css.json` files, `traces/diagnosis.json`, and the two `selection-a-*.png` screenshots. The classification is therefore **Markers**.

## Automated baseline RED and passing safety controls

Task 2 retained the unfixed product and added the real-Obsidian acceptance matrix:

```bash
npm run build && node test_vault/emend-selection-chat-verify/verify.mjs --selection-highlight
```

The final baseline command built successfully and the verifier exited **1**, as required. Its fresh summary recorded **12 scenarios: 6 passed, 6 failed; 58 assertions in the GREEN scenarios**. Every failure was solely `Native blurred selection markers are missing.`; there was no setup, focus, timeout, request, read, write, or lifecycle error. The final reviewed baseline summary is preserved at ignored `test_vault/emend-selection-chat-verify/evidence-selection-highlight-acceptance-backup-1794735874247-s83iox/summary.json` and has SHA-256 `51c956335cd25d33a52968eb74debea6b090196bb6bf8bf2725bf5187a3b29bc`.

The six RED scenarios were core focused/chat A→B, note isolation, Source/dark, Live Preview/light, Source/light, and a fresh selection after reload. The six passing safety controls were:

1. Collapsed and whitespace-only target semantics, including automatic Full-note targeting and no collapsed decoration.
2. Real editor refocus with exact offsets/text and a visible host DOM selection.
3. Non-chat blur/refocus with unchanged native-selection and Track Changes computed styles.
4. One intentional local-mock Selection edit, exactly one native replacement with expected CriticMarkup, no `vault.modify`, and exact native undo.
5. Explicit vanished-Selection fail-closed behavior with no request, message, save, read, fallback, or write.
6. Disable/unload and actual reload lifecycle safety with no stale Emend artifact.

The native oracle compares focused DOM-selection geometry with blurred native-marker geometry without requiring equal colors. The Emend oracle is separate: it requires exact current `posAtDOM` coverage, effective visibility, and no stale, partial, overlapping, duplicate, or collapsed range. It never compares native and Emend pixels and uses no contrast threshold. CodeMirror splits multiline marks at rendered line boundaries, so the runtime oracle permits only gaps whose exact selected source text is a line break; the StateField tests retain the underlying unsplit range.

## Shipped design

`src/selection-presentation.ts` contains the complete focused implementation:

- `buildSelectionDecorations(selection)` filters out empty ranges and creates `Decoration.mark({ class: 'emend-selection-highlight' })` for every nonempty range. `Decoration.set(decorations, true)` sorts the ranges; reversed, multiple, multiline, and whitespace-only selections are included. Collapsed-only input returns `Decoration.none`.
- `selectionPresentationField` is a `StateField<DecorationSet>`. `create` builds from `state.selection`.
- `update(value, transaction)` rebuilds only when `transaction.docChanged || transaction.selection !== undefined`, always from `transaction.state.selection`. Document changes therefore use CodeMirror's remapped current selection. Unrelated transactions retain the prior decoration set.
- `provide: (field) => EditorView.decorations.from(field)` exposes the field through CodeMirror's decoration facet. `createSelectionPresentation()` returns that extension.
- `src/main.ts` calls `this.registerEditorExtension(createSelectionPresentation())` exactly once during `onload()`. Obsidian owns registration cleanup and extension disposal on unload; there is no separate listener, timer, or manual global teardown.
- The new `.emend-selection-highlight` rule in `styles.css` contains only `background: var(--text-selection)`. It adds no layout, cursor, native-selection, focus, or Track Changes override.
- `@codemirror/state` and `@codemirror/view` were already external host imports in `esbuild.config.mjs`. No dependency or build configuration changed.

Presentation follows the live selection regardless of editor/chat/non-chat focus. Nonempty whitespace can be visibly decorated without becoming a usable Edit Selection target; the existing target resolver still chooses Full note for whitespace-only or collapsed selections. The field retains no old offsets, selection snapshot, editor/view object, chat/request/provider/writer dependency, or focus state. It mutates neither selection nor document and persists nothing. Selection updates, blur/refocus, note switches, and lifecycle actions perform no provider request, vault/adapter content read, full-note write, or native replacement.

## Rejected alternatives

- **CSS-only/native-marker override (Task 3A):** rejected by the baseline evidence. There were no blurred native marker nodes to style. Forcing native selection-layer presentation would add an unevidenced global host/focus interaction rather than repair a cascade defect.
- **Stored offsets or a chat-focus snapshot:** rejected because selection A→B, document remapping, note switches, collapse, and reload must all derive from current CodeMirror state. Reapplying saved offsets could decorate stale text and would unnecessarily couple presentation to chat focus or request lifecycle.
- **Offset repair or selection mutation:** rejected because public offsets and selected text already survived unchanged. The implementation never calls a selection or document writer.
- **A new review/edit surface:** not added. Track Changes remains the only CriticMarkup review UI, and the decoration is not an inline suggestion, diff, or Apply/Reject flow.

## Unit RED→GREEN evidence

Task 3B used real `EditorState`/`EditorSelection` transactions:

```bash
npx vitest run tests/selection-presentation.test.ts tests/main.test.ts
```

- Missing-module RED exited **1**: both test files failed to import `../src/selection-presentation`; no tests ran.
- A minimal skeleton then produced valid behavioral RED: **8 failed, 22 passed (30 tests)** across the two files. Failures covered exact multiline/class ranges, reversed/multiple ranges, whitespace, collapse, A→B cleanup, document-change remapping, independent states, the nonempty `EditorView.decorations` facet, and exactly one registration. The facet was empty and the registration spy had zero calls.
- Final focused GREEN exited **0**: **2 files / 30 tests passed**. The expanded run with `tests/selection-unload.test.ts` also exited **0**: **3 files / 31 tests passed**.

The first fixed-runtime attempt exposed harness assumptions rather than a new product defect: native-only focused controls initially forbade the explicitly selected Emend presentation, and the DOM offset oracle initially treated the newline between CodeMirror's per-line spans as missing coverage. The ignored harness became branch-aware and gained the source-line-break-only exception described above. The final matrix then passed without weakening partial/stale/overlap rejection or changing product code.

## Final local gates

Task 4 ran these commands from the worktree after the final runtime matrices. Every command exited **0**:

| Command | Final result |
| --- | --- |
| `npm test` | **52/52 files, 1,695/1,695 tests passed**, zero failures. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild passed. |
| `npm run lint` | ESLint passed with no findings. |
| `git diff --check` | Passed with no output before documentation edits. |

The final build after these runtime runs produced the same root bundle hash as the runtime bundle. No product file changed afterward, so the final runtime evidence remains authoritative for the tested implementation.

## Final real-Obsidian matrix

Final commands, in order:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --selection-highlight
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

All three commands exited **0**. The focused run generated `2026-11-15T10:05:54.356Z`; compact generated `2026-11-15T10:06:03.305Z`.

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Core focused/blurred A→B | 17 | Exact multiline A, current B without stale A, real composer focus, automatic Selection targeting, refocus, no duplicate native layer, zero presentation I/O. |
| 02 Collapse/whitespace | 16 | Collapse removes all presentation and targets Full note; nonempty whitespace has exact presentation but still targets Full note; focus and zero-I/O controls pass. |
| 03 Note isolation A→B | 16 | Collapsed B has no A remnant; B's own live selection alone is decorated; refocus and zero-I/O controls pass. |
| 04 Source/dark | 10 | Raw Source-mode Markdown/CriticMarkup with exact current blurred decoration, real composer focus, zero I/O. |
| 05 Live Preview/light | 10 | Exact visible current decoration in the default light theme without layout or Track Changes collateral. |
| 06 Source/light | 10 | Source-mode current decoration in the default light theme, focus and zero-I/O controls. |
| 07 Editor refocus host control | 8 | Real editor focus, exact offsets/text, visible host DOM selection, no duplicate native marker layer, zero I/O. |
| 08 Non-chat/Track Changes collateral | 10 | Genuine non-chat blur/refocus, unchanged focused native-selection and Track Changes computed styles, zero I/O. |
| 09 Intentional edit/native undo | 8 | Exactly one local-mock request and native replacement, exact CriticMarkup and note bytes, no `vault.modify`, exact native undo without another request/write. |
| 10 Explicit Selection fail-closed | 11 | Existing Notice, no request/message/save/read/write or Full-note fallback, exact note bytes and preserved draft. |
| 11 Unload/reload lifecycle | 6 | Disable/unload removes Emend decoration/override, actual reload retains no stale artifact, zero I/O. |
| 12 Fresh post-reload selection | 10 | A newly created live selection has exact current decoration after reload, not stale pre-reload offsets. |

Final totals:

- Selection highlight: **12/12 scenarios, 132/132 assertions**, zero failures.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, zero failures.
- Combined: **13/13 scenario runs, 160/160 assertions**. Earlier RED and harness-correction runs are not included in these totals.
- Presentation-only phases had zero provider requests, vault/adapter content reads, full-note writes, and native replacements. The intentional edit's one request and one native replacement were measured separately.
- Compact controls retained their existing behavior with zero control-originated requests, content reads, or writes.

Runtime and evidence:

- Official Obsidian **1.15.0** AppImage, isolated Linux Xvfb `:101`, CDP `19224`.
- Local OpenAI-compatible SSE mock at `127.0.0.1:18766`, dummy SecretStorage credential, no real or paid calls.
- Focused summary: ignored `test_vault/emend-selection-chat-verify/evidence-selection-highlight-acceptance/summary.json`.
- Compact summary: ignored `test_vault/emend-selection-chat-verify/evidence/summary.json`.
- Baseline diagnostic remains separate in ignored `test_vault/emend-selection-chat-verify/evidence-selection-highlight-diagnostic/`; prior acceptance runs were rotated by the harness rather than used as final GREEN evidence.

## Trace and screenshot inspection

The final JSON summaries and live-selection traces were inspected. `traces/acceptance-oracle.json` records `expectedPresentation: "emend"`, `diagnosis: "Markers"`, no cross-kind pixel equality, and no contrast threshold. All captured decoration offsets had null `offsetError`.

- Chat-blurred A retains logical 25–99 with rendered decoration ranges 25–62 and 63–99, separated only by the selected newline. Current B is exactly 63–99; A's first-line remnant is absent.
- Collapsed traces have zero Emend/native presentation. Whitespace 132–137 is covered exactly by rendered ranges 132–134, 134–135, and 135–137 while its target remains Full note.
- Note B has only B ranges 25–54 and 55–90; collapsed B has no A remnant.
- Source/Live Preview and dark/light focused/blurred traces retain identical logical ranges. Dark computed background is `oklch(0.603458 0.21722 292.49 / 0.33)` and light is `oklch(0.653792 0.189218 293.559 / 0.2)`, each matching the corresponding real focused `::selection` background through `var(--text-selection)`.
- Every focused/chat/non-chat trace has zero native markers, so no duplicate native/Emend layer is present. The non-chat control intentionally records two Emend line decorations because presentation is focus-independent.
- `nonchat-collateral-styles.json` has identical before/after native-selection and Track Changes computed styles. `lifecycle-disabled.json` records zero DOM artifacts, no active override rules, and zero visible native markers. `fail-closed-focus.json` retains the existing post-Notice `BODY` focus behavior rather than hiding it.

The following final PNGs were opened and visually inspected, not merely checked for existence:

- `core-a-focused.png`, `core-a-chat-blurred.png`, and `core-b-chat-blurred.png`: exactly both A lines remain highlighted with composer focus; after A→B only the second line is highlighted.
- `collapsed-chat-blurred.png`, `whitespace-chat-blurred.png`, and `note-b-chat-blurred.png`: no collapsed highlight, a visible whitespace-only range without target changes, and only note B's two lines respectively.
- `source-dark-focused.png` / `source-dark-chat-blurred.png`, `live-preview-light-focused.png` / `live-preview-light-chat-blurred.png`, and `source-light-focused.png` / `source-light-chat-blurred.png`: raw Source markup where applicable, current highlight in both focus states, no layout or Track Changes regression in either default theme.
- `refocus-control-focused.png`: visible host selection after real editor refocus with no duplicate layer.
- `nonchat-collateral-blurred.png` and `nonchat-collateral-refocused.png`: current decoration and unchanged deletion/insertion styling across non-chat blur/refocus.
- `intentional-edit-after-native-undo.png`: original `Second line beta.` restored while the ready Selection result remains in chat.
- `10-explicit-selection-fail-closed.png`: the existing fail-closed Notice and preserved draft with no inserted message or fallback.
- `lifecycle-disabled.png`, `lifecycle-reloaded.png`, and `lifecycle-fresh-chat-blurred.png`: no Emend artifact after disable/reload, then a fresh current selection highlighted after reload.
- `evidence/screenshots/00-compact-composer-controls-lifecycle-popout.png`: compact composer layout remains intact.

All focused screenshots are under ignored `test_vault/emend-selection-chat-verify/evidence-selection-highlight-acceptance/screenshots/`.

## Final hashes

SHA-256 values after the final production build and runtime runs:

| Artifact | SHA-256 |
| --- | --- |
| Root `main.js` | `ba87f81dee8a14dfb96609ca572f66a80ee64fb0dc7abd5a5a970feff5a01e36` |
| Loaded runtime `main.js` | `ba87f81dee8a14dfb96609ca572f66a80ee64fb0dc7abd5a5a970feff5a01e36` |
| Selection-highlight `summary.json` | `503047eced78269377e1e3f37846cb461d696e1f73752bf18f2739c5a774fd49` |
| Compact `summary.json` | `967cee5b45943df5860aa0d5bdeff6a838e103ba726ede0888a75d0f9e2c888c` |
| Ignored `selection-highlight.mjs` | `6bc34a61360d3641397e94aecc6ddb22826e3ff275be898d7785804a5a2889b2` |

Both summaries record `loadedBundleMatchedRoot: true`, and the final post-gate `sha256sum` comparison independently confirmed root/loaded equality. This final bundle hash supersedes Task 3's pre-final-verification hash; no product change occurred between Task 4's runtime and local-gate builds.

## Verification limits and pending review

- Verification covers Linux/Xvfb and official Obsidian 1.15.0 only. Windows, macOS, other Obsidian versions, display scales, and physical OS-level keyboards were not exercised. CDP-dispatched events were trusted browser events, not physical typing. No screen reader or assistive-technology output was exercised.
- Source and Live Preview were exercised with Obsidian's default dark (`obsidian`) and light (`moonstone`) themes. **No user-implicated custom theme or CSS snippet was available**, so no matched custom-theme/snippet trace was run and no claim is made for every community theme or snippet.
- Synthetic notes, existing Track Changes fixtures, the local mock, and dummy credentials were used. No real provider/account/credential, external Emend request, paid call, or other vault was used.
- The non-chat scenario is a computed-style/no-collateral control; the separate chat-refocus control is the strict visible host-DOM-selection proof. The existing fail-closed rerender's `BODY` focus is recorded above and was not changed by this presentation fix.
- Two deferred minor registration-test non-call spies remain for whole-branch review triage. They were not altered in Task 4; production runtime registration, focus, no-I/O, and lifecycle controls independently passed.
- Independent/final whole-branch review is **pending** with the controller. This record does not claim independent review, push, PR creation, CI, release, or real-provider verification completed.
