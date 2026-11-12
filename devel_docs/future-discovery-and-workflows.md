# Deferred feature backlog: discovery and workflow improvements

## Status and scope

Except for entries explicitly marked implemented and linked to their verification records, these are approved future feature requests, not current Emend behavior. Every deferred item requires its own focused design, reviewed PR, unit tests, privacy/permission review, and appropriate real-Obsidian verification. Nothing here authorizes background requests, hidden vault scans, automatic uploads, new write permissions, or a bundled implementation.

## 1. File-structure and title discovery for automatic TOCs

Requested in the maintainer's roadmap discussion.

- [ ] Add an explicit mode or action that can discover bounded vault file structures and Markdown titles for automatic table-of-contents generation.
- [ ] Make discovery read-only and user-initiated. Define scope, depth, result-count, and path-privacy limits before implementation; no background vault scan.
- [ ] Keep file content out of discovery unless the user separately includes it. Show what will be sent before submission.
- [ ] Generate deterministic links and handle duplicate titles, renamed/deleted files, empty folders, and large vaults honestly.
- [ ] Apply any TOC edit only through the existing active-note Operations/Track Changes path. Never write other discovered files.

## 2. Linked-document context toggle

Requested in the maintainer's roadmap discussion.

- [ ] Add a default-off checkbox or equivalent explicit control for automatically including documents linked from the active note, reverse-linked/backlinked documents, or separately selectable combinations of the two.
- [ ] Display selected linked paths with remove/clear controls before submission and apply existing note-path privacy settings consistently.
- [ ] Deduplicate active, explicitly selected, outgoing, and reverse-linked notes. Preserve the current explicit additional-note selection flow.
- [ ] Reuse bounded read-only snapshots and combined context accounting. Linked notes never become edit targets.
- [ ] Define link-scope and result-count limits, broken-link behavior, and stale rename/delete handling without automatic recursive expansion.

## 3. Folder-based document selection

Requested in the maintainer's roadmap discussion.

- [ ] Let users explicitly choose folders whose documents may be opened and included as read-only request context.
- [ ] Show the chosen folder scope and included document paths before submission. Define whether subfolders are included rather than assuming recursive access.
- [ ] Bound folder enumeration and combined content, deduplicate overlapping folder/note selections, and provide clear omission feedback.
- [ ] Do not scan folders in the background, include unselected folders, or grant folder documents a write path.
- [ ] Handle missing/renamed folders, large folders, non-Markdown files, and switching the active target without leaking context.

## 4. Easier selected-text editing — issue #24 (implemented)

Track: https://github.com/chliu1990/obsidian-emend/issues/24

Implemented and verified in [Stage 39](39-easier-selection-editing.md); no deferred checklist item remains here.

- [x] Add a nearby checkbox or similarly direct composer control for modifying only selected text instead of requiring the Command Palette. The implemented control is a two-value **Edit target** selector.
- [x] Default to the selection workflow when usable text is selected, while preserving an explicit way to choose full-note chat/Edit.
- [x] Reuse exact selection capture, complete-selection prompting, guarded Operations, native undo, pending controls, and Track Changes; do not add a second writer or submission path.

## 5. Minimal edit ranges — issue #23 (implemented)

Track: https://github.com/chliu1990/obsidian-emend/issues/23

Implemented and verified in [Stage 37](37-minimal-edit-ranges.md); no deferred checklist item remains here.

- [x] Reduce unnecessarily broad replacement ranges so small textual changes remain small and readable in Track Changes.
- [x] Improve precise anchor/location selection and ambiguous-target diagnostics so the model and user can locate the intended modification reliably.
- [x] Evaluate prompt guidance and deterministic post-processing separately; preserve exact source semantics and never weaken Operations validation.
- [x] Test substitutions within sentences, repeated text, Unicode, existing CriticMarkup, overlap/ambiguity rejection, and unchanged-output no-ops.

## 6. Permission-grouped modes — issue #25

Track: https://github.com/chliu1990/obsidian-emend/issues/25

- [ ] Evaluate consolidating Ask/Discuss/Brainstorm into a read-only chat group while preserving their distinct prompting behavior or documenting why separate modes remain useful.
- [ ] Design explicit read-only, file-modify, and file-create permission groups without weakening current code-level write contracts.
- [ ] Keep any file-creation workflow independent from full-note Edit and require guarded destination/collision behavior.

## 7. Bilingual translation — issue #12

