# Stage 51: 2.10 bug hunt and stabilization

## Status

Status: PR A through PR F are recorded below, including each review round, the local gates, the PR E real-Obsidian matrix, and the 16 Round 3/4 deferrals with their tracking issues. Promotion is a separate controller/release decision; this record does not claim a release, a real-provider run, or coverage outside the recorded Linux/Xvfb environment.

Baseline for the round: `main` at `0db93f4`, 53 test files / 1,782 tests, lint and build clean.

## Round 1 — independent hunt

Six read-only agents audited independent surfaces: chat view and streaming, composer/control UI, write safety, persistence and sessions, providers/Web/context, and documentation drift. Every blocker was re-verified against source by the controller before triage. Findings are recorded in `docs/superpowers/plans/2026-11-17-emend-2-10-bug-hunt-stabilization.md` with severity and disposition.

Release blockers accepted for this round:

- **H1** Selection edits validated only the selected substring, then spliced the annotated selection into the note. A selection strictly inside an existing CriticMarkup token produced nested markup that `parseCriticMarkup` rejects, and later edits on that note failed terminally.
- **H2** Full-note freshness compared disk bytes with the editor-captured snapshot, so unsaved typing during a request was invisible and `vault.modify` could overwrite it.
- **H3** Structural guards classified only the pre-edit document; an operation payload could open a fence or add an unmatched backtick run, leaving the note partially uneditable.
- **H4** A failed thread load left no usable session, so Send, Enter, New, Rename, and Delete silently did nothing.
- **H5** An invalid stored message was filtered out and the shortened thread was silently rewritten without a backup.
- **H6** A quick action discarded the typed composer draft.
- **H7** A failing legacy-key migration save aborted `onload` before views and commands registered.

## PR A — write-safety hardening

### Fixes

1. `prepareEditResponse` now accepts `validatePrepared`, invoked after a successful `prepareEdit` and inside the same correction branch. `SelectionEditRequestCoordinator` composes `fullText.slice(0, from) + annotatedMarkdown + fullText.slice(to)`, revalidates it with `prepareCriticMarkupEdit`, and converts a rejection into `EditResponseValidationError('compiled-markup-rejected', …)`. The existing single same-provider correction round applies; a second invalid candidate is terminal with zero writes.
2. `NoteWriter` gained optional `readEditorText(file)`. `applyPreparedEdit` requires both disk text and, when available, the live editor text to equal the captured source before `vault.modify`. `main.ts` inspects every open Markdown view that holds the captured file and returns the first text differing from the target view's text (otherwise the target text, or `undefined` when no view holds the file), so a second pane with unsaved edits also fails closed. The guard adds no vault read.
3. `findPayloadStructureViolation` runs after replacement compilation and before final CriticMarkup validation. It compiles each payload the way it will be written — `{++text++}`, `{~~target~>replacement~~}`, `{>>comment<<}` — and requires every fence opener inside that wrapper to close on a later line that is followed by a line break inside the wrapper; a closer sharing the wrapper's last line rejects because the appended delimiter re-opens the fence. Every backtick run in the payload must pair with an equal-length run, and the runs between a matched pair count as span content, so nested spans such as `` ``a`b`` `` stay valid. Violations report `fenced-code-edit` with `field: 'text' | 'replacement' | 'comment'` and take the normal correction round. Balanced code blocks that end in a line break inside the payload remain allowed.
4. The payload diagnostic message now distinguishes payload-introduced structure from pre-edit fenced-code classification: `Operation N payload introduces unbalanced fenced code or backtick runs at line L; keep every fence and backtick run paired inside the operation payload. No edits were applied.`

`AGENTS.md` records all four invariants; `IMPLEMENTATION_PLAN.md` links this stage.

### Regression evidence

New tests:

- `tests/selection-editor.test.ts`: `rejects a selection replace that would nest markup inside an existing insertion token`, `applies the corrected candidate after composed-markup rejection`, `does not write when the composed candidate stays invalid`.
- `tests/edit-response.test.ts`: `routes a validatePrepared rejection into the single correction round`.
- `tests/note-writer.test.ts`: `rejects an edit when the open editor text differs from the captured source`, `applies when disk and editor text both match the captured source`, `accepts a disk-only writer when no editor reader is supplied`.
- `tests/main.test.ts`: `wires an editor reader scoped to the target file`, `rejects an edit when another open view of the target file has different text`.
- `tests/markdown-edit-guards.test.ts`: unbalanced fence insertion, unmatched backtick replacement, balanced code block, inline-code pair, nested backtick span, closer sharing the wrapper line, balanced block followed by a newline, comment payload opening a fence, removal and balanced-comment payloads.
- `tests/operation-edit-strategy.test.ts`: balanced code-block insertion, unbalanced fence insertion rejected, `routes an unbalanced fence insertion through the single correction round`.

RED was reproduced by restoring `src/` from `0db93f4` and running the five focused suites: **14 failed / 331 passed (345)** across all five files. GREEN on the fixed source: all five suites pass, and the full gate reports **53 files / 1,799 tests passed**.

## Independent review round

A fresh reviewer audited the PR A diff (`0db93f4..9cb65aa`) and found one Important hole and three smaller gaps.

- **Important — payload-only scanning.** Payload structure was scanned before compilation, so it never saw the wrapper that is appended to the last payload line. `text: '\n```\ncode\n```'` composed to `{++…```++}`, where ` ```++}` is a valid opener with info string `++}` and can never be a closer, leaving an unclosed fence to EOF. Fixed by scanning the compiled wrapper and requiring the closer to be followed by a line break inside the payload.
- **Minor — nested code spans.** Runs of 2, 1, 2 (a double-backtick span containing a single backtick) were rejected because the inner run had no equal-length partner. Fixed by marking every run between a matched pair as span content.
- **Minor — multi-pane freshness.** The editor reader consulted only the maintained target view, so a second open pane of the same file could hold different unsaved text. Fixed by inspecting every open Markdown view for the captured file and returning the first text that differs from the target view's text.
- **Diagnostics/docs.** The payload diagnostic now covers `field: 'comment'` and names the payload (not "inserted text"); the stage plan, `AGENTS.md` module rows, and the Stage 51 record describe the actual order and behavior. `MarkdownEditViolation['field']` already admitted `'comment'` from Stage 38, and `formatEditValidationFeedback` already allowed it, so no type change was needed.

Focused RED for this round — `npx vitest run tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/main.test.ts` — reproduced five failures: the closer-shares-the-wrapper-line insertion returned `undefined`, the comment-fence payload returned `undefined`, the nested backtick span was rejected, the unbalanced insertion applied through the coordinator, and a second open view of the target file with different text still wrote. GREEN after the fixes: **53 files / 1,805 tests passed**.

### Local gate

At the reviewed PR A head (`05f199a`, after the hardening round) with bundle SHA-256 `90a09311a1e3f848562f127bc1de92e355e32df3db5b19b71a045db06f7b657d`:

```text
npm test        53 files / 1,805 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit + esbuild production)
git diff --check clean
```

The pre-review PR A head (bundle `92f4e4b4…`) reported **53 files / 1,799 tests**.

### Limits

PR A is unit- and source-verified. Real-Obsidian confirmation of the composed-markup rejection, concurrent-typing stale rejection, and fence-payload rejection is scheduled in PR E's exploratory matrix; no macOS, Windows, or real-provider evidence is claimed here.

## Remaining sections

PRs B–F append their findings, fixes, RED→GREEN evidence, and gates below, and the PR E real-Obsidian matrix records the whole-round runs. The deferred Round 3/4 items with their issue numbers are listed at the end of this record.

## PR B — session, persistence, and instruction resilience

### Fixes

1. **H4 — failed thread load.** `EmendChatView.refreshTargetNote` keeps showing the existing `Emend: Could not load this chat. <reason>` Notice, but when the load is still current it first installs `getTransientSession(notePath)` as the only session and points `activeSessionId`/`messages` at it. Send, Enter, New, Rename, and Delete work again and the next submission materializes the transient session through the normal persistence path. Stale loads still return without touching newer state, and the `finally` still clears loading and renders.
2. **H5 — invalid stored messages.** `validateChatConversation` now returns `{ conversation, droppedMessages }`. `inspectThread` carries the count, `loadConversation` warns once through the existing warning callback, and `inspectForMutation` passes the original bytes as `malformedContents` whenever the count is positive, so the first rewrite of a thread that contained an unreadable message writes the pre-rewrite aggregate to the reusable `.corrupt` file while the readable messages survive. Unsupported-version refusal and whole-file malformed handling are unchanged.
3. **H7 — failed legacy-key migration.** `loadSettings` reads and writes the SecretStorage secret first, then awaits `saveSettings()` inside `try/catch`. A rejected save shows one Notice (`Emend: Could not save migrated API keys. <reason>`) and returns; the in-memory legacy key is cleared only after a successful save, and `onload` continues to register the view, commands, ribbon, and settings tab. The shared save queue continues after the rejection.
4. **H6 — quick-action drafts.** `submitQuickAction` calls `saveCurrentDraft()` before submitting and `submitPrompt` skips the per-session draft deletion when `fromQuickAction` is set, so the render seeding restores the typed text after the edit result instead of clearing the composer.
5. **Stop race on a committed edit.** The submission tracks whether the edit result reported `applied`. A committed edit skips the post-result abort check and persists its concise summary with `allowAbortedSave`, so `appendReadyMessage` does not receive an already-aborted signal; the assistant renders ready and the summary survives. No-op, chat, and unwritten responses keep the existing stopped branch and persist nothing.
6. **Instruction loading bounds.** `loadAllInstructions` wraps each skill `vault.read` in `try/catch`, skips that skill with one Notice, and keeps loading the rest. It caps total instruction characters at `MAX_INSTRUCTION_CHARACTERS = 20000`, spending the budget in prompt order (skills in reference order, then `AGENTS.md`) and ending any truncated text with the `[...]` marker, with one truncation Notice. The `AGENTS.md` read itself is unchanged.
7. **Selection modal disposables.** One `activeSelectionModal` field replaces the per-invocation `register(() => modal.close())`; a repeated command invocation closes the previous modal, and the override closes the retained modal on `onunload`. Repeated invocations no longer grow the plugin disposer list.
8. **Deleted related-note targets.** `AdditionalNotesStore.removeInvalid` drops a target key equal to the deleted path or inside the deleted folder, using the same path-segment predicate as entry removal, so a recreated note starts with no related notes.

### Regression evidence

New tests:

- `tests/chat-view.test.ts`: `recovers a usable transient session when the thread load fails`, `shows New chat as usable after a failed thread load`, `preserves the typed draft after a successful quick action`, `persists an applied edit result when Stop races the ready snapshot`.
- `tests/conversation-store.test.ts`: `backs up the aggregate before rewriting a thread that contains an invalid message`, `reports dropped messages without deleting the readable thread`.
- `tests/chat-sessions.test.ts`: the round-trip and filtered-message cases now assert `{ conversation, droppedMessages }`, including `droppedMessages === 3` for filtered entries.
- `tests/main.test.ts`: `registers commands when the legacy key migration save rejects`, `retains at most one selection modal across repeated command invocations`.
- `tests/instructions-loader.test.ts`: `skips a skill whose read rejects and keeps the rest`, `bounds total instruction characters`.
- `tests/additional-notes-store.test.ts`: `drops the deleted target note's own selections`, plus updated expectations for `removes deleted paths and drops their own target state`, `removes deleted file paths and invalid Links provenance without cross-target leakage`, the descendant/descriptor folder case retargeted to a note outside the deleted folder, and the root-folder delete case where every target disappears.
- Fixture updates: `tests/quick-actions.test.ts` stubs and asserts `saveCurrentDraft`; `tests/selection-unload.test.ts` aborts the retained modal through `plugin.onunload()` instead of a registered disposer.

RED excerpts (each captured before its fix):

