# Stage 54: Public chat-view behavioral test seam

## Status and scope

Implemented on `feature/2.11-pr01-public-chat-view-tests` from clean `main` at `89babd6c516ab7b32d33bb9fe1b9ff93606de4e7`. The baseline was **53 test files / 1,877 tests**. The code head for the implementation and initial real-Obsidian evidence is `2b61bc0b4430ac336db814542af04cae2b669f54`.

This is a test-architecture PR, not a runtime behavior change. It adds a real-instance public test seam, migrates the scoped 18 private-prototype cases, and adds three real-view menu cases. It does not extract the PR 05 modification controller, decompose `chat-view.ts`, add test-only production state accessors, or change writers, persistence, providers, request serialization, edit targets, menus, styles, user-visible copy, version metadata, or release workflows.

The implementation commits are:

| Commit | Subject | Scope |
| --- | --- | --- |
| `ed9ee11` | `test: add public chat-view behavioral seam` | Public fixture, shared fake-DOM helpers, three visibility changes, and two failed-load migrations. |
| `c8606c9` | `test: migrate session behavior to public chat-view seam` | Five session/stream migrations. |
| `4f3d110` | `test: migrate modification behavior to public chat-view seam` | Five submission/persistence migrations. |
| `59d90c5` | `test: migrate streaming and scroll behavior to public seam` | Six rendering/scroll migrations. |
| `2b61bc0` | `test: cover dismissed chat controls through real view wiring` | Three net-new real-view menu cases. |
| `4f06439` | `test: strengthen public chat-view characterization` | Final-review assertion restoration without a test-count or production change. |

## Production seam and fixture boundary

The only retained production diff is three visibility modifiers in `src/chat-view.ts`; every method body is unchanged:

```ts
public async onOpen(): Promise<void>;
public async onClose(): Promise<void>;
public async submitPrompt(
	prompt?: string,
	options?: { fromQuickAction?: boolean },
): Promise<void>;
```

`onOpen` and `onClose` changed from `protected` to `public`; `submitPrompt` changed from `private` to `public`. No focused-control production source changed. No runtime behavior changed.

`tests/helpers/chat-view-public-fixture.ts` constructs a real `EmendChatView` with the existing `WorkspaceLeaf` mock and assigns the required host `contentEl`. Its host supplies workspace event registration, `vault.getName() === 'TestVault'`, an adapter read double, and a real mocked `Scope`. The fixture exposes shared `settings` and `AdditionalNotesStore` references, typed provider/conversation-store/context doubles, session helpers, deferred values, DOM queries, lifecycle/active-path helpers, animation-frame flushing, and cleanup. `tests/helpers/fake-element.ts` holds the shared fake DOM and controllable owner-window animation-frame queue. The minimal `ItemView.register`/`registerEvent` mock surface permits normal resource registration without emulating private view state.

Public tests drive lifecycle, submission, session, target, mode, and refresh methods and inspect rendered DOM, provider calls, store calls, and host menu boundaries. They do not use `EmendChatView.prototype`, `Object.setPrototypeOf`, `viewPrototype`, `productionSubmitPrompt`, `productionPersistMessages`, private view fields, or hand-built private contexts.

## Exact migration inventory

The following 18 public cases replace their named legacy equivalents. Names below are the final public names; old names are noted where the public replacement was clarified.

1. `recovers a usable transient session when the thread load fails`
2. `shows New chat as usable after a failed thread load`
3. `applies only the latest note load during rapid note switches`
4. `does not apply a pending load after the view closes`
5. `restores active session drafts, policies, Related notes, capacity, and origin history through the public view` (formerly `restores the active session and keeps drafts, controls, history, and capacity session-scoped`)
6. `isolates stale stream callbacks and finally cleanup from a newer request after A → B → A` (formerly `…after A1 → A2 → B → A1`)
7. `refuses a session switch while a request is in flight`
8. `saves the ready user message and completed assistant message with usage`
9. `persists one concise corrected Edit summary with aggregate usage and clean later history`
10. `routes automatic displayed Selection through the exact native-editor request and normal saves`
11. `preserves the typed draft after a successful quick action`
12. `persists an applied edit result when Stop races the ready snapshot`
13. `keeps the streamed answer through the terminal Markdown transition`
14. `keeps the plain answer when Markdown rendering fails`
15. `keeps an opened reasoning panel and its scroll while streaming`
16. `keeps the opened reasoning panel when the first answer content arrives`
17. `restores the reader position when an unrelated render follows a completion`
18. `aligns a real completion only after its own Markdown generation settles` (formerly `wires a real completion to its own render generation before aligning`)

