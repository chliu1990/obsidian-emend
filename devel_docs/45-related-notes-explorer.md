# Stage 45: Related-notes explorer

## Status and scope

The Related-notes explorer is implemented and verified on `feat/2.10-related-notes-explorer` at product HEAD `712c312acae8a66299ad8f93e52db2ff2f7d5536`. PR 2 replaces chat's flat additional-note picker with explicit path/metadata snapshots and preserves the Stage 35 submission path, Stage 42 capacity guards, Stage 43 sessions, Stage 44 compact controls, and both guarded writers.

- **All** lists every current vault Markdown path except the active target. The active note appears separately as a disabled, labelled row and cannot be selected. Non-Markdown files and unresolved-link targets are not candidates.
- **Links** lists the deduplicated union of resolved outgoing and incoming links for the captured target, including bidirectional links, sorted by full path. It uses Obsidian's `resolvedLinks` and file-cache metadata only. Emend does not read note bodies to discover links, recursively expand linked notes, or invent candidates for unresolved links.
- Opening captures one All/Links snapshot. Switching modes and case-insensitive full-path search reuse that snapshot; search changes visibility only and retains ancestor folders needed to reach matches. Folder rows are implied by candidate paths, so empty folders are not invented. Select-all applies to the complete current All or Links result set, including search-hidden rows, and its accessible label/title says so.
- **Refresh** is the only explorer action that captures a replacement snapshot. New paths and changed link membership do not alter the open snapshot or helper-derived membership automatically. Independent vault rename/delete events still maintain selected paths and helper provenance immediately.
- No new command, setting, provider/model control, background index, automatic TOC, or automatic linked/folder context mode is included. Modify Selection retains its unchanged **Add notes** flat picker.

## Selection, provenance, and Refresh semantics

`AdditionalNotesStore` keeps ordered per-target entries with manual and helper sources plus the active helper list. Individual note changes add or remove the whole path. Select-all uses an All or target-specific Links helper. Folder selection uses a folder helper scoped to either All or the captured target's Links result; Links folders therefore cannot admit unrelated descendants.

Bulk changes commit once against the complete scope, not only visible search rows. Checked and indeterminate note/folder/Select-all states reflect actual membership. Unselect-all and folder deselection remove only that helper and its sources: manual selections and overlapping helpers survive. Removing an individual path removes all of its current sources but leaves helpers active, so one later Refresh can re-add the path when it still matches. A removed helper is not restored by Refresh.

One Refresh resolves every retained helper against the same new snapshot. It preserves manual paths, removes stale helper-only paths, adds new helper matches, and re-adds individually removed matching paths. It does not resurrect a deleted helper or scan note bodies. Selected paths remain target-specific, session-only, shared with Modify Selection, and absent from conversations and settings. Actual Obsidian reload clears paths and helpers.

## Conservative cache and lifecycle boundaries

The Links disclosure appears when resolved-link data is unavailable or any current Markdown file cache is incomplete:

> Links may be incomplete while Obsidian finishes indexing this vault. Refresh later; Emend does not read note bodies to find links.

Partial resolved-link data remains deterministic; there is no body-scan fallback or claim that Links is complete. File/folder rename remaps true descendants and helper paths with segment boundaries, not sibling string prefixes. File/folder deletion removes affected selections and invalid helpers without touching other targets or sibling-prefix paths. Target switches, rerenders, and view close dismiss owned panels and make stale handlers inert. Pending submissions disable the trigger and any still-mounted explorer controls; a full rerender may close the panel, and Stop permits a fresh enabled explorer.

The trigger retains its selected count, ordered **Selected notes** paths, per-path **Remove**, **Clear all**, focus restoration, and `Selected note content is sent with your next request.` disclosure. The explorer itself states: `Contents are read at submission and share the existing context budget. Large selections may be rejected by capacity checks.`

## Submission, privacy, and capacity preservation

Opening, searching, All/Links switching, selecting, unselecting, Remove/Clear, Refresh, dismissal, and lifecycle actions perform zero note-content reads and zero provider requests. Discovery uses path and metadata APIs only. Submission still captures the ordered path list before its first await, resolves all paths, and reads each selected note freshly.

The allowed real Chat scenario selected seven notes through the `Related` folder with a 1,000-character combined source budget. The exact request contained each expected prefix and omission marker; unused allocation rolled forward in selection order, total included source stayed within 1,000 characters, and Large used its full 156-character allocation. Every selected note was read exactly once through `vault.read`, generic path-off prompt framing remained intact, the loopback answer completed once, and active/additional note bytes and both writers remained untouched.

The focused capacity scenario used history disabled for deterministic estimates. A 157-token draft passed against 158-token effective capacity and remained unchanged after folder selection because unread additional-note contents are excluded. Exact preflight then rejected the assembled 476-token request at that 158-token capacity before networking. It made no provider request, persisted only the ready user prompt, added no assistant answer or persisted error, preserved note bytes, and called neither writer.

## Local verification

Initial commands from the repository root on 2026-11-14 (Asia/Shanghai), before runtime verification:

| Command | Result |
| --- | --- |
| `npm test` | **49/49 Vitest files, 1,632/1,632 tests passed**; duration 4.27 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | `c6da706e1f5e9f04f534ce94b3262bbeb245ae67580c5106c257deb6855684ec`. |

