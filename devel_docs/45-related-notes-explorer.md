# Stage 45: Related-notes explorer

## Status and scope

The Related-notes explorer is implemented and verified on `feat/2.10-related-notes-explorer` at product HEAD `2c0f170776989971ac648b4e70685c0737af385f`. PR 2 replaces chat's flat additional-note picker with explicit path/metadata snapshots and preserves the Stage 35 submission path, Stage 42 capacity guards, Stage 43 sessions, Stage 44 compact controls, and both guarded writers.

- **All** lists every current vault Markdown path except the active target. The active note appears separately as a disabled, labelled row and cannot be selected. Non-Markdown files and unresolved-link targets are not candidates.
- **Links** lists the deduplicated union of resolved outgoing and incoming links for the captured target, including bidirectional links, sorted by full path. It uses Obsidian's `resolvedLinks` and file-cache metadata only. Emend does not read note bodies to discover links, recursively expand linked notes, or invent candidates for unresolved links.
- Opening captures one All/Links snapshot. Switching modes and case-insensitive full-path search reuse that snapshot; search changes visibility only and retains ancestor folders needed to reach matches. Folder rows are implied by candidate paths, so empty folders are not invented. Select-all applies to the complete current All or Links result set, including search-hidden rows, and its accessible label/title says so.
- **Refresh** is the only explorer action that captures a replacement snapshot. New paths and changed link membership do not alter the open snapshot or helper-derived membership automatically. Independent vault rename/delete events still maintain selected paths and helper provenance immediately.
- No new command, setting, provider/model control, background index, automatic TOC, or automatic linked/folder context mode is included. Modify Selection retains its unchanged **Add notes** flat picker.

## Selection, provenance, and Refresh semantics

`AdditionalNotesStore` keeps ordered per-target entries with manual and helper sources plus the active helper list. Individual note changes add or remove the whole path. Select-all uses an All or target-specific Links helper. Folder selection uses a folder helper scoped to either All or the captured target's Links result; Links folders therefore cannot admit unrelated descendants.

Bulk changes commit once against the complete scope, not only visible search rows. Checked and indeterminate note/folder/Select-all states reflect actual membership. Unselect-all and folder deselection remove only that helper and its sources: manual selections and overlapping helpers survive. Removing an individual path removes all of its current sources but leaves helpers active, so one later Refresh can re-add the path when it still matches. A removed helper is not restored by Refresh.

One Refresh resolves every retained helper against the same new snapshot. It preserves manual paths, removes stale helper-only paths, adds new helper matches, and re-adds individually removed matching paths. It does not resurrect a deleted helper or scan note bodies. Selected paths remain target-specific, session-only, shared with Modify Selection, and absent from conversations and settings. Actual Obsidian reload clears paths and helpers.

Bulk store addition uses a path-to-entry map. Refresh precomputes per-helper path sets and helper indices, then uses a path-to-entry map while preserving surviving order and helper/resolver append order. The explorer builds per-mode folder-descendant maps from each snapshot, computes selected folder counts bottom-up, constructs its tree from parent-indexed children, and lets a store notification update selection state instead of repeating the same update in each mutation handler. Refresh suspends only the obsolete old-tree selection update, then updates the replacement tree once. These changes do not alter public store contracts, structural deduplication, provenance, notification counts, or accessible/stale/focus behavior.

## Conservative cache and lifecycle boundaries

The Links disclosure appears when resolved-link data is unavailable or any current Markdown file cache is incomplete:

> Links may be incomplete while Obsidian finishes indexing this vault. Refresh later; Emend does not read note bodies to find links.