The migrations retain or strengthen the original observations. In particular, automatic displayed Selection is observed before any explicit target-menu choice; per-session Chat/Web/Edit policies, Related notes, exact capacity text, drafts, and originating-session history remain asserted; rapid stale loads retain a publicly selected non-default Edit mode; stale stream completion emits no new Notice; and concise Edit persistence continues to exclude private candidates, raw Operations, and rejected reasoning through direct persisted content/reasoning checks.

Three additional cases are not migrations:

- Parameterized `does not mutate dismissed %s menus through real view refreshes` contributes separate Writing and model cases.
- `accepts a just-hidden writing menu item through real view wiring` proves activation still works after `hide()` and causes no provider request.

The existing focused composer/model-control tests remain unchanged and continue to run.

### Remaining legacy policy

The entire legacy file was **not** converted. `tests/chat-view.test.ts` still contains **260** unrelated legacy cases, including the private-prototype mechanisms they require. Those cases remain in the full suite and were not silently deleted, skipped, or weakened. They are not evidence for this PR's required public behaviors and are not a pattern for new work.

New or changed behavioral coverage belongs in `tests/chat-view-public.test.ts`. Do not add prototype-type entries, hand-built contexts, or private-field casts to the legacy suite. Later controller work must use this public seam and migrate any remaining legacy modification case it touches rather than copying its retrofit pattern.

## Characterization and restored-mutation evidence

The migrated behaviors were already fixed on the baseline, so their public characterizations were expected to pass against unchanged production code. No production characterization failure was found. Initial fixture corrections addressed mock lifecycle/Markdown behavior and public-harness assumptions, not production behavior.

| Stage of work | Characterization result |
| --- | --- |
| Seam and failed load | Genuine strict-build RED for protected/private access before visibility widening; after the seam and deletion of the two old equivalents, **2 files / 278 tests** passed (2 public + 276 legacy). |
| Sessions and streams | **2 files / 278 tests** passed (7 public + 271 legacy). |
| Modification behavior | Public characterization reached **12 tests**; focused writer/edit regression run passed **4 files / 324 tests** (12 public + 266 legacy + 20 edit-response + 26 edit-summary). |
| Streaming and scroll | **2 files / 278 tests** passed (18 public + 260 legacy). |
| Dismissed controls | **3 files / 71 tests** passed (21 public + 30 composer-control + 20 model-control). |

Temporary local mutations supplied regression RED/GREEN evidence. Every production mutation was restored immediately, and `git diff --exit-code` confirmed no retained production edit.

| Area | Restored-mutation RED | Restored GREEN |
| --- | --- | --- |
| H4 failed-load recovery | Removing transient-session installation caused **1 failed / 1 skipped**; no ready exchange was appended. | Both failed-load public tests passed. |
| Stale render scheduling | Removing the active-request scheduling guard put `STALE_STREAM_CONTENT` into the old current DOM node. The test had already proved that the old loading node and body were rendered before the stale callback. | One focused test passed, six skipped. |
| Old-request `finally` ownership | Bypassing ownership only for the aborted old request let old cleanup clear the newer request; the new ready answer was absent. | One focused test passed, six skipped. |
| M1 reasoning identity | Forcing a same-shape body rebuild changed the `<details>` identity: **1 failed / 17 skipped**. | The focused reasoning test passed. |
| M12 completion-scroll outer guard | Disabling only the outer generation guard made the current post-`setMode` scroller **200 instead of 275**, using fresh current geometry (top 100, assistant top 25). The inner generation check was untouched. | Six completion-filtered tests passed, 12 skipped. |
| M10 dismissed menus | Removing only `activeMenu = null` from both `onHide` handlers caused checked-state mutations on dismissed Writing and model items: **2 failed / 1 passed / 18 skipped**. The just-hidden activation case still passed. | Three menu cases passed, 18 skipped. |