The runtime-vault bundle hash matched the root production bundle before startup. Both final evidence summaries record HEAD `712c312acae8a66299ad8f93e52db2ff2f7d5536`, the same bundle hash, and `loadedBundleMatchedRoot: true`.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic Active/Outgoing/Backlink/Bidirectional/Unrelated/nested/large/rich-Markdown/unresolved/non-Markdown fixtures, the local OpenAI-compatible SSE mock at `127.0.0.1:18766`, and a dummy SecretStorage credential. No real provider account, real credential, paid request, non-loopback Emend retrieval, or other vault was used. Instrumentation covered both `app.vault.read` and adapter content reads after fixture setup.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --related-notes
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Complete results:

- Focused explorer: **10/10 scenarios, 114/114 assertions**, generated `2026-11-14T17:07:34.783Z`, preserved in ignored `test_vault/emend-selection-chat-verify/evidence-related-notes-complete/summary.json`.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-14T17:08:22.398Z`, preserved separately in ignored `test_vault/emend-selection-chat-verify/evidence-compact-complete/summary.json`.
- Combined final runtime evidence: **11/11 scenario runs and 142/142 assertions**. Failed development attempts were preserved separately and are not stitched into these complete-run totals.

### Focused scenario matrix

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Discovery/All/Links/search | 16 | Exact 47-other-note All fixture and three-link Links fixture, active-note treatment, implied folders, unresolved/non-Markdown exclusion, complete-cache state, search visibility/scope labels, trusted Escape/focus, zero reads/requests/writes. |
| 02 Selection/helpers/Remove/Clear | 19 | Manual/folder/All/Links overlap, complete-scope bulk behavior, checked/indeterminate states, Links exclusion, individual removal, helper-only unselect semantics, exact count/details, focus, zero reads/requests. |
| 03 Explicit Refresh | 11 | Stale open snapshots before Refresh; one-snapshot manual preservation, stale removal, individual re-add, new Links/folder matches; removed helpers stayed removed; zero post-fixture reads/requests. |
| 04 Incomplete/partial cache | 4 | Exact limitation disclosure, deterministic partial resolved links, unresolved exclusion, zero body reads/requests. |
| 05 Rename/delete/isolation/reload | 12 | Real file/folder events, sibling-prefix control, A/B isolation, stale-panel close/handler guard, delete maintenance, actual reload clearing paths/helpers. |
| 06 Modify Selection sharing | 7 | Same ordered store paths in chat/modal, modal Remove/Clear reflected in chat, unchanged empty modal/cancel behavior, zero reads/requests/writes. |
| 07 Allowed submission/fair budget | 23 | Seven-folder-selection zero pre-reads, exact fair prefixes/rollover/markers, one submission-time read per note, path-off framing, one loopback answer, unchanged bytes/writers. |
| 08 Exact capacity | 8 | Passing unread-content draft, unchanged estimate, exact 476-versus-158 rejection, zero provider calls/answer/writes, ready-user-only persistence. |
| 09 Pending/stale lifecycle | 7 | Rerender/view-close stale guards, outside dismissal/focus, pending disabling, Stop recovery, unchanged note/writers. |
| 10 Accessibility/themes/popout | 7 | 240 px dark/light layouts, dialog/search names, trusted Tab order, real theme restyling, supported popout owner-document selection/dismissal/focus. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web state, both Edit targets, draft/caret/focus preservation, Related notes count/details/Remove/Clear with the new explorer, pending lifecycle, popout owner-document behavior, zero non-submission requests/reads, and unchanged note bytes/writers.

## Screenshot inspection

These ignored images under `test_vault/emend-selection-chat-verify/evidence-related-notes-complete/screenshots/` were opened and visually inspected:

- `related-notes-all.png`: All/Refresh actions, search and Select-all, scrollable candidate tree, disabled Active row, implied Related folder, and bounded dark panel.
- `related-notes-links-incomplete.png`: Links mode with the exact incomplete-cache disclosure legible above the submission-budget disclosure.
- `related-notes-folder-selected.png`: checked Links Select-all, checked Related folder, all three resolved linked notes, disabled Active header, and selected count four.
- `related-notes-240-dark.png` and `related-notes-240-light.png`: real dark/light styling, checked Related folder, bounded 240 px chat layout, visible native controls, and no horizontal overflow. A transient Notice from the preceding exact-capacity scenario remains visible at the top of these two captures; it does not obscure the explorer controls or indicate a layout failure.

The compact evidence also contains the inspected `pr1-related-notes-details.png`, showing the two ordered selected paths, Remove/Clear controls, and next-request disclosure after selection through the new explorer.

## Verification limits and concerns

- Linux/Obsidian 1.15.0 with Xvfb was exercised. Windows, macOS, other Obsidian versions, window managers, display scales, and platform-specific popout behavior were not exercised.
- Dark and light Obsidian themes were exercised in this runtime; no claim is made for every community theme. Popout owner-document behavior was supported and exercised here only.
- Trusted CDP Tab/Escape and composer events were used, not physical OS-level keyboard input. Accessible names, native control behavior, focus, and ARIA states were asserted programmatically; no screen reader or assistive-technology output was exercised.
- All provider traffic used the loopback mock and dummy credential. No real provider/account, external Emend retrieval, billing, or paid behavior was verified.
- No production runtime defect was found. Harness-only fixes addressed tri-state clicks, fixture link direction, nested-note thread lookup, recursive folder deletion, persistence timing, and pending-rerender expectations. Independent whole-branch review, push, PR, and CI remain controller steps.