Track: https://github.com/chliu1990/obsidian-emend/issues/12

- [ ] Add an explicit translation action with two allowlisted language settings and automatic A-to-B/B-to-A direction selection.
- [ ] Support two explicit modes: create a new target-language-suffixed Markdown file, or insert translated blocks below each original paragraph for side-by-side correction.
- [ ] Both modes send complete source text with empty chat history and preserve Markdown, code, links, and existing CriticMarkup.
- [ ] In file mode, create exactly one destination only after complete validated output; never modify the source or overwrite an existing destination, and handle collisions and aborts safely.
- [ ] In inline mode, intentionally modify only the active note by inserting translated blocks through the existing guarded Operations/Track Changes path, preserving the originals and using native undo and stale checks; do not add a new writer or bypass structural safeguards.
- [ ] Cover safe suffix/collision behavior and aborts in file mode, plus stale-source checks, empty/large notes, and isolated real-Obsidian verification for both modes.

## 8. Same-device API-key sharing research — issue #13

Track: https://github.com/chliu1990/obsidian-emend/issues/13

- [ ] Research an explicit default-off **Share API keys across vaults on this device** option with per-vault SecretStorage fallback.
- [ ] Investigate Electron safeStorage and an app-global encrypted store; feature-detect support and refuse insecure/plaintext fallbacks.
- [ ] Require explicit migration/overwrite confirmation and a separate **Forget shared keys** action. Make no cross-device synchronization claim.
- [ ] Review the deliberate exception to vault-only file access and test supported desktop platforms before any implementation.

## 9. Compact composer controls

Requested in the maintainer's UI review after the DeepSeek web-search follow-ups.

- [ ] Move Fix grammar, Make concise, Add examples, and additional-note selection into smaller icon buttons and dropdown menus beside the composer rather than large dedicated sections.
- [ ] Preserve accessible labels/tooltips, selected-note paths and remove/clear behavior, shared submission paths, pending/disabled states, and target-note isolation.
- [ ] Keep privacy details at the point of action or in compact menus rather than persistent bottom disclosures. Do not hide query/URL review controls or change provider/write permissions.
- [ ] Verify keyboard navigation, narrow sidebars, native picker/modal behavior, draft preservation, latest-message scrolling, and real-Obsidian layout in a separate UI PR.

## 10. Insert-only text enrichment

Requested in the maintainer's editing-workflow review.

- [ ] Add an explicit addition action for inserting useful new text at a precise anchor without replacing or deleting existing content.
- [ ] Reuse the closed Operations insert operation, exact target capture, stale-source checks, and Track Changes review; do not add a second edit protocol or writer.
- [ ] Define full-note and selection targets, repeated-anchor occurrence handling, empty/large insertions, and unchanged-output no-ops.

## 11. Regenerate or delete the latest exchange — issue #31

Track: https://github.com/chliu1990/obsidian-emend/issues/31

- [ ] Add regenerate and delete controls for the latest user/assistant pair without affecting earlier exchanges.
- [ ] Regenerate from the captured user prompt and permitted context, with pending/abort/stale-target guards and no silent retry.
- [ ] Delete the pair from both the visible thread and provider history, persist the updated thread atomically, and handle missing/latest/already-deleted states safely.

## 12. Multiple chat sessions per note — issue #41

Track: https://github.com/chliu1990/obsidian-emend/issues/41

- [ ] Add a deferred session management page with reorder controls for per-note chat sessions. Current chat already provides New/Switch/Rename/Delete directly after capacity and before messages, with no Move controls; no hidden session creation occurs beyond an initial session for a note without history.
- [ ] Restore the latest session by default when a note with history is opened, while keeping explicit switching available.
- [ ] Migrate conversation persistence to a versioned multi-session schema that preserves existing single-thread data and refuses unsupported versions.
- [ ] Guard pending requests, aborts, stale loads, and target-note switches deterministically so no stale session is loaded or written.
- [ ] Generate session summaries only on explicit request from sanitized ready messages; never issue hidden provider calls or persist summary request artifacts.
- [ ] Verify session isolation, delete/reorder behavior, restoration after reload, note rename/delete, and guarded failure paths in real Obsidian.

## 13. Independent search and fetch providers — issue #32

Track: https://github.com/chliu1990/obsidian-emend/issues/32

