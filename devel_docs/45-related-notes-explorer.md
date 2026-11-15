# Stage 45: Related-notes explorer

## Status and scope

The Related-notes explorer is implemented and verified on `feat/2.10-related-notes-explorer` at product HEAD `5348d68c2ee0b3358b8a54930ee5475d2507643d`. PR 2 replaces chat's flat additional-note picker with explicit path/metadata snapshots and preserves the Stage 35 submission path, Stage 42 capacity guards, Stage 43 sessions, Stage 44 compact controls, and both guarded writers.

- **All** lists every current vault Markdown path except the active target. The active note appears separately as a disabled, labelled row and cannot be selected. Non-Markdown files and unresolved-link targets are not candidates.
- **Links** lists the deduplicated union of resolved outgoing and incoming links for the captured target, including bidirectional links, sorted by full path. It uses Obsidian's `resolvedLinks` and file-cache metadata only. Emend does not read note bodies to discover links, recursively expand linked notes, or invent candidates for unresolved links.
- Opening captures one All/Links snapshot. Switching modes and case-insensitive full-path search reuse that snapshot; search changes visibility only and retains ancestor folders needed to reach matches. Folder rows are implied by candidate paths, so empty folders are not invented. Select-all applies to the complete current All or Links result set, including search-hidden rows, and its accessible label/title says so.
- Every folder and note name has a separate decorative Obsidian `setIcon` glyph immediately before it (`folder` and `file-text`, respectively), with `aria-hidden="true"`; the native disclosure, checkbox, accessible names, and current-note **Active** label remain separate. Initial expansion contains only `parentFolder(targetPath)` and its ancestors, so the active note is revealed while unrelated folders and all folders of a root-level active note start collapsed. Manual choices survive All/Links rebuilds and Refresh, newly appearing folders start collapsed, and search reveals matches and all ancestors without rewriting expansion state.
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

The trigger retains its selected count, ordered **Selected notes** paths, per-path **Remove**, **Clear all**, focus restoration, and `Selected note content is sent with your next request.` disclosure. The explorer itself states: `Contents are read at submission and share the existing context budget. Large selections may be rejected by capacity checks.` Collapsing a folder marks every descendant folder/note row hidden, and scoped explorer-row `[hidden]` CSS guarantees computed `display: none`; expanding restores only descendants whose own ancestor folders are expanded, and search retains matching descendants and their ancestors regardless of collapsed state. The floating panel prefers below placement only when the 480 px preferred height fits below or below has at least as much space as above. Otherwise it opens above, with height capped by the selected side and the complete panel kept inside the owner viewport; no resize listener or trigger-toggle behavior was added.

## Submission, privacy, and capacity preservation

Opening, searching, All/Links switching, selecting, unselecting, Remove/Clear, Refresh, dismissal, and lifecycle actions perform zero note-content reads and zero provider requests. Discovery uses path and metadata APIs only. Lifecycle/accessibility assertions check every explorer/store segment before any target-editor or application bootstrap reset, preserving each segment's evidence in the summary; no selected/additional-note read or provider call is exempted or erased before assertion. Submission still captures the ordered path list before its first await, resolves all paths, and reads each selected note freshly.

The allowed real Chat scenario selected seven notes through the `Related` folder with a 1,000-character combined source budget. The exact request contained each expected prefix and omission marker; unused allocation rolled forward in selection order, total included source stayed within 1,000 characters, and Large used its full 156-character allocation. Every selected note was read exactly once through `vault.read`, generic path-off prompt framing remained intact, the loopback answer completed once, and active/additional note bytes and both writers remained untouched.

The focused capacity scenario used history disabled for deterministic estimates. A 157-token draft passed against 158-token effective capacity and remained unchanged after folder selection because unread additional-note contents are excluded. Exact preflight then rejected the assembled 476-token request at that 158-token capacity before networking. It made no provider request, persisted only the ready user prompt, added no assistant answer or persisted error, preserved note bytes, and called neither writer.

## Local verification

PR #63 hierarchy-fix commands from the repository root on 2026-11-15 (Asia/Shanghai):

