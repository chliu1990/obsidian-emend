# Deferred feature backlog: discovery and workflow improvements

## Status and scope

These are approved future feature requests, not current Emend behavior. Every item requires its own focused design, reviewed PR, unit tests, privacy/permission review, and appropriate real-Obsidian verification. Nothing here authorizes background requests, hidden vault scans, automatic uploads, new write permissions, or a bundled implementation.

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

## 4. Easier selected-text editing — issue #24

Track: https://github.com/chliu1990/obsidian-emend/issues/24

- [ ] Add a nearby checkbox or similarly direct composer control for modifying only selected text instead of requiring the Command Palette.
- [ ] Default to the selection workflow when usable text is selected, while preserving an explicit way to choose full-note chat/Edit.
- [ ] Reuse exact selection capture, complete-selection prompting, guarded Operations, native undo, pending controls, and Track Changes; do not add a second writer or submission path.

## 5. Minimal edit ranges — issue #23

Track: https://github.com/chliu1990/obsidian-emend/issues/23

- [ ] Reduce unnecessarily broad replacement ranges so small textual changes remain small and readable in Track Changes.
- [ ] Evaluate prompt guidance and deterministic post-processing separately; preserve exact source semantics and never weaken Operations validation.
- [ ] Test substitutions within sentences, repeated text, Unicode, existing CriticMarkup, overlap/ambiguity rejection, and unchanged-output no-ops.

## 6. Permission-grouped modes — issue #25

Track: https://github.com/chliu1990/obsidian-emend/issues/25

- [ ] Evaluate consolidating Ask/Discuss/Brainstorm into a read-only chat group while preserving their distinct prompting behavior or documenting why separate modes remain useful.
- [ ] Design explicit read-only, file-modify, and file-create permission groups without weakening current code-level write contracts.
- [ ] Keep any file-creation workflow independent from full-note Edit and require guarded destination/collision behavior.

## 7. Bilingual full-note translation — issue #12

Track: https://github.com/chliu1990/obsidian-emend/issues/12

- [ ] Add an explicit translation action with two allowlisted language settings and automatic A-to-B/B-to-A direction selection.
- [ ] Send complete source text with empty chat history; preserve Markdown, code, links, and existing CriticMarkup.
- [ ] Create exactly one target-language-suffixed Markdown file only after complete validated output. Never modify the source or overwrite an existing destination.
- [ ] Cover safe suffix/collision behavior, stale source, aborts, empty/large notes, and isolated real-Obsidian verification.

## 8. Same-device API-key sharing research — issue #13

Track: https://github.com/chliu1990/obsidian-emend/issues/13

- [ ] Research an explicit default-off **Share API keys across vaults on this device** option with per-vault SecretStorage fallback.
- [ ] Investigate Electron safeStorage and an app-global encrypted store; feature-detect support and refuse insecure/plaintext fallbacks.
- [ ] Require explicit migration/overwrite confirmation and a separate **Forget shared keys** action. Make no cross-device synchronization claim.
- [ ] Review the deliberate exception to vault-only file access and test supported desktop platforms before any implementation.

## Delivery constraints

- Keep each issue and each of the three maintainer roadmap requests independent; do not bundle discovery, linked notes, folder selection, mode redesign, translation, or credential storage into one PR.
- Preserve explicit actions, local data control, bounded context, credential safety, and the active-target-only write model.
- Update current documentation only when a feature is actually implemented and verified.