- [ ] Evaluate opt-in third-party Search/Fetch providers such as Exa, with independent provider selection for each capability.
- [ ] Store third-party keys in Obsidian SecretStorage, document recipient paths/costs, and require bounded results and verifiable citations.
- [ ] Keep provider-specific adapters independent; do not add a universal schema, silent fallback, or web access to editing paths without separate review.

## 14. Streaming investigation on macOS

Requested in the maintainer's platform review.

- [ ] Reproduce the report that responses appear all at once on Mac and measure provider deltas versus Emend rendering timestamps.
- [ ] Distinguish ordinary streaming from web-tool-round/final-response buffering and completed-response alignment; do not assume a platform cause before measurement.
- [ ] Add a focused real-Obsidian macOS verification scenario before changing the current rendering behavior.

## 15. Post-edit change summaries — issue #35

Track: https://github.com/chliu1990/obsidian-emend/issues/35

- [ ] Replace the counter-only successful full-note Edit result with concise deterministic bullets derived from the final successfully applied Operations.
- [ ] Handle no-op, comment-only, failed, stale, stopped, and selection outcomes explicitly without exposing rejected candidates or raw correction feedback.
- [ ] Persist only sanitized ready summaries; keep model-generated additional suggestions in a separate reviewed follow-up with explicit cost/privacy behavior rather than adding a hidden provider call or changing the closed Operations schema.

## 16. Follow-up edits to unaccepted suggestions — issue #37

Track: https://github.com/chliu1990/obsidian-emend/issues/37

- [ ] Design deterministic merging of new Operations into existing unaccepted CriticMarkup without implicitly accepting/rejecting earlier suggestions or deleting unaffected review history.
- [ ] Define insertion/deletion/substitution/comment merge behavior, repeated anchors, sequential follow-ups, and full-note versus selection scope without nested or ambiguous markup.
- [ ] Preserve exact accept/reject bytes, stale guards, native undo, minimal ranges, and Stage 38 structural safeguards with real-Obsidian verification.

## 17. Track Changes dependency strategy — issue #36

Track: https://github.com/chliu1990/obsidian-emend/issues/36

- [ ] Use Stage 38 as the current baseline of upstream presentation, review-parser, and verification limitations; keep it updated when new concrete limitations are confirmed.
- [ ] Evaluate whether a focused fork or custom renderer is justified by maintenance cost, compatibility, security, and user value. This is research only, not approval for a renderer implementation.
- [ ] Keep any resulting fork/renderer design independent from post-edit summaries, follow-up edit merging, and other workflow PRs.

## 18. Review-change attribution — issue #44

Track: https://github.com/chliu1990/obsidian-emend/issues/44

- [ ] Label Emend-generated review comments and, where the representation permits, modifications so Track Changes shows Emend instead of a default author.
- [ ] Identify Emend-generated changes deterministically from the applied Operations and captured source, not from prose, provider metadata, or a hidden marker added to user text. Apply one rule across full-note Edit, composer Selection, and Modify Selection.
- [ ] Investigate Track Changes author-presentation constraints first: what the current dependency accepts, renders, and preserves for comments and modifications, and what survives accept/reject and round-trip edits. Record the findings before choosing a representation.
- [ ] Preserve exact CriticMarkup accept/reject bytes, current parsing and validation, sequential edits against prior annotated sources, and Stage 38 structural safeguards. Do not add nested markup.
- [ ] Keep Track Changes as the only review UI and do not change accept/reject semantics or add an in-plugin review surface.
- [ ] Treat any later user discussion or guideline extension as a separate design with explicit user action, no hidden provider calls, and no bundling into attribution.

## Delivery constraints

- Keep every roadmap item and issue in its own focused PR; do not bundle discovery, linked notes, folder selection, mode redesign, translation, multiple sessions, review-change attribution, or credential storage into one PR.
- Keep review-change attribution independent from post-edit change summaries, follow-up-edit merging, Track Changes dependency research, and other workflow PRs; attribution must not depend on or block those changes.
- Keep the public-launch path to three independent content PRs plus the normal separate release PR: documentation and promotional material, post-edit change summaries, and compact composer controls. Publication preparation does not authorize implementation of deferred features.
- Keep either translation mode, multiple sessions, and toolchain maintenance out of launch PRs. Toolchain upgrades require their own workflow-authorized PR and are not launch prerequisites unless security- or release-breaking.
- Preserve explicit actions, local data control, bounded context, credential safety, and the active-target-only write model.
- Update current documentation only when a feature is actually implemented and verified.