| Command | Result |
| --- | --- |
| `npm test -- tests/related-notes-control.test.ts` | **28/28 focused tests passed** after the new icon/expansion regressions failed for the intended reasons before the fix. |
| `npm test` | **49/49 Vitest files, 1,642/1,642 tests passed**; duration 4.26 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | Final production bundle `61e681cd3436a42bfbf069ccbcaebcc7cd2d00ae52b50c177dffa49ac4e1b7c0`. |

The runtime-vault bundle hash matched the root production bundle before every startup and in the final explicit `sha256sum` comparison. The final PR #63 runtime summaries record pre-commit BASE `ffb1f79709735183a783d57c19e0c5c549de73d0` because the bundle was built immediately before the product commit; `5348d68c2ee0b3358b8a54930ee5475d2507643d` contains the exact source/test diff exercised by the final runtime matrices. Every final summary has `loadedBundleMatchedRoot: true`. The earlier interaction-fix bundle was `4478566ce1708572f6719b1b3663a3b571461c9f6a5fe6bb50512576689589fc`; the unoptimized large-vault baseline bundle was `97d46e8e70e04dbe57394dbd7006692ae5d9e7ea79e03101396ba7f593b4726c`, and the earlier optimized bundle was `919701ae2ea3db1eaf9b196a61c239c313e0df23f6ccff325df19aecf068120f`. Those measurements remain historical evidence rather than the current hierarchy bundle.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic Active/Outgoing/Backlink/Bidirectional/Unrelated/nested/large/rich-Markdown/unresolved/non-Markdown fixtures, the local OpenAI-compatible SSE mock at `127.0.0.1:18766`, and a dummy SecretStorage credential. No real provider account, real credential, paid request, non-loopback Emend retrieval, or other vault was used. Instrumentation covered both `app.vault.read` and adapter content reads after fixture setup.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --related-notes
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Current PR #63 hierarchy-fix results:

- Focused explorer: **15/15 scenarios, 168/168 assertions**, generated `2026-11-15T02:27:28.724Z`, preserved in ignored `.superpowers/pr63-explorer-icons-related-final/summary.json`.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-15T02:27:42.356Z`, preserved separately in ignored `.superpowers/pr63-explorer-icons-compact-final/summary.json`.
- Combined current runtime evidence: **16/16 scenario runs and 196/196 assertions**. The focused RED reproduction and focused GREEN run are preserved separately under `.superpowers/pr63-explorer-icons-red/` and `.superpowers/pr63-explorer-icons-green-focused/`; they are not stitched into these complete-run totals.

Historical large-vault performance evidence remains available: the unoptimized baseline completed **11/11 scenarios, 147/147 assertions** in `test_vault/emend-selection-chat-verify/evidence-related-notes-large-baseline-complete/summary.json`, and the earlier optimized run completed **11/11 scenarios, 147/147 assertions** in `test_vault/emend-selection-chat-verify/evidence-related-notes-final-fix-complete/summary.json`. Those runs use the historical bundles identified above, not the current PR #63 bundle.

### Focused scenario matrix

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Discovery/All/Links/search | 16 | Exact 47-other-note All fixture and three-link Links fixture, active-note treatment, implied folders, unresolved/non-Markdown exclusion, active-parent expansion versus unrelated nested collapse, search visibility/scope labels, trusted Escape/focus, zero reads/requests/writes. |
| 02 Hierarchy icons | 4 | Actual decorative note `file-text` SVGs and folder-alias `folder-open` SVGs immediately before names, preserved accessible names/Active label/native controls, zero reads/requests and unchanged bytes. |
| 03 Active-ancestor expansion | 8 | Nested active-note ancestors expanded, unrelated folders/descendants collapsed, manual choices across All/Links and Refresh, new folders collapsed, search override without state rewriting, root-active all-collapsed behavior, segmented zero reads/requests and unchanged bytes. |
| 04 Collapse/computed display | 5 | Real top-level collapse hid every nested folder/note with `hidden === true`, computed `display === 'none'`, and zero client rects; expanding the parent retained the nested folder's collapsed state, expanding that folder restored the deep note, and search after reopening retained the match and ancestors. |
| 05 Selected-note positioning | 4 | Visible selected-note details/path, real 298.6875 px below versus 447.3125 px above, visible in-panel submission disclosure, and complete above-positioned panel within the 1024×800 owner viewport. |
| 06 Selection/helpers/Remove/Clear | 19 | Manual/folder/All/Links overlap, complete-scope bulk behavior, checked/indeterminate states, Links exclusion, individual removal, helper-only unselect semantics, exact count/details, focus, zero reads/requests. |
| 07 Explicit Refresh | 11 | Stale open snapshots before Refresh; one-snapshot manual preservation, stale removal, individual re-add, new Links/folder matches; removed helpers stayed removed; zero post-fixture reads/requests. |
| 08 Incomplete/partial cache | 4 | Exact limitation disclosure, deterministic partial resolved links, unresolved exclusion, zero body reads/requests. |
| 09 Rename/delete/isolation/reload | 27 | Real file/folder events, sibling-prefix control, A/B isolation, stale-panel close/handler guard, delete maintenance, actual reload clearing paths/helpers, plus five separately checked segments with zero vault reads, adapter reads, and provider requests before every bootstrap reset. |
| 10 Modify Selection sharing | 7 | Same ordered store paths in chat/modal, modal Remove/Clear reflected in chat, unchanged empty modal/cancel behavior, zero reads/requests/writes. |
| 11 Allowed submission/fair budget | 23 | Seven-folder-selection zero pre-reads, exact fair prefixes/rollover/markers, one submission-time read per note, path-off framing, one loopback answer, unchanged bytes/writers. |
| 12 Exact capacity | 8 | Passing unread-content draft, unchanged estimate, exact 476-versus-158 rejection, zero provider calls/answer/writes, ready-user-only persistence. |
| 13 Pending/stale lifecycle | 7 | Rerender/view-close stale guards, outside dismissal/focus, pending disabling, Stop recovery, unchanged note/writers. |
| 14 Accessibility/themes/popout | 13 | 240 px dark/light layouts, dialog/search names, trusted Tab order, real theme restyling, supported popout owner-document selection/dismissal/focus, plus explicit zero vault reads, adapter reads, and provider requests across those actions and the final post-reopen Clear. |
| 15 Large-vault Select all/Refresh | 12 | 600 synthetic bulk notes in 30 nested groups, 648 total candidates and 63 folder rows; exact Select-all membership/order/helper/notification/count/checkbox state; real deletion maintenance, manual provenance, individual re-add and 12 created/12 deleted notes across Refresh; exact post-Refresh order and new-folder state; zero reads/new requests/writes; synchronous elapsed timings. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web state, both Edit targets, draft/caret/focus preservation, Related notes count/details/Remove/Clear with the new explorer, pending lifecycle, popout owner-document behavior, zero non-submission requests/reads, and unchanged note bytes/writers.

## PR #63 hierarchy RED→GREEN evidence

Before any production edit, the focused unit run had **9 failures and 19 passes out of 28 tests**. The new cases failed because no row icons or `setIcon` boundary calls existed, unrelated and root-active nested descendants remained visible, the initial disclosure states were expanded, and newly appearing folders did not start collapsed. Updated existing cases failed on the deliberately changed visibility defaults rather than weakened selection or positioning assertions.

The new real-Obsidian `--explorer-hierarchy` reproduction at BASE `ffb1f79709735183a783d57c19e0c5c549de73d0`, on bundle `bbad4f05f7e65b1fc2a45bbd4b7136f903767a9a2aad2da442a30eca2eec8854`, failed both scenarios with zero passing assertions: note SVGs were absent and unrelated folders were expanded with visible descendants. Its summary and failure screenshots are preserved under `.superpowers/pr63-explorer-icons-red/`; `loadedBundleMatchedRoot` was true.

After the minimal icon/expansion implementation, the focused unit file passed **28/28** and the focused runtime matrix passed **2/2 scenarios with 12/12 assertions**. Real Obsidian renders the requested `folder` alias as `lucide-folder-open`, while unit boundary assertions require exactly `setIcon(element, 'folder')` and `setIcon(element, 'file-text')`. Fixture-indexing and note-opening reads were excluded by resetting instrumentation only after those setup steps; separate mode, Refresh/search, and root-explorer audit segments all retained zero-read/request assertions. The existing collapse scenario now explicitly checks that expanding a parent does not expand an unrelated nested folder, then expands that nested folder and retains the original computed-display restoration assertion.

The first full-suite run after extending the mock exposed 46 failures in unrelated lightweight icon hosts because the mock unconditionally called `setAttribute`. Making only that observability call optional restored the prior no-op behavior for those hosts while keeping real explorer controls under test; the final full suite passed **49/49 files and 1,642/1,642 tests**. Final complete runtime matrices passed **15/15 focused scenarios with 168 assertions** and **1/1 compact scenario with 28 assertions** on bundle `61e681cd3436a42bfbf069ccbcaebcc7cd2d00ae52b50c177dffa49ac4e1b7c0`.

## PR #63 interaction-fix RED→GREEN evidence

Before any production edit, the focused real-Obsidian reproduction failed both new scenarios at BASE `92eb800`. All nine `Related` descendants, including `Related/Nested` and `Related/Nested/Deep Note.md`, had `hidden: true` but computed `display: flex` and one client rect because the explorer row's flex rule overrode the browser's native hidden presentation. With selected-note details visible, the trigger rectangle left 298.6875 px below and 447.3125 px above; the old `belowSpace >= 180` branch nevertheless placed the panel below at `top: 493.3125`, with only 298.6875 px height. The new unit positioning test also failed before the fix (`top: 364px` instead of `8px`), while the two below-placement control cases passed. The ignored RED summary, computed-style/geometry JSON, and screenshots are under `.superpowers/pr63-explorer-feedback/red/`.

After the scoped `[hidden]` rule and above/below comparison, the focused unit file passed **24/24**, and both focused real scenarios passed **8/8 assertions**. In the same selected-note geometry, the panel moved above to `top: 8`, `bottom: 455.3125`, `maxHeight: 447.312px`; its disclosure stayed visible and the entire panel remained inside the viewport. The final complete matrices then passed **13/13 focused scenarios with 155 assertions** and **1/1 compact scenario with 28 assertions** on bundle `4478566ce1708572f6719b1b3663a3b571461c9f6a5fe6bb50512576689589fc`.

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

The final PR #63 hierarchy images were opened and visually inspected:

- `.superpowers/pr63-explorer-icons-related-final/screenshots/pr63-hierarchy-icons.png`: distinct small file and folder glyphs immediately before names, separate disclosure/checkbox controls, disabled **Active** row, readable dark-theme paths, and bounded panel layout.
- `.superpowers/pr63-explorer-icons-related-final/screenshots/pr63-hierarchy-nested-active.png`: expanded `Related` and `Related/Nested` ancestors revealing the nested active note, while unrelated `Other` remained collapsed in the vault and explorer state.
- `.superpowers/pr63-explorer-icons-related-final/screenshots/pr63-hierarchy-refresh.png`: intact post-Refresh layout and preserved active region; the crop does not show every new folder, so the explicit DOM assertions—not this screenshot alone—establish new-folder collapsed state and hidden descendants.
- `.superpowers/pr63-explorer-icons-related-final/screenshots/pr63-hierarchy-root-active.png`: the root-level `Typed.md` active row with the explorer scrolled to it; DOM assertions establish that every folder was collapsed and every nested descendant hidden.
- `.superpowers/pr63-explorer-icons-related-final/screenshots/related-notes-240-dark.png`: icons and native controls remained legible without horizontal overflow in the 240 px chat layout. The pre-existing capacity Notice remains visible and does not indicate a hierarchy failure.
- `.superpowers/pr63-explorer-icons-compact-final/screenshots/pr1-related-notes-details.png`: unchanged ordered selected paths, Remove/Clear controls, and next-request disclosure after the adjacent compact regression.

The earlier interaction-fix images were also opened and visually inspected:

- `.superpowers/pr63-explorer-feedback/related-final/collapsed-nested-folder.png`: the collapsed `Related` disclosure with no `Related` descendant folder/note rows visible; unrelated root-level notes remain visible.
- `.superpowers/pr63-explorer-feedback/related-final/selected-note-position.png`: the full explorer above the Related-notes trigger, the selected `Related/Unrelated.md` details below it, and the visible in-panel submission disclosure within the 1024×800 viewport.

These historical ignored images under `test_vault/emend-selection-chat-verify/evidence-related-notes-final-fix-complete/screenshots/` were also opened and visually inspected:

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