```text
# B1
FAIL tests/chat-view.test.ts > EmendChatView thread-load recovery > recovers a usable transient session when the thread load fails
AssertionError: expected [] to have a length of 1 but got +0

# B2
FAIL tests/conversation-store.test.ts > ConversationStore corruption recovery > backs up the aggregate before rewriting a thread that contains an invalid message
AssertionError: expected undefined to be '{"version":3,"lastActiveSessionId":"s…' // Object.is equality
FAIL tests/conversation-store.test.ts > … > reports dropped messages without deleting the readable thread
AssertionError: expected "vi.fn()" to be called once, but got 0 times

# B3
FAIL tests/main.test.ts > EmendPlugin settings migration > registers commands when the legacy key migration save rejects
AssertionError: promise rejected "Error: Disk is full" instead of resolving

# B4
FAIL tests/chat-view.test.ts > EmendChatView quick action drafts > preserves the typed draft after a successful quick action
AssertionError: expected '' to be 'Keep this' // Object.is equality

# B5
FAIL tests/chat-view.test.ts > EmendChatView committed edit persistence > persists an applied edit result when Stop races the ready snapshot
AssertionError: expected 'stopped' to be 'ready' // Object.is equality

# B6
FAIL tests/instructions-loader.test.ts > loadAllInstructions > skips a skill whose read rejects and keeps the rest
Error: Unreadable file: skills/broken/SKILL.md
FAIL tests/instructions-loader.test.ts > loadAllInstructions > bounds total instruction characters
AssertionError: expected '`skills/large`\nAAAAAAAAAAAAAAAAAAAAA…' to have a length of NaN but got 15015
FAIL tests/main.test.ts > EmendPlugin Selection modal lifecycle > retains at most one selection modal across repeated command invocations
AssertionError: expected [] to deeply equal [ SelectionModal{ …(18) } ]

# B7
FAIL tests/additional-notes-store.test.ts > AdditionalNotesStore > drops the deleted target note's own selections
AssertionError: expected [ 'B.md', 'C.md' ] to deeply equal []
```

### Local gate

At the PR B head (`27e4df3`) with bundle SHA-256 `6ff678615004fc64d6bda473072851f1120d8d0ecb32599fae638c4bb91248d2`:

```text
npm test        53 files / 1,816 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit + esbuild production)
git diff --check clean
```

The PR B branch adds 11 tests to the 1,805 counted after PR A. Each task was committed separately (`7abf6cb`, `4d93c39`, `410e248`, `d5d3f69`, `98b8f15`, `a410cf1`, `27e4df3`) with its focused suites green before the next task started; two test-fixture alignments were folded back into the commits that made them necessary instead of leaving red commits in the history.

### Limits

PR B is unit- and source-verified only. No real-Obsidian run confirms the load-failure recovery, the `.corrupt` backup of a partially valid thread, the quick-action draft restoration in a real textarea, the committed-edit Stop race, the instruction truncation Notice, the single retained modal across real command invocations, or the deleted-target related-note cleanup; that evidence belongs to PR E's exploratory matrix. No macOS, Windows, or real-provider evidence is claimed. The 20,000-character instruction cap is a local character budget, not tokenization.

### Review round

A fresh review of the PR B diff raised one Medium and three Low findings plus one test gap.

- **Medium — legacy drops had no backup.** The schema-1/2 branch reported `droppedMessages: 0` while filtering with `isReadyMessage`, so an unreadable legacy message was still silently removed on the first migration write. `inspectThread` now filters once into `readyMessages` and reports `value.messages.length - readyMessages.length`, so the legacy path inherits the same load warning and the same pre-rewrite `.corrupt` backup as schema 3.
- **Low — partial truncation marker.** `truncateInstructions` returned `INSTRUCTION_TRUNCATION_MARKER.slice(0, budget)` when the remaining budget was at or below the five-character marker, so the note ended with `[..` or `[...]` used as content. It now returns `undefined` for a text that cannot fit the complete `[...]` marker (a text that fits the tiny budget is still returned whole), so the marker is either complete or absent.
- **Low — unreadable root instructions.** A rejecting `vault.read` for the vault-root instruction file aborted the whole submission. The root read is now wrapped in the same tolerant path as skills: one `Emend: Could not read the instruction file AGENTS.md.` Notice, no agent text, empty skills, and later calls keep working.
- **Low — stale retained modal.** `activeSelectionModal` was only cleared on `onunload`, so a user-closed modal stayed referenced and a later command invocation issued a redundant `close()` on it. `SelectionModal` now takes an optional `notifyClosed(modal)` callback from `onClose`, and `main.ts` clears the field only when the closed instance is still the retained one; `onunload` clears the field first and then closes a still-open modal.
- **Test gap — vacuous target-key assertion.** The deleted-target case asserted an empty list for a key that was never populated. It now seeds a real `Folder-other/Target.md` target beside `Folder/Target.md` and asserts the sibling keeps its selection while `Folder/Target.md` and `Folder/Target-other.md` are dropped, proving the folder boundary for target keys rather than only for entry paths.

New tests:

- `tests/conversation-store.test.ts`: `backs up a legacy thread before dropping an invalid message` — valid legacy message survives, one warning, no write on load, exact original bytes in `.corrupt` after the first mutation.
- `tests/instructions-loader.test.ts`: `omits the agent text when only 5 characters of budget remain`, `omits the agent text when only 3 characters of budget remain` (parameterized), `skips an unreadable AGENTS.md and still loads skills`.
- `tests/main.test.ts`: `clears the retained modal when it closes itself` — the shared lifecycle harness now routes the stubbed `close()` through `onClose()` and exposes the retained field, so self-close clears it and a repeated invocation does not call `close()` on the stale instance.
- `tests/additional-notes-store.test.ts`: strengthened `drops the deleted target note's own selections` (sibling-prefix target key). This one passes against the existing predicate by design; it would fail under a naive `startsWith(folderPath)` boundary.

RED excerpts:

```text
FAIL tests/conversation-store.test.ts > ConversationStore corruption recovery > backs up a legacy thread before dropping an invalid message
AssertionError: expected "vi.fn()" to be called once, but got 0 times

FAIL tests/instructions-loader.test.ts > loadAllInstructions > omits the agent text when only 5 characters of budget remain
AssertionError: expected '[...]' to be undefined
FAIL tests/instructions-loader.test.ts > loadAllInstructions > omits the agent text when only 3 characters of budget remain
AssertionError: expected '[..' to be undefined
FAIL tests/instructions-loader.test.ts > loadAllInstructions > skips an unreadable AGENTS.md and still loads skills
Error: Unreadable root

FAIL tests/main.test.ts > EmendPlugin Selection modal lifecycle > clears the retained modal when it closes itself
AssertionError: expected SelectionModal{ app: { …(3) }, …(17) } to be null
```

The sibling-prefix target-key assertion is not a RED: it documents behavior the store already had and would fail only under a prefix-matching regression.

### Review-round gate

At `6ceb73d` with bundle SHA-256 `1a030bf29b9fc38689b461cff1a808523c24234ba901f2644c558d7292352c50`:

```text
npm test        53 files / 1,821 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit + esbuild production)
git diff --check clean
```

The review round adds 5 tests (1,816 → 1,821). `src/selection-modal.ts` is the only module whose constructor contract changed, and only by one optional trailing callback, so the Stage 45/49 modal behavior and its tests are unchanged.

## PR C — interaction, streaming, and accessibility

This section records PR C on branch `fix/2.10-interaction`, based at `9a79f40` (PR B merged). The first pass shipped C1–C3; the second pass below adds C4–C7.

### Fixes

1. **C1 — streaming DOM identity.** `renderMessageBody` previously called `bodyEl.empty()` on every scheduled streaming frame, recreating the reasoning `<details>` closed and the answer element underneath it. Loading messages now build their structure once per message body and update only the reasoning/activity/content text. The structure is reused while the message shape is unchanged: role, `webActivity` presence, reasoning presence, and the provisional Web draft label. A shape change rebuilds once and carries the previous `details.open` and reasoning scroll position forward. Text updates reuse the existing text node's `nodeValue`, so an in-answer selection is not replaced; only a shape change rebuilds the content element. Terminal messages delete the cached structure and use the unchanged plain-text-then-Markdown path.
2. **C2 — composer disabled and fail-closed state.** `composerState().sendDisabled` now includes `!this.notePath`, so Send is disabled when no Markdown note is open. The generic target-capture `catch` in `submitPrompt` captures the draft, caret, and focus state before re-rendering and passes them through the existing `ComposerRestoreState`, so the restored text drives the estimate, `draftCapacityBlocked`, quick-action capacity, and the caret/focus position instead of leaving a stale estimate for the previous draft.
3. **C3 — session switch guard.** `switchActiveSession` now refuses a switch when `isSending`, `isThreadLoading`, or `isSessionMutating`, mirroring `beginSessionMutation`. The request is therefore not aborted and no loading message is abandoned by a session-selector race; the session controls already disable themselves while sending.

### Regression evidence

- `tests/chat-view.test.ts` (new `describe('EmendChatView streaming DOM identity')`): `keeps an opened reasoning panel and its scroll while streaming`, `keeps the opened reasoning panel when the first answer content arrives`.
- `tests/chat-view.test.ts` (new `describe('EmendChatView composer fail-closed state')`): `disables Send when no Markdown note is open`, `restores draft estimate and capacity blocking after a fail-closed capture`.
- `tests/chat-view.test.ts` (new `describe('EmendChatView session switch guard')`): `refuses a session switch while a request is in flight`.
- `tests/request-isolation.test.ts`: `keeps the same-note pending lock while a session switch is refused` (previously `… across a session switch until the aborted request settles`), because a session switch no longer aborts an in-flight request.

RED before each fix:

```text
FAIL tests/chat-view.test.ts > EmendChatView streaming DOM identity > keeps an opened reasoning panel and its scroll while streaming
AssertionError: expected FakeElement { … } to be FakeElement { … } // Object.is equality
FAIL tests/chat-view.test.ts > EmendChatView streaming DOM identity > keeps the opened reasoning panel when the first answer content arrives
AssertionError: expected FakeElement { … } to be FakeElement { … } // Object.is equality
Tests  2 failed | 261 skipped (263)

FAIL tests/chat-view.test.ts > EmendChatView composer fail-closed state > disables Send when no Markdown note is open
AssertionError: expected false to be true
FAIL tests/chat-view.test.ts > EmendChatView composer fail-closed state > restores draft estimate and capacity blocking after a fail-closed capture
AssertionError: expected +0 to be 10
Tests  2 failed | 263 skipped (265)

FAIL tests/chat-view.test.ts > EmendChatView session switch guard > refuses a session switch while a request is in flight
AssertionError: expected 'a2' to be 'a1'
Tests  1 failed | 265 skipped (266)
```

Three existing session-runtime tests (`isolates stale stream callbacks and finally cleanup from a newer request after A1 → A2 → B → A1`, `suppresses a stale final-save Notice after a session transition`, `does not apply stale initial-save metadata after a session transition`) used a session switch to abort an in-flight request. They now release the request explicitly with `abortActiveRequest()` before the switch, so they keep exercising the same stale-callback, stale-save-notice, and stale-metadata guards without relying on the removed path. Test harnesses that call the split rendering methods received matching `renderStreamingMessageBody`/`renderFinalMessageBody` stubs.

### Local gate

At `3ae7e4c` with bundle SHA-256 `ef944dc21dd8f2899c272d6c239c01110504b297d6ff9149bb3ac52208b320ca`:

```text
npm test        53 files / 1,826 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

Baseline `9a79f40` was 53 files / 1,821 tests, so this pass adds 5 tests.

### Commits

| Task | Commit | Message |
| --- | --- | --- |
| C1 | `a77b0aa` | `fix: preserve streaming message DOM state` |
| C2 | `7ab40e6` | `fix: synchronize composer disabled and capacity state` |
| C3 | `3ae7e4c` | `fix: guard session switches during requests` |

### Limits

Everything here is unit- and source-verified. Real-Obsidian confirmation of reasoning-panel state and text selection across streaming frames, a disabled Send with no note open, the restored caret, and a refused session-selector race belongs to the PR E exploratory matrix. No macOS, Windows, real-provider, or screen-reader evidence is claimed, and C4–C7 remain open.

### Second pass — C4–C7

The second pass extends the same branch and follows the same RED → GREEN discipline for each task.

#### Fixes

4. **C4 — stale menu and popover state.** `ChatComposerControls` and `ChatModelControl` now clear `activeMenu` inside their `onHide` handler, so a capacity refresh or any other `update()` after a dismissal no longer writes checked/disabled state into a menu the host already hid (M10). Clearing the active menu would have broken the Stage 50 hide-before-click ordering, so each control remembers the single menu it just hid: that menu may still deliver exactly one selected-item callback, and the reference is dropped on activation, on the next open, on a settings refresh, and on destroy. `RelatedNotesExplorer.close()` removes the trigger's `aria-controls` (M11 dangling reference), and `RelatedNotesControl.destroy()` closes the explorer with `restoreFocus = false` so a rerender/destroy cannot focus a trigger element that is leaving the DOM; focus restoration additionally skips a trigger whose `isConnected` is `false`.
5. **C5 — focus, naming, Escape, and announcements.** Removing an additional note now restores focus to the Remove button that took the removed path's place, then `Clear all`, then `Add notes` when the list empties (M11 focus loss). The capacity bar handles Escape on its own focusable root — preventing default and stopping propagation only for a key press inside the bar — while the document listener remains for a pinned panel that lost focus, dismissing without `preventDefault`/`stopPropagation` so host Escape shortcuts are no longer swallowed (M11). The Modify Selection textarea is named `Selection instruction` via `aria-label="Selection edit instruction"` (M11). `ContextCapacityDisplay.render()` accepts an optional `debounceAnnouncement` flag that defers only the `role="status"` summary text by 500 ms while bar widths, `aria-valuenow`, `aria-valuetext`, and blocked controls update immediately; the Modify Selection textarea input uses it, so rapid typing produces one settled announcement instead of one per keystroke (M8).
6. **C6 — completion alignment and estimate debounce.** Completion scroll alignment is now bound to the render generation the completion created. The ready path records `responseStartRenderGeneration = renderGeneration + 1` beside `responseStartMessageId`, and `settleMarkdownRender` consumes the target only when its generation matches; an unrelated render clears the stale target and applies its own `pendingScrollRestore`, so an upward reader is no longer jumped to the completed answer's header and left without a restore (M12). The composer `input` handler now routes through the existing `scheduleCapacityRefresh()` 150 ms debounce instead of calling `refreshDraftEstimate` synchronously, so typing no longer snapshots the whole note and re-renders the bar per keystroke (M21); the placeholder update stays synchronous and submissions still re-estimate before creating a message.
7. **C7 — streaming versus rendered whitespace.** The detached `MarkdownRenderer` output now carries `emend-chat-message-markdown` with `white-space: normal`, while streaming, user, error, and provisional draft text keep `emend-chat-message-content` with `white-space: pre-wrap`. Soft line breaks in a finalized answer therefore render as Markdown line breaks instead of hard breaks (M22). Shared typography, wrapping, and first/last-child margins are declared for both classes.

#### Regression evidence

- `tests/chat-composer-controls.test.ts`: `does not mutate a menu after it is hidden`; the existing `accepts the current native menu item after its hide callback precedes the click`, `ignores stale menu items and stale onHide callbacks`, and destroy tests still pass.
- `tests/chat-model-control.test.ts`: `does not mutate a menu after it is hidden`; the existing hide-before-click, stale hide/item, `refreshes the summary and options, closes the old menu, and rejects stale items`, and destroy tests still pass. `refresh()` explicitly drops the just-hidden menu so a settings refresh still invalidates detached callbacks.
- `tests/related-notes-control.test.ts`: `clears aria-controls when the explorer closes`, `does not focus a detached trigger when controls are destroyed`.
- `tests/additional-notes-ui.test.ts`: `restores focus to the next remove button after removing a path` (next Remove → Clear all → Add notes).
- `tests/context-capacity-ui.test.ts`: `does not stop Escape propagation outside the capacity bar`, plus the adapted `dismisses a pinned tooltip on document Escape after focus loss` (inside-Escape now asserted on the bar).
- `tests/selection-modal.test.ts`: `names the selection instruction textarea`, `does not announce the capacity summary on every keystroke`, plus `shows the shared estimate above quick actions and refreshes on input without re-rendering` and `keeps the typed draft estimate and Modify state after a blocked stale-enabled quick action`, which now await the settled announcement instead of assuming a synchronous summary.
- `tests/chat-view.test.ts`: `restores the reader position when an unrelated render follows a completion`, `debounces the draft estimate during composer typing`, `renders a finalized answer without the streaming pre-wrap class`. The four existing capacity tests that typed and then asserted synchronously (`updates the estimate while typing …`, `blocks Send, Enter, Mod+Enter, …`, `keeps Send enabled and submits below capacity`, `recomputes with the restored draft after a Web control change`) and the C2 fail-closed test now await the 150 ms capacity debounce, matching the new contract.

RED before each fix:

```text
FAIL tests/chat-composer-controls.test.ts > ChatComposerControls > does not mutate a menu after it is hidden
AssertionError: expected false to be true // Object.is equality
FAIL tests/chat-model-control.test.ts > ChatModelControl > does not mutate a menu after it is hidden
AssertionError: expected false to be true // Object.is equality
FAIL tests/related-notes-control.test.ts > RelatedNotesControl > clears aria-controls when the explorer closes
AssertionError: expected 'emend-chat-related-notes-explorer-30' to be undefined
FAIL tests/related-notes-control.test.ts > RelatedNotesControl > does not focus a detached trigger when controls are destroyed
AssertionError: expected true to be false // Object.is equality
Tests  4 failed | 76 passed (80)

FAIL tests/additional-notes-ui.test.ts > AdditionalNotesControl > restores focus to the next remove button after removing a path
AssertionError: expected [] to deeply equal [ 'Remove Three.md' ]
FAIL tests/context-capacity-ui.test.ts > ContextCapacityDisplay > does not stop Escape propagation outside the capacity bar
AssertionError: expected true to be false // Object.is equality
FAIL tests/selection-modal.test.ts > SelectionModal draft capacity estimate > names the selection instruction textarea
AssertionError: expected undefined to be 'Selection edit instruction'
FAIL tests/selection-modal.test.ts > SelectionModal draft capacity estimate > does not announce the capacity summary on every keystroke
AssertionError: expected 'Estimated input: 6 tokens of 900 effe…' to be 'Estimated input: 1 tokens of 900 effe…'
Tests  4 failed | 77 passed (81)

FAIL tests/chat-view.test.ts > … > restores the reader position when an unrelated render follows a completion
AssertionError: expected 200 to be 275 // Object.is equality
FAIL tests/chat-view.test.ts > EmendChatView draft capacity estimate > debounces the draft estimate during composer typing
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Tests  2 failed | 266 skipped (268)

FAIL tests/chat-view.test.ts > EmendChatView terminal response continuity > renders a finalized answer without the streaming pre-wrap class
AssertionError: expected [] to have a length of 1 but got +0
Tests  1 failed | 268 skipped (269)
```

Both menu RED cases are the same mutation assertion: `update()` after `menu.hide()` flipped the checked item of a dismissed menu.

#### Commits

| Task | Commit | Message |
| --- | --- | --- |
| C4 | `7f1956e` | `fix: clear stale menu and popover state` |
| C5 | `55cf253` | `fix: restore focus and contain keyboard handling` |
| C6 | `4bea061` | `fix: scope completion alignment and debounce estimates` |
| C7 | `f6e6dc0` | `fix: separate streaming and rendered whitespace` |

#### Local gate

At `f6e6dc0`, with `main.js` rebuilt from a clean `f6e6dc0` tree and SHA-256 `5202e34e04c1478da971c950dc433bb9926c3172eca7e29c42f4cf1a4f75edd2`:

```text
npm test        53 files / 1,837 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

C1–C3 ended at 1,826 tests, so this pass adds 11 (C4 4, C5 4, C6 2, C7 1). `main.js` is gitignored; the docs-only commit changes the build identity, so a rebuild at the docs head will not reproduce the hash above.

#### Limitations and deviations

- All C4–C7 evidence is unit/source level. Native menu dismissal races, screen-reader announcement cadence, real Escape propagation in Obsidian, the completion alignment in a live scroller, and the rendered soft-break behaviour require the PR E real-Obsidian matrix; no macOS, Windows, provider, or assistive-technology claim is made.
- C4 keeps a single "just hidden" menu reference per control. That is the narrowest way to preserve Stage 50's hide-before-click acceptance after clearing the active menu; it is dropped on activation, next open, settings refresh, and destroy, so a dismissed menu cannot be mutated or activated twice.
- C5's announcement deferral is opt-in per render. Chat's composer already debounces the estimate at its source (C6), so the display default stays synchronous and the deferral is used by the Modify Selection textarea, whose input is not otherwise debounced. Reviewers should confirm that split is preferable to a silently lagging visible summary in chat.
- C6 binds alignment with one extra integer field rather than a render-generation token object; `settleMarkdownRender` treats a missing field as the legacy unbound case, which keeps the direct-call unit harnesses meaningful.
- C7 changes the rendered element's class name. `messageContentElements` in `tests/chat-view.test.ts` now matches either class because both are the single message body text element; nothing else keys on the old class.

### PR C review round — cheap fixes

The PR C review round raised six findings. Three were cheap and are fixed here; findings 3, 4, and 6 remain deferred and are listed below.

#### Fixes

1. **Finding 1 — completion generation wiring was untested.** The C6 fix recorded `responseStartRenderGeneration = renderGeneration + 1` beside `responseStartMessageId`, but every unit test drove `settleMarkdownRender` with a hand-written context, so removing the `+1` would still have passed. `wires a real completion to its own render generation before aligning` now submits through the real `submitPrompt`/completion path, asserts `responseStartRenderGeneration === renderGeneration` on the post-completion render, then settles that generation with stubbed scroll geometry and asserts the completed header alignment (`scrollTop` 40 → 200), the cleared target fields, and an unconsumed `pendingScrollRestore`. Removing the `+1` fails the first assertion (`expected 3 to be 4`).
2. **Finding 2 — a refused switch left the selector on the rejected option.** `switchActiveSession` returned before touching the view, so the native `<select>` kept the option the user had just picked while the active session stayed unchanged. The refusal now calls a new `syncSessionControl()` (built from the same `sessionControlState()` the render path uses), which rewrites the option list, the active value, and the pending disabled state. The C3 test extends to set the selector to `a2`, refuse the switch, and assert the value snaps back to `a1` and the control becomes disabled. Removing the resync fails with `expected 'a2' to be 'a1'`.
3. **Finding 5 — doc wording.** `AGENTS.md` described the capacity summary deferral as "deferred for one render"; it is a 500 ms trailing delay, so the contract now says "deferred to a 500 ms typing pause".

The settle reorder also makes the alignment path leave `pendingScrollRestore` unconsumed instead of clearing a restore it never applied; that is what the new wiring test asserts, and `AGENTS.md` records it.

#### Deferred review findings

- **Finding 3 — capacity announcement deferral is opt-in per render.** Chat keeps a synchronous visible summary while the Modify Selection textarea defers its announcement, so the two surfaces have different announcement timing by design. No user-visible defect was proven, and a uniform policy needs a real screen-reader session; deferred to the PR E matrix.
- **Finding 4 — the just-hidden menu grace window is a host-ordering assumption.** Clearing `activeMenu` in `onHide` while keeping one menu eligible for a single activation is the narrowest way to preserve Stage 50, but only real Obsidian can prove that a dismissed menu never delivers a late click for that window; deferred to the PR E real-Obsidian menu matrix.
- **Finding 6 — rendered-answer class rename and the unverified soft-break rendering.** Rendered answers moved from `emend-chat-message-content` to `emend-chat-message-markdown`; any user CSS snippet that targeted the old class on finalized answers no longer applies, and the underlying soft-line-break defect was never reproduced in a real vault. Deferred to PR E, which owns the visual confirmation and any release note about the class name.

#### Review-round gate

At `ded5f5d`, with `main.js` rebuilt from a clean `ded5f5d` tree and SHA-256 `9ff09c3da6406917b57fdaa42f650742ee149f37383398e9c55516d8075bc4ab`:

```text
npm test        53 files / 1,838 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

The C4–C7 pass ended at 1,837 tests; this round adds one test (the real-completion wiring assertion) and extends the existing C3 test.

| Task | Commit | Message |
| --- | --- | --- |
| Review fixes | `ded5f5d` | `fix: close PR C review findings` |
| Review docs | this docs commit | `docs: record PR C review round` |

## PR D — provider, privacy, and settings correctness

Branch `fix/2.10-provider-correctness`, based at `5576d4e` (PR C merged, 53 files / 1,838 tests). The first pass shipped D1–D3 and the second pass shipped D4–D6; both are recorded below.

### Fixes (D1–D3)

1. **D1 — credential-bearing base URLs and error redaction.** `requestAiResponse`, `discoverProviderModels`, and the `requestDeepSeekTool` base-URL validator now reject a parsed URL whose `username` or `password` is nonempty with `<provider> base URL must not contain credentials.` (M2). The message never repeats the URL, so the credential cannot be echoed. `sanitizeProviderError` and `sanitizeDiscoveryError` additionally replace a `//user:pass@` userinfo segment with `//***@`, so a host or transport error that quotes the configured URL cannot leak it. Failing before `fetch` also means the `user:pass@host` value never reaches the chat transport, the Search/Fetch JSON clients, or model discovery. Base-URL trimming, HTTP(S) enforcement, and the missing-key/model errors are unchanged.
2. **D2 — schema failures are `format`, not `network`.** Parser throws now use an exported `DeepSeekResponseFormatError`, and a successful Search/Fetch response whose body is not JSON is tagged the same way before sanitization. `WebFailureReason` gained `'format'`; the coordinator classifies that error as `reason: 'format'` with `retryable: false` before the transport status rules, so a 200 response with a drifted schema performs exactly one call instead of a second paid retry and no longer reports a false cause (M3). Transport failures keep `network`/`http` and their existing retry matrix, and the failure payload keeps the closed `kind`/`reason`/`httpStatus`/`attempts` shape. A Search format failure still degrades non-fatally to `search_failed`; a Fetch format failure stays an unread `fetch_failed`. Activity rows render `Search · Failed (format) · …` / `Fetch · Failed (format) · …` through the `format` label added to `WEB_FAILURE_REASON_LABELS`. The aggregate unread-page, extraction, search, omission, and skipped-call warnings are unchanged: they already report incompleteness, and the reason itself stays transient in the activity row and tool result.
3. **D3 — optional search metadata and duplicate URLs.** `parseDeepSeekSearchResponse` accepts an omitted (or `null`) `site_name`, `date`, and `snippet` instead of failing the whole search, and keeps `snippet` absent when it is absent (M4). Required `title`, `url`, `summary`, and `content` strings and the malformed-response rejection are unchanged, and an entry whose URL is not a credentialess HTTP(S) URL is still skipped. `buildSearchExtractionDocuments` now deduplicates by `normalizeWebUrl(result.url)` before assigning `R<n>` temporary IDs, so two hits for one URL produce one reader document, one tool-payload entry, and one stable `S` citation instead of duplicate IDs in the same payload (M18). First occurrence wins; the reader and citation order follow the surviving retrieval order.

`AGENTS.md` records the credential-URL rule and userinfo redaction, the `format` reason and its non-retryable classification, the optional-metadata tolerance, and the normalized-URL deduplication in the module table, Providers and settings, DeepSeek online search item 6, the Web verification checklist, and Security and privacy.

### Regression evidence

New tests (+11):

- `tests/provider-stream.test.ts`: `rejects a base URL with embedded credentials without echoing it`, `redacts a userinfo segment from a provider error`.
- `tests/model-discovery.test.ts`: `rejects a base URL with embedded credentials without echoing it`.
- `tests/deepseek-web.test.ts`: `rejects a base URL with embedded credentials without echoing it`, `reports a malformed search payload as a format failure without retrying`, `reports a malformed fetch payload as a format failure`, `does not retry a 200 retrieval response whose body is not JSON`, `parses search results that omit optional site_name and date`, `merges search results that share a normalized URL into one cited source`.
- `tests/chat-view.test.ts`: the failed-activity label table gained a `format` row asserting `Search · Failed (format) · drifted query`.
- `tests/web-extraction.test.ts`: `assigns one temporary ID per normalized URL and drops duplicate hits`.

RED before each fix:

```text
FAIL tests/provider-stream.test.ts > requestAiResponse > rejects a base URL with embedded credentials without echoing it
AssertionError: expected 'Cannot read properties of undefined (…' to match /base URL/i
FAIL tests/model-discovery.test.ts > discoverProviderModels > rejects a base URL with embedded credentials without echoing it
AssertionError: expected 'Cannot read properties of undefined (…' to match /base URL/i
Tests  3 failed (3)

FAIL tests/provider-stream.test.ts > requestAiResponse > redacts a userinfo segment from a provider error
Expected: "connect failed for https://***@provider.example.test/v1"
Received: "connect failed for https://token-user:token-secret@provider.example.test/v1"

FAIL tests/deepseek-web.test.ts > DeepSeek web transport retry and search degradation > reports a malformed search payload as a format failure without retrying
AssertionError: expected "vi.fn()" to be called once, but got 2 times
FAIL tests/deepseek-web.test.ts > DeepSeek web transport retry and search degradation > reports a malformed fetch payload as a format failure
AssertionError: expected "vi.fn()" to be called once, but got 2 times
Tests  2 failed | 1 passed | 87 skipped (90)

FAIL tests/deepseek-web.test.ts > DeepSeek retrieval clients > parses search results that omit optional site_name and date
DeepSeekResponseFormatError: DeepSeek returned a malformed search response.
FAIL tests/deepseek-web.test.ts > DeepSeekWebSearchCoordinator > merges search results that share a normalized URL into one cited source
AssertionError: expected [ { sourceId: 'R1', …(4) }, …(1) ] to have a length of 1 but got 2
FAIL tests/web-extraction.test.ts > canonical extraction documents > assigns one temporary ID per normalized URL and drops duplicate hits
AssertionError: expected [ { sourceId: 'R1', …(4) }, …(2) ] to deeply equal [ { sourceId: 'R1', …(4) }, …(1) ]
Tests  2 failed | 148 skipped (150)
```

The three credential tests failed because the URL was accepted and `fetch` ran with an `undefined` mock response; the format tests failed because the parser throw was classified `network` and retried once; the optional-metadata test failed because the parser required the three optional fields; and the duplicate-URL tests failed because two documents were built for one URL.

### Local gate

At code head `225037e`, with `main.js` rebuilt from that tree and SHA-256 `ece95287f033a1b7eef3993d9f684768ad144f59b3cb6b7c7df11255c83fe77d`:

```text
npm test        53 files / 1,849 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

Base `5576d4e` was 53 files / 1,838 tests, so this pass adds 11. `main.js` is gitignored; the docs commit changes the esbuild build identity (`git rev-parse --short HEAD`), so a rebuild at the docs head will not reproduce the hash above.

### Commits

| Task | Commit | Message |
| --- | --- | --- |
| D1 | `feb64d9` | `fix: reject credential-bearing provider URLs` |
| D2 | `05ca241` | `fix: classify schema failures as format errors` |
| D3 | `225037e` | `fix: tolerate optional search metadata and merge duplicate URLs` |

### Limits

- Everything here is unit- and source-verified. No real Obsidian, loopback SSE/Search/Fetch harness, or real provider was exercised in this pass; the PR E exploratory matrix owns the live runs, and no macOS, Windows, provider, or assistive-technology claim is made.
- Rejecting credentials at request time does not rewrite an already-persisted `user:pass@host` value in `data.json`; Settings still stores whatever the user typed, and the next request fails closed with the new message. A settings-level rejection or one-time rewrite was not added because it would change persisted data outside this fix's boundary.
- The `format` label is a top-level failure reason beside the existing reader failure kind `format`; rows read `Failed (format)` for a schema-drift failure and `Failed (reader format)` for an extractor output failure.

### Second pass — fixes (D4–D6)

4. **D4 — usage-triplet consistency and the enforced call limit.** `provider-stream.ts` exports `isConsistentTokenUsage`, and `parseTokenUsage` now discards a nonnegative-integer triplet whose `total_tokens` is not the sum of `prompt_tokens` and `completion_tokens`, so the inconsistent value never reaches `StreamResult.usage` (M14). `token-usage.ts` applies the same rule defensively: `resolveTokenUsage` and `resolveRoundTokenUsage` treat a stored inconsistent triplet as unusable and take the existing character-estimate path, which labels the footer **Estimated** and keeps the prompt/completion/total relationship exact. A complete, consistent triplet, including legitimately reported zeros, remains **Provider**. The Web loop result gained `maxToolCalls`, holding the limit the coordinator actually enforced: `DeepSeekWebSearchCoordinator` returns `options.maxToolCalls` with the terminal result, `ChatStreamResult` carries it through the read-only coordinator (and `0` for a Web Off request), and `chat-view.ts` renders the skipped-call warning from that snapshot instead of re-reading `settings.maxWebToolCalls` (M19). The sentence shape is unchanged (`Web retrieval reached the <limit>-call limit. <N> proposed call was/were skipped; the answer may be incomplete.`), so a settings change made while the request was in flight can no longer misreport the limit that produced the skips.
5. **D5 — forced text-less tool-only rounds are classified by their caller.** `AiProviderRequest` gained `allowToolOnlyResponse?: boolean`. When it is true, a response that carries tool calls and no text or reasoning returns normally instead of throwing `No text was found in the provider response.`; the ordinary throw is unchanged for every other request, including an undeclared tool-only response (M20). The two forced rounds set it because neither declares tools: the DeepSeek loop's single terminal no-tools round (set only when the call limit forced it) and the reader's forced no-tools JSON answer. The callers keep their own classifications, so a text-less tool-only forced round now surfaces as `The model returned tool calls after the web call limit was reached.` and as the reader's `limit` failure kind, instead of being converted into a generic missing-text provider failure that lost the limit meaning and, for the reader, changed `failureKind` from `limit` to `provider`.
6. **D6 — displayed settings values are canonical.** The **Context character limit** and **Web tool call limit** inputs still clamp through `normalizeContextLimit` / `normalizeWebToolCallLimit` on input (M13). They now also rewrite the canonical stored value back into the field on the input `change` event, matching the existing capacity-pair commit behavior: a below-minimum entry displays `1000`, and a cleared call-limit field displays `8`. No new setting, validation rule, or save is added; the write-back saves nothing and only reflects what normalization already persisted, so typing is untouched until the field commits.

`AGENTS.md` records the consistent-triplet rule in the provider-stream, token-usage, Providers and settings, and DeepSeek online search (item 7) text; the enforced-limit snapshot in the web-search, deepseek-web, and request-coordinator rows and the skipped-call warning sentence (item 4); `allowToolOnlyResponse` in the provider-stream, deepseek-web, and web-extraction-reader rows; and the canonical settings display in the Providers and settings paragraph.

### Second-pass regression evidence

New tests (+7; base `40c264e` was 53 files / 1,849 tests):

- `tests/token-usage.test.ts`: `falls back to an estimate when the provider usage triplet is inconsistent` (both resolvers).
- `tests/provider-stream.test.ts`: the existing `ignores %s usage` table gained an `inconsistent` row.
- `tests/chat-view.test.ts`: `reports the enforced call limit in the skipped-call warning`; three existing Web fixtures gained a `maxToolCalls` snapshot while their asserted copy stayed byte-identical.
- `tests/deepseek-web.test.ts`: `classifies a text-less tool-only forced round as a limit failure` (real transport over scripted SSE).
- `tests/web-extraction-reader.test.ts`: the existing forced-round test now also asserts `allowToolOnlyResponse === true` on the forced request and absent on an ordinary extractor round.
- `tests/settings.test.ts`: `shows the normalized value after clamping a below-minimum context input`, `restores the default in the call-limit field after clearing it`.

RED before each fix:

```text
FAIL tests/token-usage.test.ts > resolveTokenUsage > falls back to an estimate when the provider usage triplet is inconsistent
- { completionTokens: 3, promptTokens: 47, source: 'estimated', totalTokens: 50 }
+ { completionTokens: 5, promptTokens: 12, source: 'provider', totalTokens: 20 }
  (the new provider-stream `inconsistent` table row emitted the triplet instead of no usage event)