Partial resolved-link data remains deterministic; there is no body-scan fallback or claim that Links is complete. File/folder rename remaps true descendants and helper paths with segment boundaries, not sibling string prefixes. Root `/` includes itself and every non-root vault path for store lifecycle maintenance; root rename joins the replacement with exactly one separator across target keys, selected paths, folder descriptors, and Links scopes. Root deletion removes descendant selections and affected folder/Links provenance while retaining target-keyed All-helper state. File/folder deletion otherwise removes affected selections and invalid helpers without touching other targets or sibling-prefix paths. Target switches, rerenders, and view close dismiss owned panels and make stale handlers inert. Pending submissions disable the trigger and any still-mounted explorer controls; a full rerender may close the panel, and Stop permits a fresh enabled explorer.

The trigger retains its selected count, ordered **Selected notes** paths, per-path **Remove**, **Clear all**, focus restoration, and `Selected note content is sent with your next request.` disclosure. The explorer itself states: `Contents are read at submission and share the existing context budget. Large selections may be rejected by capacity checks.`

## Submission, privacy, and capacity preservation

Opening, searching, All/Links switching, selecting, unselecting, Remove/Clear, Refresh, dismissal, and lifecycle actions perform zero note-content reads and zero provider requests. Discovery uses path and metadata APIs only. Lifecycle/accessibility assertions check every explorer/store segment before any target-editor or application bootstrap reset, preserving each segment's evidence in the summary; no selected/additional-note read or provider call is exempted or erased before assertion. Submission still captures the ordered path list before its first await, resolves all paths, and reads each selected note freshly.

The allowed real Chat scenario selected seven notes through the `Related` folder with a 1,000-character combined source budget. The exact request contained each expected prefix and omission marker; unused allocation rolled forward in selection order, total included source stayed within 1,000 characters, and Large used its full 156-character allocation. Every selected note was read exactly once through `vault.read`, generic path-off prompt framing remained intact, the loopback answer completed once, and active/additional note bytes and both writers remained untouched.

The focused capacity scenario used history disabled for deterministic estimates. A 157-token draft passed against 158-token effective capacity and remained unchanged after folder selection because unread additional-note contents are excluded. Exact preflight then rejected the assembled 476-token request at that 158-token capacity before networking. It made no provider request, persisted only the ready user prompt, added no assistant answer or persisted error, preserved note bytes, and called neither writer.

## Local verification

Final-fix pre-runtime commands from the repository root on 2026-11-15 (Asia/Shanghai):

| Command | Result |
| --- | --- |
| `npm test` | **49/49 Vitest files, 1,635/1,635 tests passed**; duration 4.26 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | Optimized runtime bundle `919701ae2ea3db1eaf9b196a61c239c313e0df23f6ccff325df19aecf068120f`. |

The runtime-vault bundle hash matched the root production bundle before every startup. The unoptimized baseline bundle was `97d46e8e70e04dbe57394dbd7006692ae5d9e7ea79e03101396ba7f593b4726c`; the optimized bundle was `919701ae…068120f`. Both runtime summaries record pre-commit HEAD `fe08be2e3391d744d2cc96f707f69df77d7ad488` because each bundle was built immediately before the product commit; `2c0f170776989971ac648b4e70685c0737af385f` contains the exact optimized source/test diff exercised by the final runtime matrix. Every final summary has `loadedBundleMatchedRoot: true`.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic Active/Outgoing/Backlink/Bidirectional/Unrelated/nested/large/rich-Markdown/unresolved/non-Markdown fixtures, the local OpenAI-compatible SSE mock at `127.0.0.1:18766`, and a dummy SecretStorage credential. No real provider account, real credential, paid request, non-loopback Emend retrieval, or other vault was used. Instrumentation covered both `app.vault.read` and adapter content reads after fixture setup.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --related-notes
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Complete results:

- Unoptimized large-vault baseline: **11/11 scenarios, 147/147 assertions**, generated `2026-11-14T18:12:48.062Z`, preserved in ignored `test_vault/emend-selection-chat-verify/evidence-related-notes-large-baseline-complete/summary.json` (SHA-256 `d5a367185962731ebdf7e88b4e82a48aeae28e3581562b6745d75169d9e7aafe`).
- Optimized focused explorer: **11/11 scenarios, 147/147 assertions**, generated `2026-11-14T18:20:38.826Z`, preserved in ignored `test_vault/emend-selection-chat-verify/evidence-related-notes-final-fix-complete/summary.json` (SHA-256 `c449538beb88fb5606c802de097c283f80345821864b740328293741c0d8ac71`).
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-14T18:21:01.990Z`, preserved separately in ignored `test_vault/emend-selection-chat-verify/evidence-compact-final-fix-complete/summary.json` (SHA-256 `4ed5ab9901987345f10a3b30dfba78927617e29c3f115e009d26ce9ef528fe11`).
- Combined final optimized runtime evidence: **12/12 scenario runs and 175/175 assertions**. Failed harness-setup attempts were preserved separately and are not stitched into these complete-run totals.

### Focused scenario matrix

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Discovery/All/Links/search | 16 | Exact 47-other-note All fixture and three-link Links fixture, active-note treatment, implied folders, unresolved/non-Markdown exclusion, complete-cache state, search visibility/scope labels, trusted Escape/focus, zero reads/requests/writes. |
| 02 Selection/helpers/Remove/Clear | 19 | Manual/folder/All/Links overlap, complete-scope bulk behavior, checked/indeterminate states, Links exclusion, individual removal, helper-only unselect semantics, exact count/details, focus, zero reads/requests. |
| 03 Explicit Refresh | 11 | Stale open snapshots before Refresh; one-snapshot manual preservation, stale removal, individual re-add, new Links/folder matches; removed helpers stayed removed; zero post-fixture reads/requests. |
| 04 Incomplete/partial cache | 4 | Exact limitation disclosure, deterministic partial resolved links, unresolved exclusion, zero body reads/requests. |
| 05 Rename/delete/isolation/reload | 27 | Real file/folder events, sibling-prefix control, A/B isolation, stale-panel close/handler guard, delete maintenance, actual reload clearing paths/helpers, plus five separately checked segments with zero vault reads, adapter reads, and provider requests before every bootstrap reset. |
| 06 Modify Selection sharing | 7 | Same ordered store paths in chat/modal, modal Remove/Clear reflected in chat, unchanged empty modal/cancel behavior, zero reads/requests/writes. |
| 07 Allowed submission/fair budget | 23 | Seven-folder-selection zero pre-reads, exact fair prefixes/rollover/markers, one submission-time read per note, path-off framing, one loopback answer, unchanged bytes/writers. |
| 08 Exact capacity | 8 | Passing unread-content draft, unchanged estimate, exact 476-versus-158 rejection, zero provider calls/answer/writes, ready-user-only persistence. |
| 09 Pending/stale lifecycle | 7 | Rerender/view-close stale guards, outside dismissal/focus, pending disabling, Stop recovery, unchanged note/writers. |
| 10 Accessibility/themes/popout | 13 | 240 px dark/light layouts, dialog/search names, trusted Tab order, real theme restyling, supported popout owner-document selection/dismissal/focus, plus explicit zero vault reads, adapter reads, and provider requests across those actions and the final post-reopen Clear. |
| 11 Large-vault Select all/Refresh | 12 | 600 synthetic bulk notes in 30 nested groups, 648 total candidates and 63 folder rows; exact Select-all membership/order/helper/notification/count/checkbox state; real deletion maintenance, manual provenance, individual re-add and 12 created/12 deleted notes across Refresh; exact post-Refresh order and new-folder state; zero reads/new requests/writes; synchronous elapsed timings. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web state, both Edit targets, draft/caret/focus preservation, Related notes count/details/Remove/Clear with the new explorer, pending lifecycle, popout owner-document behavior, zero non-submission requests/reads, and unchanged note bytes/writers.

## Final-review root and large-vault evidence

Two new store tests first failed against the unmodified lifecycle code, then passed after the root fix: root rename covers target keys, ordered selected paths, root/nested folder descriptors, Links targets and folder Links scopes, and exactly one separator; root deletion covers selected descendants, folder/Links invalidation, retained target-keyed All helpers, atomic notification, and no-op repetition. The other 28 store tests remained passing at RED. Final focused root/store compatibility was **71/71 tests**. A separate explorer notification regression failed with three target-list reads before the fix and passed with exactly two afterward—one for external details and one for explorer selection state.

The large scenario measured synchronous handler elapsed time with `performance.now()` inside real Obsidian. Functional expectations remained exact and no timing threshold was asserted:

| Handler | Baseline bundle | Optimized bundle | Change |
| --- | ---: | ---: | ---: |
| Open complete tree | 27.1 ms | 15.3 ms | about 43.5% lower |
| Select all | 18.7 ms | 2.3 ms | about 87.7% lower |
| Refresh and rebuild tree | 22.9 ms | 7.2 ms | about 68.6% lower |

Both measurements used 648 candidates and 63 folder rows, with the same 600-note synthetic fixture and 12 functional assertions. These are single-run measurements on the Linux/Xvfb environment below, not portable benchmarks or a promised latency ceiling. The baseline and optimized complete summaries preserve the raw values.

## Screenshot inspection

These ignored images under `test_vault/emend-selection-chat-verify/evidence-related-notes-final-fix-complete/screenshots/` were opened and visually inspected:

- `related-notes-all.png`: All/Refresh actions, search and Select-all, scrollable candidate tree, disabled Active row, implied Related folder, and bounded dark panel.
- `related-notes-links-incomplete.png`: Links mode with the exact incomplete-cache disclosure legible above the submission-budget disclosure.
- `related-notes-folder-selected.png`: checked Links Select-all, checked Related folder, all three resolved linked notes, disabled Active header, and selected count four.
- `related-notes-240-dark.png` and `related-notes-240-light.png`: real dark/light styling, checked Related folder, bounded 240 px chat layout, visible native controls, and no horizontal overflow. A transient Notice from the preceding exact-capacity scenario remains visible at the top of these two captures; it does not obscure the explorer controls or indicate a layout failure.
- `11-related-large-vault-select-refresh-performance.png`: the post-Refresh large tree with checked Select-all, checked LargeRelated folder, disabled active row, and bounded layout. The same earlier capacity Notice remains visible and does not obscure the explorer controls.

The compact evidence at `test_vault/emend-selection-chat-verify/evidence-compact-final-fix-complete/screenshots/pr1-related-notes-details.png` was also inspected, showing the two ordered selected paths, Remove/Clear controls, and next-request disclosure after selection through the new explorer.

## Verification limits and concerns

- Linux/Obsidian 1.15.0 with Xvfb was exercised. Windows, macOS, other Obsidian versions, window managers, display scales, and platform-specific popout behavior were not exercised.
- Dark and light Obsidian themes were exercised in this runtime; no claim is made for every community theme. Popout owner-document behavior was supported and exercised here only.
- Trusted CDP Tab/Escape and composer events were used, not physical OS-level keyboard input. Accessible names, native control behavior, focus, and ARIA states were asserted programmatically; no screen reader or assistive-technology output was exercised.
- All provider traffic used the loopback mock and dummy credential. No real provider/account, external Emend retrieval, billing, or paid behavior was verified.
- Root `/` rename/delete is covered by focused store unit tests; the real-Obsidian lifecycle matrix exercises ordinary file/folder events, not a vault-root rename/deletion operation. Large-vault timings are single-run synchronous measurements, not statistically sampled benchmarks.
- Both whole-branch Important findings were fixed and verified. The deferred disconnected unit-test `provider` spy remains unchanged as triaged; global `fetch` and loopback request logs provide actual network evidence. No known product defect remains from this fix wave. Push, PR, and CI remain controller steps.