The A → B → A stale-stream and M12 completion-scroll results are **public-unit/mutation evidence**, not real-Obsidian stale-SSE, held-Markdown, or real completion-scroll race evidence. No such real-Obsidian scenario was added.

## Unit and local-gate evidence

At code head `2b61bc0b4430ac336db814542af04cae2b669f54`, the Task 5 full gate passed:

- `npm test`: **54 files / 1,880 tests**.
- `npm run lint`: passed with no errors.
- `npm run build`: strict TypeScript checking and production esbuild passed.
- `git diff --check`: passed.
- `git diff --exit-code -- src`: passed.

The final scoped migration check on that code head, before canonical documentation, was:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts \
	tests/chat-composer-controls.test.ts tests/chat-model-control.test.ts
```

It passed **4 files / 331 tests**: 21 public, 260 legacy, 30 composer-control, and 20 model-control. The required search for private-prototype retrofit patterns in `tests/chat-view-public.test.ts` and `tests/helpers/chat-view-public-fixture.ts` returned no matches.

The canonical-documentation commit changes the build identity because the bundle embeds `HEAD`. Its exact-head `npm ci`, full test, lint, build, diff gate, rebuilt real-Obsidian confirmation, and resulting bundle identity are recorded in the Task 7 report and PR evidence rather than recursively editing this committed record after its own head changes.

## Final-review fix-wave evidence

Final review restored two dropped legacy observations and strengthened the raw-Operations privacy checks in commit `4f064396728749aeffc87fde937a66c4ccd95b92`. The rapid-load case now selects Edit through public `setMode` while both loads are pending and asserts the final `Edit · Full note` trigger after stale First settles. The stale A → B → A case snapshots the Notice count before the old callback and asserts no later Notice after `oldSubmission`. The corrected-Edit case inspects joined persisted message content and reasoning directly for private candidates, raw Operations, and rejected reasoning; its exact snapshot assertions are unchanged. No test case was added or removed and no production file changed.

At that test-fix code head, the focused public-plus-legacy run passed **2 files / 281 tests** (21 public and 260 legacy). The exact-head gate passed **54 files / 1,880 tests**, lint, strict TypeScript/production build, `git diff --check`, and a clean tracked diff. Dependencies were already installed and the lockfile was unchanged, so `npm ci` was omitted.

The same head passed all three established real-Obsidian groups: `--public-chat-view` **2 scenarios / 19 assertions**, `--stabilization` **6 / 55**, and `--sessions` **9 / 156**, for **17 scenarios / 230 assertions** with no failures. Root and loaded bundle SHA-256 were both `a488e1fc39722bd5905c802770e2e5bb90ba9ca1ba05af4d873aea44446bb84b`; every summary recorded `loadedBundleMatchedRoot: true`. The environment and evidence limits below are unchanged.

The evidence-documentation commit containing this section changes the embedded head again. Its ultimate exact-head gate, repeated real-Obsidian confirmation, final bundle identity, and preserved summary paths are recorded in `final-fix-report.md`, avoiding another recursive Stage 54 edit.

## Deterministic real-Obsidian evidence at code head

Task 6 built and ran the ignored harness at code head `2b61bc0b4430ac336db814542af04cae2b669f54`. The root and loaded bundle SHA-256 were both `236266aca8361b0c84fdeda4e9cea204d6b7c70226ebe161390dd15b449dd44b`; every summary recorded `loadedBundleMatchedRoot: true`.

| Harness group | Scenarios | Assertions |
| --- | ---: | ---: |
| `--public-chat-view` | 2 passed, 0 failed | 19 |
| `--stabilization` | 6 passed, 0 failed | 55 |
| `--sessions` | 9 passed, 0 failed | 156 |
| **Total** | **17 passed, 0 failed** | **230** |

### New public scenarios

`01-failed-load-recovers-usable-chat` passed **10 assertions**. A one-shot rejection of a valid schema-3 aggregate read restored the original adapter immediately. The real view showed the exact load Notice, exposed a usable transient New chat and enabled controls, completed one ordinary loopback Chat request, materialized the transient ID as the active schema-3 session, and persisted exactly the ready user and assistant messages. Subsequent reads used the restored adapter; note bytes and both writers remained untouched. This was a rejected-load path, not a malformed-data fixture.

`03-dismissed-menu-hide-before-click-simulation` passed **9 assertions**. It opened real Writing and model menus, retained host callbacks, explicitly called `menu.hide()`, refreshed through public view methods, and observed zero checked/disabled mutations on every dismissed item. Invoking the retained `Edit · Full note` and `deepseek-v4-pro` callbacks after hiding produced exactly one choice each, no provider request, and no note write.

Scenario 03 is explicitly a **CDP-driven hide-before-click simulation**. It is not physical pointer coverage, native OS menu dispatch/order coverage, or native macOS coverage.

### Existing stabilization and session evidence

Within the totals above, stabilization `04-reasoning-panel-across-deltas` passed **10 assertions**: an opened, scrolled reasoning panel retained the same node, open state, and `scrollTop: 15` across further reasoning and answer deltas, then completed with all 477 reasoning characters after one loopback request.

Sessions `08-full-selection-edits-native-undo` passed **14 assertions**: actual full-note and Selection edits persisted in their originating sessions with usage, used one guarded full-note write and one native Selection replacement, and restored exact native undo/redo bytes. Only the intended synthetic note changed.

### Preserved evidence and screenshots

The Task 6 report and the following named group directories preserve the code-head results and screenshots. Task 7's final-head confirmation uses the harness's generic `evidence/` directory and its rotated `evidence-backup-*` directories; the exact final paths and identities are recorded in the Task 7 report:

- `test_vault/emend-selection-chat-verify/evidence-public-chat-view/summary.json`
- `test_vault/emend-selection-chat-verify/evidence-stabilization/summary.json`
- `test_vault/emend-selection-chat-verify/evidence-sessions/summary.json`
- `test_vault/emend-selection-chat-verify/evidence-public-chat-view/screenshots/01-failed-load-recovers-usable-chat.png`
- `test_vault/emend-selection-chat-verify/evidence-public-chat-view/screenshots/03-dismissed-menu-hide-before-click-simulation.png`
- `test_vault/emend-selection-chat-verify/evidence-stabilization/screenshots/04-reasoning-panel-across-deltas.png`
- `test_vault/emend-selection-chat-verify/evidence-sessions/screenshots/08-full-selection-edits-native-undo.png`

An initial harness-only attempt failed because it expected a one-session selector to be enabled and tried to resolve the host-only Obsidian module from renderer scope. The harness was corrected without production changes or weakened assertions; the final required groups above passed. Details are in Task 6's report and `evidence-public-chat-view-attempt-1/summary.json`.

## Environment and evidence limits

- Real-Obsidian evidence used official Obsidian **1.15.0** AppImage on Linux `x86_64`, isolated Xvfb `:101` at `1440x1000x24`, and CDP port `19224`. Windows, macOS, native macOS menus, other Obsidian versions, and other platforms were not exercised.
- Providers were loopback OpenAI-compatible SSE/CORS mocks at `127.0.0.1:18766` with a dummy SecretStorage credential. No real provider, account, real credential, external network request, or paid call was used.
- Existing keyboard checks used trusted CDP events, not physical OS-level typing. Scenario 03 used direct hide-then-callback simulation, not physical pointer input. No screen-reader or assistive-technology output was exercised.
- Stale-stream generation isolation and M12 completion-scroll behavior have public-unit and restored-mutation evidence only in this PR. No real stale-SSE, stale-generation stream, held-Markdown, or M12 real-Obsidian scenario is claimed.
- Unit evidence uses the existing Obsidian mock and fake DOM. It does not establish physical menu behavior, native OS menu ordering, screen-reader behavior, real-provider behavior, or non-Linux coverage.
- Historical [Stage 51](51-2-10-stabilization.md) results and the separate `chat-view.ts` decomposition deferral remain unchanged.