FAIL tests/chat-view.test.ts > EmendChatView web research > reports the enforced call limit in the skipped-call warning
- Web retrieval reached the 20-call limit. 2 proposed calls were skipped; the answer may be incomplete.
+ Web retrieval reached the 8-call limit. 2 proposed calls were skipped; the answer may be incomplete.

FAIL tests/provider-stream.test.ts > requestAiResponse > returns a text-less tool-only forced round to the caller
Error: No text was found in the provider response.

FAIL tests/deepseek-web.test.ts > DeepSeekWebSearchCoordinator > classifies a text-less tool-only forced round as a limit failure
Expected: "The model returned tool calls after the web call limit was reached."
Received: "No text was found in the provider response."

FAIL tests/web-extraction-reader.test.ts > WebExtractionReader > forces one final no-tools extraction request at the reader round limit
AssertionError: expected undefined to be true   (forced.allowToolOnlyResponse)

FAIL tests/settings.test.ts > EmendSettingTab canonical input values > shows the normalized value after clamping a below-minimum context input
AssertionError: expected '999' to be '1000'
FAIL tests/settings.test.ts > EmendSettingTab canonical input values > restores the default in the call-limit field after clearing it
AssertionError: expected '' to be '8'
```

The D5 deepseek-web test drives the real `requestAiResponse` over scripted SSE rounds (one over-limit batch, then a text-less tool-only forced round), so it fails on the transport throw rather than on a mocked coordinator result; the unit-level `returns a text-less tool-only forced round to the caller` covers the flagged return directly, and the existing undeclared-tool-only test still asserts the unflagged throw.

### Second-pass local gate

At code head `5a2a19d`, with `main.js` rebuilt from that tree and SHA-256 `18088f53f52afb820a8b94bfb30573300f0e151271d466558fe42645916922fb`:

```text
npm test        53 files / 1,856 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

Base `40c264e` was 53 files / 1,849 tests, so the second pass adds 7. `main.js` is gitignored and was not committed; the docs commit changes the esbuild build identity, so a rebuild at the docs head will not reproduce the hash above.

### Second-pass commits

| Task | Commit | Message |
| --- | --- | --- |
| D4 | `9383b9d` | `fix: validate usage triplets and report enforced limits` |
| D5 | `cb401ea` | `fix: classify forced tool-only rounds at the caller` |
| D6 | `5a2a19d` | `fix: display canonical settings values` |
| Docs | this docs commit | `docs: record provider and usage stabilization` |

### Second-pass limits

- Unit- and source-verified only, like D1–D3. No real Obsidian, loopback SSE/Search/Fetch harness, or real provider was run in this pass; the PR E exploratory matrix owns the live runs, and no macOS, Windows, provider, or assistive-technology claim is made.
- The usage-triplet rule is a consistency check, not an accounting reconciliation. A provider that reports a consistent but wrong triplet is still trusted, and no tokenizer, pricing, or provider metadata is consulted.
- The enforced-limit snapshot is per submission. A Web Off request reports `0`, and the warning is unreachable without skipped calls, so no ordinary chat copy changed.
- The canonical write-back happens on `change` (blur/commit), not while typing, so a partially typed number is never rewritten mid-edit; the input keeps whatever the user typed until the field commits, then shows the stored value.
- D5 changes classification only. A provider that answers a forced round with tool calls still fails without retrieval; nothing is executed, retried, or written, and the reader still treats that outcome as its `limit` failure.

### PR D review round

Six review findings closed on the same branch, code commit `829d638`:

1. **Persisted inconsistent usage is dropped at load.** `normalizeLoadedMessage` now removes a stored usage triplet whose `totalTokens` is not `promptTokens + completionTokens`, so a reloaded thread shows no usage footer instead of a **Provider** footer built from impossible numbers. The message itself is still a valid ready message: `validateChatConversation` keeps it and reports `droppedMessages: 0`. The rule reuses `isConsistentTokenUsage`, which now lives in `token-usage.ts` and is imported by `provider-stream.ts`, so the transport, the resolvers, and the conversation schema share one predicate. A consistent triplet still normalizes a missing source to `provider`, and an explicitly `estimated` one is left alone.
2. **The tool-client credential guard is non-retryable and self-contained.** `requestDeepSeekTool` performs its local configuration guards (missing key, invalid/non-HTTP base URL, credential-bearing base URL) before any `fetch` and now throws `DeepSeekConfigurationError`. `attempt` classifies that error as `{ ok: false, reason: 'configuration', retryable: false }`, so a credential-bearing base URL costs exactly one attempt, is never retried, and is no longer reported as `network`. The message still never includes the URL. `WebFailureReason` gained the `configuration` reason and the activity label map renders it as `Search · Failed (configuration) · …`, keeping a local configuration problem distinct from a schema-drift `format` failure; no request leaves the machine and the failure payload carries no message or credential. The same guard covers the missing-key and invalid-URL cases, which previously were also retried once as transport failures.
3. **Duplicate search hits fill only empty fields.** `buildSearchExtractionDocuments` keeps the first hit's position, temporary ID, and nonempty fields, and fills an empty `title`, `snippet`, `summary`, or `content` from later hits for the same normalized URL before building the canonical document. A first hit with no content and a later hit with content now yields one document carrying the content instead of one document whose `Content:` line is empty.
4. **The canonical write-back only runs when it changes the field.** Both settings inputs compare the live field value with the stored canonical string and call `setValue` only when they differ, matching `commitCapacity`. Pressing Enter on an unchanged or already-canonical value no longer rewrites the field, so the caret and selection stay where the user left them.
5. **The reader's correction round is flagged too.** `allowToolOnlyResponse` is now set on the one format-correction request as well as the forced limit round, so a text-less tool-only correction reply reaches `ReaderFailure('format', 'The web extraction correction reply must be bare JSON without tool calls.')` instead of the transport's generic `No text was found in the provider response.` failure.
6. **The enforced limit is asserted at the boundary.** The 21st-call test now asserts `result.maxToolCalls === 20` alongside the existing skip, activity, and payload checks, pinning the D4 snapshot to the over-limit path.

RED before the fixes:

```text
FAIL tests/chat-sessions.test.ts > shared message serialization > loads a stored inconsistent usage triplet without a Provider footer
AssertionError: expected { promptTokens: 10, …(3) } to be undefined

FAIL tests/deepseek-web.test.ts > DeepSeek web transport retry and search degradation > does not retry a credential-bearing base URL and reports it as non-network
  (later consolidated into the parametrized `reports $reason as a non-retryable failure with one attempt`)
- { attempts: 1, failureReason: 'format', status: 'failed', … }
+ { attempts: 2, failureReason: 'network', status: 'failed', … }

FAIL tests/web-extraction.test.ts > canonical extraction documents > fills only empty fields from a later duplicate hit
AssertionError: expected [ { sourceId: 'R1', …(3) } ] to deeply equal [ { sourceId: 'R1', …(4) } ]

FAIL tests/settings.test.ts > EmendSettingTab canonical input values > does not rewrite an already-canonical Context character limit value on change
AssertionError: expected "setValue" to not be called at all, but actually been called 1 times
FAIL tests/settings.test.ts > EmendSettingTab canonical input values > does not rewrite an already-canonical Web tool call limit value on change
AssertionError: expected "setValue" to not be called at all, but actually been called 1 times

FAIL tests/web-extraction-reader.test.ts > WebExtractionReader extraction and verification > runs one correction request for unparseable terminal output
AssertionError: expected undefined to be true   (correction.allowToolOnlyResponse)
```

The D4 `maxToolCalls` assertion passed on the existing implementation; it was added to prevent regression rather than to drive a fix.

### PR D review-round gate

At code head `829d638`, with `main.js` rebuilt from that tree and SHA-256 `a65791f113cff88c60360b1f8145e9182b5cbe8ce3f7c318189613c1e4554227`:

```text
npm test        53 files / 1,861 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

`d0a6a89` was 53 files / 1,856 tests, so the review round adds 5 (chat-sessions 1, web-extraction 1, deepseek-web 1, settings 2); the reader and boundary assertions were added to existing tests. `main.js` is gitignored and was not committed; the docs commit changes the build identity, so a rebuild at the docs head will not reproduce the hash above.

### PR D review-round commits

| Task | Commit | Message |
| --- | --- | --- |
| Review fixes | `829d638` | `fix: close PR D review findings` |
| Review follow-up | `651eb06` | `fix: separate configuration failures from format` |
| Review docs | this docs commit | `docs: record PR D review round` |

### PR D review-round limits

- Unit- and source-verified only; no real Obsidian, loopback harness, or real provider run. The PR E matrix still owns live verification of the settings blur behavior, the reader correction path, and the credential-URL rejection.
- **Gateways and providers whose `total_tokens` includes cached prompt tokens now show Estimated.** A provider that reports `total = prompt + completion + cached` (or otherwise counts cache reads inside the total) produces a triplet that fails the `total === prompt + completion` check, so its footer is labeled **Estimated** even though the numbers are genuine provider data, and a stored thread carrying such a triplet loads with no usage footer. This is the deliberate cost of a provider-agnostic consistency rule: Emend has no provider metadata or tokenizer to separate cached tokens, and showing an inconsistent Provider total would be worse. Self-consistent but wrong triplets are still trusted as Provider.
- **Configuration failures have their own reason and label.** A missing key, an invalid base URL, or a credential-bearing base URL renders `Failed (configuration)` with `attempts: 1` and a `reason: "configuration"` payload, while a schema-drift or non-JSON 200 response stays `Failed (format)`. Both are non-retryable, neither makes a request for the configuration case, no credential or URL is echoed, and the Search still degrades non-fatally. The reason remains transient: only the activity outcome is persisted.
- **Duplicate merging is fill-only and first-wins.** A later duplicate with a richer nonempty summary or content does not replace an already nonempty field; only empty fields are filled, so citation order and temporary IDs remain the first hit's.
- **The write-back guard reads the live field, not a draft.** `text.inputEl.value` is compared with the stored canonical string, so a value that already matches is never rewritten; a differing value is still replaced on `change` as before.

### PR D review follow-up — configuration reason

The review round initially folded the local configuration guards into the `format` reason. The follow-up (`651eb06`) keeps all retry and transport behavior identical and only makes the copy honest: `WebFailureReason` gained `'configuration'`, `attempt` maps `DeepSeekConfigurationError` to `{ reason: 'configuration', retryable: false }`, and the chat activity label map renders `Search · Failed (configuration) · …`. `DeepSeekResponseFormatError` is still `{ reason: 'format', retryable: false }`, so a schema-drift or non-JSON 200 payload keeps `Failed (format)`.

Test coverage was consolidated into one parametrized test, `reports $reason as a non-retryable failure with one attempt`, with a `configuration` case (credential-bearing base URL: one attempt, no `fetch`, `{"error":{"kind":"search_failed","reason":"configuration","attempts":1}}`) and a `format` case (malformed search payload: one attempt, `reason: "format"`). The chat-view activity-label table gained a `configuration` row asserting `Search · Failed (configuration) · unconfigured provider`. The earlier RED was `+ "failureReason": "format"` against the expected `"configuration"`.

At code head `651eb06`, with `main.js` rebuilt from that tree and SHA-256 `9c328527569f932150f2ab96cc1addf1f3df5181747673e03e8e54c7c724e968`:

```text
npm test        53 files / 1,863 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

The review round was 1,861 tests, so the follow-up adds 2 (the parametrized configuration case and the activity-label row). Retry policy, transport-error classification, Search/Fetch degradation, payload shape apart from the reason value, and every other behavior are unchanged.

## PR E — real-Obsidian matrix

### Environment

