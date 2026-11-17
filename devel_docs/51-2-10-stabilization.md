# Stage 51: 2.10 bug hunt and stabilization

## Status

In progress on `fix/2.10-write-safety` and its follow-up PR branches. This record accumulates the confirmed findings, focused fixes, regression evidence, and remaining limits for the 2.10 bug-hunt round. Promotion remains blocked until every section below is complete and the final whole-branch review passes.

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

PRs B–E append their findings, fixes, RED→GREEN evidence, gates, and the final exploratory matrix below. Stage 51 is not complete until PR E records the whole-round gate and every deferral link.

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

Branch `fix/2.10-provider-correctness`, based at `5576d4e` (PR C merged, 53 files / 1,838 tests). The first pass ships D1–D3 below; D4–D6 are recorded by the second pass.

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