- Branch `chore/2.10-stabilization-evidence` at merge commit `f610a70` (PR F, `658ceb9`, merged into the branch over PR D `a285d98`). Production code was not touched in this pass; only this record and the ignored `test_vault/` harnesses changed.
- `npm run build` (`tsc -noEmit -skipLibCheck` plus the production esbuild step) at `f610a70` produced `main.js` with SHA-256 `48c9f4c925cb86e8caa9def153a0c19f9662a21cc20060e7642d1ba6d39ddca0`. Every harness copies that root bundle into its own vault and each run reports loaded-versus-root equality: the selection suite asserts it in `prepare()` and records `loadedBundleMatchedRoot: true`, and the Web evidence files record `bundle.equal` / `rootBundleMatches` as `true`. The build embeds `git rev-parse --short HEAD` as its build id, so a rebuild at a later commit produces a different hash even with identical source; the harnesses never rebuild, and every run below loaded this one file (the Web evidence's `buildLabel` is `f610a70`). The final selection re-run started at a docs-only commit on top of `f610a70` (identical production tree) and loaded the same bundle.
- The first matrix in this record ran on the pre-Round-3 tree (`a285d98`, bundle `e108c6ee…`, 54 scenarios / 781 assertions). Its harness repairs carried over unchanged to the final tree, no scenario regressed under PR F, and only the headline numbers and the two Round 3 scenarios below changed. The pre-Round-3 numbers are kept only as that baseline.
- Linux with isolated Xvfb displays and CDP ports per suite (`:101`/`19224` selection, `:99`/`19222` Web, `:100`/`19223` minimal edit), the extracted official Obsidian AppImage under `test_vault/emend-web-verify/tools/obsidian`, loopback OpenAI-compatible SSE mocks, and dummy SecretStorage credentials. Track Changes 2.3.0 is installed for the selection suite. No real account, key, provider, or external network was used, and no two harnesses ran concurrently.
- Obsidian version: the bundled app's `resources/obsidian.asar` and `resources/app.asar` package metadata both report **1.15.0**, which is the version exercised here, and the compact-ui probe reports the same. `app.appVersion` is unavailable in this renderer, so suites fall back to probes: the earlier transition evidence printed `1.15.1` from a cached `obsidian-1.15.1.asar` filename in the profile cache (a probe artifact), and on the final tree that fallback found no cached name and recorded `null`.

### Harness state and first run

The on-disk harnesses predate several shipped UI changes, so the first unmodified run of the selection/chat matrix reported **9 passed / 19 failed / 198 assertions**, the first unmodified Web draft run **0 passed / 5 failed**, and the first unmodified minimal-edit run **1 passed / 8 failed** — in every case on harness assumptions rather than product behavior. The applied edits, note bytes, rendered summaries, and capacity values in the captured screenshots and logs were correct throughout.

| Failure class | Scenarios affected | Cause |
| --- | --- | --- |
| Ready-body selector | 01, 02, 03, 07, 13, 14, 15, 17, 22, 23, 24, 26 | The harness read `.emend-chat-message-content` for ready bodies. Stage 48 replaces that seeded element with `emend-chat-message-markdown` after the asynchronous Markdown render, so the harness timed out or read `''` while the screenshot showed the correct summary. |
| Six-item Writing/Web menu | 00 (chat menu and popout menu) | Stage 49 added `Chat · Selection` and `Edit · Selection · Full note`; the current menu has eight items. |
| Retired Additional-notes modal picker | 06, 21 | Stage 45 replaced chat's modal picker with the Related notes explorer; the harness still waited for the modal input. |
| Deferred capacity summary announcement | 19, 20, 21, 25 | PR C defers the summary live-region text by 500 ms for typing renders while the bar and ARIA values stay immediate. First-match reads compared a mid-flight estimate with the settled one (a consistent `+6` tokens) and produced mismatched notice/estimate pairs. |
| Document Escape expectation | 18 | The assertion still required `defaultPrevented` on the document fallback; PR C made that fallback close the pinned panel *without* swallowing the host shortcut. |

Scenarios share one Obsidian session, so a scenario that aborts on a stale assumption leaves state for the next one. The second run was stopped after scenario 00 hit the stale popout item count, because the following scenarios then failed on the left-open popout rather than on their own subject; it is not counted.

Repairs were limited to the ignored harnesses (`test_vault/emend-selection-chat-verify/`, `test_vault/emend-web-verify/`, and `test_vault/emend-minimal-edit-verify/`): ready-body reads now accept `.emend-chat-message-markdown`, the menu expectations list the eight current items, scenarios 06 and 21 drive the Related notes explorer, the four capacity scenarios read a settled summary (stable for 700 ms), the document-Escape assertion now requires dismissal *without* `preventDefault`, the Web probes accept both the streaming and rendered content containers, and the minimal-edit suite drives the current mode menu and accessible Send/Stop labels, recognizes the current correction instruction, and flattens schema-3 sessions in its persistence audit. Three full selection runs were counted on the pre-Round-3 tree: the stale baseline, a middle run that still carried the two capacity-timing defects and the Escape expectation (23 passed / 5 failed, 477 assertions), and the green run. After the middle run the four Web suites were still unadapted; their first Web draft run failed on the same ready-body selector and passed after the probe repair. On the final tree the same adapted harnesses ran unchanged except for one helper: the selection suite's `threadState` now reproduces the store's readable-name sanitizer (`Renamed Round Three.md` → `Renamed-Round-Three-<hash>.json`), which the rename scenario needs.

### Suite results

All numbers below come from runs that loaded the bundle built at `f610a70` (`48c9f4c9…`).

| Suite | Command | Scenarios | Assertions |
| --- | --- | --- | --- |
| Selection/chat matrix | `node test_vault/emend-selection-chat-verify/verify.mjs` | 28 passed, 0 failed | 589 |
| Focused stabilization scenarios | `node test_vault/emend-selection-chat-verify/verify.mjs --stabilization` | 6 passed, 0 failed | 55 |
| Web draft streaming | `node test_vault/emend-web-verify/verify.mjs --web-draft` | 5 passed, 0 failed | 57 |
| Web response transition | `node test_vault/emend-web-verify/verify.mjs --web-transition` | 7 passed, 0 failed | 40 |
| Compact composer 240 px | `node test_vault/emend-web-verify/verify.mjs --compact-ui` | 1 passed, 0 failed | 4 |
| Minimal-edit matrix | `node test_vault/emend-minimal-edit-verify/verify.mjs` | 9 passed, 0 failed | 54 |

Across the six suites: **56 scenarios / 799 assertions**, all green on bundle `48c9f4c9…`.

The minimal-edit suite is a Stage 37-era harness, so its first unmodified run passed 1 of 9 scenarios: it drives the retired `.emend-chat-mode-button` controls and text-labelled Send/Stop buttons, reads ready bodies from `.emend-chat-message-content`, detects the correction round by the pre-Stage-41 prompt sentence, and asserts schema-2 persistence. Test-only repairs brought it to 9/9 on the same bundle without changing production code: the Writing/Web menu replaces the retired mode buttons, Send/Stop are driven by accessible label, ready-body reads accept `emend-chat-message-markdown`, the mock recognizes the current `Return only a new complete JSON array of operations, or an envelope object …` correction instruction (and the assertion now expects that instruction), and the persistence audit flattens schema-3 sessions. With those in place the suite again confirms the invalid-to-valid full-note correction with all-round usage and successful-attempt reasoning (`01`, 11 assertions), broad-replacement minimization with two Track Changes cards (`07`, 6), the typed ambiguity diagnostic and terminal second candidate (`02`, 4), provider-failure and stale-source terminals after a correction (`04`, `05`, 3 each), Stop/retry (`03`, 3), native selection undo (`08`, 5), the modal's invalid-to-valid correction (`06`, 4), and sanitized schema-3 persistence of concise Edit results with all-round usage (`09`, 15). Assertion text inside the suite is still Stage 37-era copy; it was updated only where the current product intentionally changed the wording.

The on-disk selection harness exposes 28 scenarios (00–27). It does not contain the Stage 47–49 modes (`--selection-highlight`, `--selection-focus`, `--stale-only`, `--picker-regressions`) or those stages' appended scenarios 28–37, so today's 589 assertions are not comparable to the 724 recorded in Stages 49–50, and the live-selection highlight, stale-source-only, and picker-regression matrices were not re-run in this pass.

### Stabilization scenarios (`--stabilization`)

Added to the existing selection harness and mock without renumbering historical evidence. H1–M1 target the Round 1/2 fixes and re-passed unchanged on the final tree; F1–F2 are the Round 3 additions.

- **H1 `01-selection-edit-inside-existing-token`** (12 assertions). The note holds `Keep {++inner text++} tail.`; the mock answers with a replace of `inner text`, which would compile to nested markup. Both rounds were rejected — the chat error and the Notice both read `Compiled operations produce invalid CriticMarkup in the complete note. Preserve existing CriticMarkup tokens and do not nest markup.`, exactly two provider requests (one same-provider correction) were made, `vault.modify` and `editor.replaceRange` were never called, and the note bytes were unchanged. A later edit whose selection enclosed the whole pending token (targeting `tail.`) then succeeded: bytes became `Keep {++inner text++} {~~tail~>trailer~~}.`, the existing insertion token survived byte-for-byte, one native replacement was recorded, and native undo/redo restored the original and annotated text.
- **H2 `02-typing-during-full-note-request`** (6 assertions). With a held full-note Edit streaming, the harness typed `USER_TYPED_DURING_REQUEST ` into the live editor and released the response. The disk file still equalled the captured source at that moment (recorded as `refusalWasEditorOnly: true`), so the refusal came from the live-editor freshness check added in PR A. The result was the exact `The note changed while Emend was responding. No edits were applied.` error, every keystroke survived in the editor, no `{~~` markup reached the editor or the file, the plugin writer never called `vault.modify`, and exactly one provider request was made.
- **H3 `03-unbalanced-fence-payload`** (9 assertions). The mock inserted a payload containing an unclosed fence. Both rounds were rejected with `Operation 1 payload introduces unbalanced fenced code or backtick runs at line 4; keep every fence and backtick run paired inside the operation payload. No edits were applied.`, two provider requests were made (one correction), no `vault.modify` reached the note, and the bytes were unchanged. A later ordinary replacement on the next line applied once through the guarded writer: `Second line {~~beta~>gamma~~}.`, with no fence left in the note.
- **M1 `04-reasoning-panel-across-deltas`** (10 assertions). A Web Off answer streamed part of its reasoning, held, then finished the reasoning and the answer. While the panel was open and scrolled, further reasoning and answer deltas updated the same content element in place (`sameNode: true`), the panel stayed open, the scroll offset was unchanged (`scrollTop` 15 of a 63 px scroll range), and both texts kept growing (477 reasoning characters, 126 answer characters). The completed message kept all reasoning and the terminal answer, made exactly one provider request, advertised no Web tools, and the final ready body rendered its reasoning closed as usual.
- **F1 `05-multi-pane-freshness`** (10 assertions). A full-note Edit was submitted and held; the harness typed `USER_MULTI_PANE_TYPING ` into the target pane and then opened the same note in a second pane in its own window, returning focus to the target. Two panes showed the note (`panes: 2`), the disk file still equalled the captured source when the response was released (`diskStillCapturedAtRelease: true`), and the response was rejected with the exact stale error — so the refusal came from the open editors, not from the disk byte check. The typed text survived in the panes, no `{~~` markup reached either pane or the file, the plugin writer never called `vault.modify`, and the held request made exactly one provider call. Observed divergence: Obsidian mirrored the target's unsaved text into the sibling window (`siblingHeldCaptureAtApply: false`), so the *dirty-target-plus-clean-sibling* masking shape that PR F's unit test pins was not reproducible live; see Limits.
- **F2 `06-rename-repoints-chat`** (8 assertions). With `Include note path` enabled, the active note `Rename.md` was renamed to `Renamed Round Three.md` through `app.fileManager.renameFile` while chat was open. The chat context and the view's `notePath` followed the new path without a reload, the next submission made exactly one provider request whose prompt carried `Active note path:` and `vault/Renamed Round Three.md` (and not the old path), the answer arrived ready (`RENAME_READY`) with no `The active note changed` rejection, and the aggregate persisted under `Renamed-Round-Three-<hash>.json` with the user message's `sourcePath` set to the new path and no `RENAME_READY` under the old path's aggregate. The note was renamed back and the path setting restored afterwards.

Screenshots inspected: `01-selection-edit-inside-existing-token.png` (Notice banner, preserved `{++inner text++}`, new substitution, applied Selection summary), `02-typing-during-full-note-request.png` (stale error in chat and Notice), `03-unbalanced-fence-payload.png` (payload rejection Notice and the applied follow-up), `04-reasoning-panel-across-deltas.png` (terminal answer after the panel checks), `05-multi-pane-freshness.png` (post-rejection single pane with the typed text restored and the stale error), `prF-multi-pane-before-release.png` (both panes and the second window showing the same typed text), `06-rename-repoints-chat.png` and `prF-rename-before-submit.png` (tab and chat context on `Renamed Round Three.md` with a fresh thread), `web-draft-auto-streaming.png` (muted `Draft answer — research may continue` label over live draft text plus a completed answer with `Sources (1)`), `web-transition-auto.png` (rendered Markdown answer with table and list), and `compact-ui-240.png` (Web/model/Send controls visible without horizontal overflow at 240 px).

### Limits

- Linux on Xvfb with loopback mocks only. macOS, Windows, physical keyboards, screen readers, other Obsidian versions, and real provider accounts were not exercised, and no pixel comparison was made.
- `app.appVersion` is unavailable in this renderer, so the Obsidian version comes from bundled package metadata (1.15.0); the cache-name fallback is unreliable (1.15.1 on the earlier tree, `null` on the final tree), as described above.
- H1's successful follow-up covers an edit whose *selection* encloses the whole pending token; editing strictly inside an existing tracked change remains rejected by design, and its notice is still the generic `compiled-markup-rejected` copy (deferral item 13, [#88](https://github.com/chliu1990/obsidian-emend/issues/88)).
- M1 injects a harness-only `max-height`/`overflow-y` rule on `.emend-chat-reasoning-content`, because the shipped stylesheet does not make that container scrollable at the Xvfb viewport. The injected rule changes presentation only; the streaming update path, element identity, `open` state, and scroll preservation are the product code under test.
- H2 observes a single timing sample: the disk file still matched the captured source when the response was released. On a slower run the autosave could land first, in which case either freshness check would reject identically; the harness records the observed value in its evidence.
- The selection suite exercises one 1440×1000 Xvfb screen with the default theme; 240 px behavior is covered by the dedicated layout scenarios rather than by every new scenario.
- F1's live scenario does not reproduce PR F's exact masking shape. Obsidian keeps every pane and window of the same file on the same live editor text, so a dirty target cannot coexist with a clean sibling while a request is in flight; the scenario instead pins the reachable live behavior (two panes, editor-driven stale rejection with the disk still unchanged, keystrokes preserved, no write). The dirty-target/clean-sibling case stays unit-verified in `tests/note-writer.test.ts` and `tests/main.test.ts`.
- F2 re-points the view but, by design, does not migrate history: after the rename the chat starts a fresh thread for the new path and the old aggregate stays under the old path's hash. The scenario renames the note back at the end; no note-rename history migration is claimed.
- The minimal-edit suite was adapted in the ignored harness only (menus, accessible labels, ready-body selector, correction-instruction wording, schema-3 audit); its assertions still come from the Stage 37 record and were not expanded with Stage 51 coverage. Its evidence file does not recompute a bundle hash: like the other suites it copies the root `main.js` shown above into its vault during `prepare()`, and no separate bundle was built for it.

The final tree that produced these runs also passes the local gates: `npm test` **53 files / 1,877 tests**, `npm run lint` clean, `git diff --check` clean, and the bundle hash above.

## PR F — Round 3 cross-cutting fixes

Branch `fix/2.10-concurrency`, based at `a285d98` (53 files / 1,863 tests). The first pass ships F1–F3; a second pass owns F4–F8. Every task followed the same discipline: focused failing test, captured RED, smallest fix, GREEN, one commit with the brief's message.

### Findings and fixes

1. **F1 (High, write safety) — the editor reader failed open.** `NoteWriter.readEditorText(file)` returned exactly one string. `main.ts` built it by taking the maintained target view's text as a reference and then returning the first *other* open pane whose text differed from that reference. When the target pane itself was the dirty one and a second pane still held the captured source, the differing entry was the clean one, so `applyPreparedEdit` compared the clean text against the snapshot, passed, and `vault.modify` overwrote the unsaved typing in the target pane. The reader contract is now `readEditorTexts(file): readonly string[] | undefined`, and the writer requires **every** returned entry to equal `snapshot.sourceText`; `undefined` or an empty result still means no open editor and keeps the disk-only path. `main.ts` collects the target view's text plus every open Markdown view whose `file` is the captured file, without a new vault read. A dirty pane can no longer be masked by a clean sibling, and the guard is strictly wider than before: no write path was relaxed.
2. **F2 (High, common path) — a rename stranded every chat view.** The vault `rename` handler updated only the additional-notes store. The chat view kept its old `notePath`, so `captureChatContext()` returned the renamed file's new path, `sourcePath !== notePath` failed, and every submission was rejected with `The active note changed before the request started.` until the user switched notes. The handler now calls the same `refreshChatTargetNotes()` callback that `active-leaf-change` and `file-open` already use, after the store update, so every open `EmendChatView` re-points at the new path (and reloads that path's aggregate) in one place. `refreshTargetNote` still early-returns for views whose active note did not change, so an unrelated rename only refreshes their edit-target control and draft estimate. Conversation aggregates are still not migrated across a rename, per the existing deferred item.
3. **F3 (High, record loss) — an applied edit's result was buried behind a save error.** When another chat view deleted the session during an in-flight request, `appendReadyMessage` rejected with `Chat session does not exist.` The note write had already happened, yet the message was marked `error` and the only explanation was `Emend: Could not save this chat. Chat session does not exist.` `conversation-store.ts` now exports `isMissingSessionSaveError`, and `chat-view.ts` checks it for an already-applied edit whose final save was attempted: the concise applied summary stays in the message as ready content and one distinct `Emend: Edit applied, but this chat could not be saved.` Notice is shown. The save is attempted exactly once — no re-append, no second write, and the pending lock is still released in `finally`.

### Regression evidence

New tests (+7; base `a285d98` was 53 files / 1,863 tests):

- `tests/note-writer.test.ts`: `rejects an edit when the target pane is dirty and another pane matches the snapshot`, `rejects an edit when any open pane differs from the captured source`, `applies when every open editor matches the captured source`; the existing differing-text, both-match, and disk-only cases now drive `readEditorTexts`.
- `tests/main.test.ts`: `rejects an edit when the target pane is dirty and another pane matches the snapshot` (plugin wiring), `rejects an edit when any open pane differs from the captured source`, `refreshes open chat views when the active note is renamed`.
- `tests/chat-view.test.ts`: `keeps an applied edit summary when its session was deleted during the request`.

RED before each fix:

```text
# F1 — writer contract
FAIL tests/note-writer.test.ts > applyPreparedEdit > rejects an edit when the target pane is dirty and another pane matches the snapshot
  (the edit resolved and wrote the annotated note instead of rejecting)
FAIL tests/note-writer.test.ts > applyPreparedEdit > rejects an edit when the open editor text differs from the captured source
AssertionError: expected "vi.fn()" to be called exactly once, but got 0 times   (readEditorTexts)
Tests  5 failed | 13 passed (18)

# F1 — plugin wiring, reproduced by restoring the old reference-and-find-differing reader
FAIL tests/main.test.ts > EmendPlugin edit freshness > rejects an edit when the target pane is dirty and another pane matches the snapshot
  (the edit applied and vault.modify ran instead of rejecting)

# F2
FAIL tests/main.test.ts > EmendPlugin note rename refresh > refreshes open chat views when the active note is renamed
Error: Condition did not become true.   (the view's notePath never left Old.md)

# F3
FAIL tests/chat-view.test.ts > EmendChatView committed edit persistence > keeps an applied edit summary when its session was deleted during the request
- "Emend: Edit applied, but this chat could not be saved.",
+ "Emend: Could not save this chat. Chat session does not exist.",
```

Every focused suite and the full gate are green at the final code head.

### Commits

| Task | Commit | Message |
| --- | --- | --- |
| F1 | `a602803` | `fix: require every open editor to match the captured source` |
| F2 | `48fca85` | `fix: refresh chat state when a note is renamed` |
| F3 | `06895a2` | `fix: keep applied results when the session disappears` |

### Local gate

At code head `06895a2`, with `main.js` rebuilt from that tree and SHA-256 `71ffa80e20bba0da91d37a1dd15857bcaeb0f06eef11c84b3d59d9666f4ffed7`:

```text
npm test        53 files / 1,870 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

The docs commit changes the esbuild build identity, so a rebuild at the docs head will not reproduce the hash above.

### Limits

- Everything here is unit- and source-verified. No real-Obsidian run confirms multi-pane staleness rejection, the rename re-point in a live workspace, or the deleted-session Notice; the PR E exploratory matrix owns those runs, and no macOS, Windows, real-provider, or assistive-technology claim is made.
- F1 widens freshness only. A pane that is *clean* still passes, the disk read and one `vault.modify` are unchanged, and no new vault read is added — the reader reuses the already-open editors' text.
- F2 re-points a view but does not migrate the aggregate: after a rename the chat starts a fresh thread for the new path while the old aggregate stays under the old path's hash. Note-rename history migration remains deferred.
- F3 covers the missing-session rejection for an applied edit only. The other save failures are F4 in the second pass, which extends this branch instead of replacing it.

### Second pass — F4–F8

The second pass closes the remaining Round 3 findings on the same branch, with the same failing-test-first discipline. Base for the pass: `24dc9ed` (53 files / 1,870 tests).

### Fixes

4. **F4 (Medium) — a failed save was silent after Stop or a completed edit.** The aborted branch showed no save failure at all, and the error branch gated its Notice on `isActiveRequest`, so a save that rejected after Stop or a session transition lost its only explanation. The catch now classifies the failure once: `cancelled` means the thrown error is an abort, and `saveFailed` means the final save was attempted and the error was not a cancellation. A committed edit whose save fails keeps its concise applied summary as a ready message and shows either the distinct missing-session Notice (F3) or `Emend: Could not save this chat. <bounded reason>`; a non-committed save failure shows the same generic Notice in both the aborted and the error branch, and no longer depends on the originating request still being active. Provider errors keep their existing `isActiveRequest` gate, and `persistMessages` now rethrows an abort error instead of wrapping it as `Could not save this chat.`, so a deliberate Stop at save time is a cancellation rather than a reported failure. The pre-existing stale-save test changed name and expectation (`reports a stale final-save failure without touching the new session`) because the save failure is now always reported.
5. **F5 (Medium) — stale transients and an incomplete session list.** A note's cached runtime-only session was never discarded, so a later failed load resurrected never-persisted messages; and New-chat/rename materialization replaced `this.sessions` with just the materialized entry, hiding sessions another view had created. `refreshTargetNote` now discards that note's transient entry and ID whenever a successful load finds a persisted active session (an aggregate with no active session still reuses the cached transient and its draft, which is the existing transient-recovery behavior), and a tolerant `loadStoredSessions` helper re-reads the store after materialization in `createNewSession` and `renameActiveSession` so the ordered session list is adopted from disk, falling back to the single materialized entry when the store list is unreadable or lacks it.
6. **F6 (Medium) — later corruption overwrote the preserved original.** `writeConversation` wrote `<chat>.corrupt` unconditionally, so a second corruption event replaced the first preserved bytes. The backup is now written only when that file does not already exist; every later corruption keeps the first original, and the `.corrupt` path stays single. The existing reuse test became `keeps the first corrupt backup across later corruption events`.
7. **F7 (Low) — Web configuration errors were soft failures.** `attempt` classified `DeepSeekConfigurationError` as a non-retryable `configuration` failure, which turned a local missing-key, invalid-base-URL, or credential-bearing-base-URL guard into a soft `search_failed`/`fetch_failed` tool result. It is now rethrown as fatal, so the submission aborts with the guard's own message before any request, no Search/Fetch/reader work follows, and the model never receives a tool result that hides a misconfiguration. `WebFailureReason` and the activity label map drop the now-unreachable `configuration` member; the deepseek-web non-retryable table keeps only the `format` case and a dedicated fatal-configuration test covers the new behavior, and the chat-view label table drops its `configuration` row.
8. **F8 (Low) — a zero-result search looked complete.** A Search whose parse produced no usable result still ran a reader round and recorded a `completed` activity, so the answer silently had no evidence and no warning. `executeCall` now builds the extraction documents first and, when there are none, returns the existing `search_failed` failure with `reason: "empty"` and `attempts: 1` before any reader work or retry. The call therefore contributes to the existing `Emend could not complete N web search. The answer may be incomplete.` warning and renders `Failed (empty page)`, matching the empty-Fetch-page classification. The forced-answer fixture that used a zero-result search now asserts the reader is skipped and `failedSearches` is 1.

### Regression evidence

New tests (+5 net; base `24dc9ed` was 53 files / 1,870 tests):

- `tests/chat-view.test.ts`: `reports a failed save after a committed edit when Stop raced completion`; `does not resurrect a stale transient session after a successful load`; `shows sessions created by another view after materialization`; the stale-save test renamed to `reports a stale final-save failure without touching the new session`.
- `tests/conversation-store.test.ts`: `keeps the first corrupt backup across later corruption events` (was `reuses the single corrupt backup for later corruption`).
- `tests/deepseek-web.test.ts`: `aborts the web loop on a configuration error`; `reports a zero-result search as empty`; the non-retryable table collapsed to its `format` row; `allows a forced answer without evidence or invented citations` now asserts the reader is skipped and one search failed.
- `tests/chat-view.test.ts` activity-label table: the `configuration` row was removed with the failure reason.

RED before each fix:

```text
# F4
FAIL tests/chat-view.test.ts > EmendChatView committed edit persistence > reports a failed save after a committed edit when Stop raced completion
- [ "Emend: Could not save this chat. Disk is full." ]
+ []

# F5
FAIL tests/chat-view.test.ts > EmendChatView thread-load recovery > does not resurrect a stale transient session after a successful load
AssertionError: expected [ { id: 'never-saved', …(7) } ] to deeply equal []
FAIL tests/chat-view.test.ts > EmendChatView session management > shows sessions created by another view after materialization
AssertionError: expected [ …(2) ] to include 'other-view'

# F6
FAIL tests/conversation-store.test.ts > ConversationStore corruption recovery > keeps the first corrupt backup across later corruption events
AssertionError: expected 'second malformed' to be 'first malformed' // Object.is equality

# F7
FAIL tests/deepseek-web.test.ts > DeepSeekWebSearchCoordinator > aborts the web loop on a configuration error
AssertionError: promise resolved "{ …(10) }" instead of rejecting

# F8
FAIL tests/deepseek-web.test.ts > DeepSeekWebSearchCoordinator > reports a zero-result search as empty
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times   (reader.extract)
```

### Commits

| Task | Commit | Message |
| --- | --- | --- |
| F4 | `a92aa62` | `fix: report save failures after Stop` |
| F5 | `79a37ed` | `fix: discard stale transient sessions after a load` |
| F6 | `c7037cf` | `fix: preserve the first corrupt backup` |
| F7 | `af56e8b` | `fix: abort on web configuration errors` |
| F8 | `eec2f9f` | `fix: report zero-result searches as empty` |

### Second-pass gate

At code head `eec2f9f`, with `main.js` rebuilt from that tree and SHA-256 `98aae8d920698781c2be55c0c5779c52d559585cc8d0ca1122059e9bcb1f886a`:

```text
npm test        53 files / 1,873 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

Base `24dc9ed` was 53 files / 1,870 tests, so the finished round adds 3 net (F4 +1, F5 +2, F6 0, F7 −1 from collapsing the failure table and removing the label row plus +1 new test, F8 +1). The docs commit changes the esbuild build identity, so a rebuild at the docs head will not reproduce the hash above.

### Second-pass limits

- Unit- and source-verified only, like F1–F3. No real-Obsidian run confirms the Stop-race save Notice, the stale-transient discard in a live workspace, the adopted session list across two views, the preserved `.corrupt` bytes across two real corruption events, the fatal configuration abort, or the zero-result warning; the PR E matrix owns those runs.
- F4 reports every non-cancelled save rejection, including one whose originating session is no longer active. That is a deliberate change from the earlier suppression contract: a lost save is data loss, and the Notice is the only signal. A cancellation by Stop remains silent.
- F5 discards a cached transient only when the successful load finds a persisted active session. An aggregate with no active session keeps its cached transient (and its unsaved messages and draft) across note switches, which is the existing transient-recovery behavior and is unchanged.
- F6 keeps exactly one `.corrupt` file per chat and never overwrites it. A user who wants a newer snapshot must remove the old file; no rotation or timestamped variant is added.
- F7 removes the `configuration` failure reason from the type and the labels. It is unreachable after the change, and no persisted data carries it (failure reasons are transient), but any external consumer of the label map would no longer see that key.
- F8 classifies a zero-result search as a failure rather than an empty success and does not retry it. That avoids a second paid Search for a deterministic empty parse, and it means such a call now contributes to the search warning count instead of silently returning no evidence.

## PR F review round

Four findings closed on the same branch, code commit `5fbaef4` and docs commit below.

1. **Search attempt count was hard-coded.** A Search whose first attempt was retried and whose second attempt returned no usable result reported `attempts: 1`, contradicting the documented rule that `attempts` is 1 without a retry or 2 after it. `attemptWithRetry` now carries the attempt count on its success result too, and the zero-result `search_failed` outcome uses `outcome.attempts`, so the activity and the tool payload both report 2 for a retried-then-empty Search.
2. **A discarded transient left its draft behind.** `discardTransientSession` removed the cached transient session and its ID but not the `{notePath, sessionId}` draft entry, so a later render could restore text into a session that no longer exists. It now also deletes that transient ID's draft entry.
3. **Unrelated-rename behavior was untested.** A rename of a different file runs `refreshTargetNote`, finds the active path unchanged, and takes the cheap same-path branch. A new test pins that it does not abort an in-flight request's signal, does not reload the conversation, and does not issue a second provider request, and that the answer still persists afterwards.
4. **Stop-cancelled saves were only implied.** A new test drives an `AbortError` rejection out of `appendReadyMessage` after Stop and asserts the assistant save is attempted exactly once, no save-failure Notice appears, the partial answer stays as stopped content, and the view leaves the sending state — pinning the F4 cancellation classification so a future re-wrap of abort errors cannot silently turn a deliberate Stop into a reported failure.

### Tests and gate

New tests (+4; base `27bfe19` was 53 files / 1,873 tests):

- `tests/deepseek-web.test.ts`: `reports a retried zero-result search with two attempts`.
- `tests/chat-view.test.ts`: `drops a discarded transient session draft with it`, `stays silent when Stop cancels the final save`.
- `tests/main.test.ts`: `leaves an in-flight request running when a different note is renamed`.

RED before the two code fixes:

```text
FAIL tests/deepseek-web.test.ts > DeepSeekWebSearchCoordinator > reports a retried zero-result search with two attempts
- "attempts": 2,
+ "attempts": 1,

FAIL tests/chat-view.test.ts > EmendChatView thread-load recovery > drops a discarded transient session draft with it
AssertionError: expected true to be false // Object.is equality
```

The two behavior tests (3 and 4) passed on the fixed code as guards rather than as fixes; both target classifications the review asked to pin.

At review code head `5fbaef4`, with `main.js` rebuilt from that tree and SHA-256 `f00e42e23ef64f0fd4ebb01b24ca40a66554b5219be49755e551c6916a0e1ddc`:

```text
npm test        53 files / 1,877 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit -skipLibCheck + esbuild production)
git diff --check clean
```

### Remaining limits

- The optional `readEditorTexts` reader stays optional: a writer without it (disk-only usage outside the composer path) skips the live-editor comparison entirely, which is the documented contract but leaves that seam unreachable in chat. No test or type change was made here.
- Popout and reading-mode behavior is still unverified: the reader iterates `workspace.iterateAllLeaves`, so a popout window's Markdown view is covered only if the host reports it through the same workspace; reading-mode (preview, no editor) panes expose no editor text and therefore contribute nothing to the comparison. Real-Obsidian confirmation remains with the PR E matrix, together with the rest of the round's live runs.

## Deferred Round 3/4 items

Every release blocker in this round is fixed and verified. The following items were deliberately deferred; each issue names its evidence (file paths/functions), risk, and reason for deferral. The same list appears in `ROADMAP.md` under **Deferred from the 2.10 stabilization round**.

1. **`chat-view.ts` decomposition ([#76](https://github.com/chliu1990/obsidian-emend/issues/76)).** The view interleaves six state machines (more than 2,300 lines), and `tests/chat-view.test.ts` reaches private prototypes and hand-built contexts, which is why H4/M1/M10/M12 stayed green.
2. **One edit-freshness model ([#77](https://github.com/chliu1990/obsidian-emend/issues/77)).** `note-writer.ts` checks disk bytes plus every open editor; `selection-editor.ts` checks only its captured editor. Unifying them must preserve the H2/F1 fail-closed checks.
3. **One edit-target representation ([#78](https://github.com/chliu1990/obsidian-emend/issues/78)).** `edit-target.ts` choices, `displayedEditTarget`, per-submission conversions, and the mutating `getTargetMarkdownView()` encode one target three ways.
4. **One Markdown structure scanner ([#79](https://github.com/chliu1990/obsidian-emend/issues/79)).** `selection-context.ts` and `markdown-edit-guards.ts` implement divergent fence/frontmatter/table scans; consolidation must keep the Stage 38 conservative boundaries.
5. **`provider-stream.ts` split ([#80](https://github.com/chliu1990/obsidian-emend/issues/80)).** Transport, SSE parsing, tool assembly, capacity guard, and caller-kind flags such as `allowToolOnlyResponse` share one module.
6. **`deepseek-web.ts` split ([#81](https://github.com/chliu1990/obsidian-emend/issues/81)).** Clients, retry policy, loop orchestration, citations, and cap fitting share one 762-line module.
7. **Related-notes panel positioning and refresh probes ([#82](https://github.com/chliu1990/obsidian-emend/issues/82)).** `positionPanel()` runs once with no resize/scroll tracking, and every open/Refresh scans vault metadata.
8. **Aggregate lifecycle on note rename and delete ([#83](https://github.com/chliu1990/obsidian-emend/issues/83)).** The vault handlers maintain only the additional-notes store; chat history is neither migrated on rename nor removed on delete.
9. **Instruction caching ([#84](https://github.com/chliu1990/obsidian-emend/issues/84)).** `loadAllInstructions` re-reads the root file and every skill per request, bounded only by the 20,000-character cap.
10. **`saveSettings` double updater invocation ([#85](https://github.com/chliu1990/obsidian-emend/issues/85)).** `main.ts` calls a function updater once to resolve the saved candidate and again to apply live values; safe only while updaters stay pure.
11. **Dead CSS for retired header controls ([#86](https://github.com/chliu1990/obsidian-emend/issues/86)).** `.emend-chat-edit-target` and `.emend-chat-web-mode` in `styles.css` have no source references.
12. **Public `chat-view` test surface ([#87](https://github.com/chliu1990/obsidian-emend/issues/87)).** Tests assert private prototypes instead of a public view contract, coupling refactors and hiding behavior regressions.
13. **Actionable in-token selection rejection ([#88](https://github.com/chliu1990/obsidian-emend/issues/88)).** A selection strictly inside a pending tracked change still gets the generic `compiled-markup-rejected` copy and spends the one correction round; both need a terminal, actionable replacement.
14. **Uniform capacity-summary announcement policy ([#89](https://github.com/chliu1990/obsidian-emend/issues/89)).** Chat announces synchronously; Modify Selection defers 500 ms. Choosing one policy needs a screen-reader session.
15. **Tool-client configuration contract ([#90](https://github.com/chliu1990/obsidian-emend/issues/90)).** `DeepSeekConfigurationError` is fatal in the tool client but effectively unreachable behind the chat transport guard; removing or redefining that path is a deliberate decision.
16. **Platform and provider verification gaps ([#91](https://github.com/chliu1990/obsidian-emend/issues/91)).** macOS, Windows, physical input, screen readers, popout edge cases, other Obsidian versions, and real providers remain unverified; all evidence is Linux/Xvfb with loopback mocks.

These issues do not approve behavior changes. Each needs its own focused PR with tests, review, and verification under the project's existing constraints.
