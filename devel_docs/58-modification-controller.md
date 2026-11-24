# Stage 58: Stateless modification controller

## Status, base, and scope

Implemented on `feature/2.11-pr05-modification-controller` from merged PR 04 base `9a637f54e04090d88bbb55a19b63696fbb8ee71c`. The production and test head for the evidence through Task 3 is `5f937248bb5df76eafc98e45676c1fd80db6b87d`; Task 4 starts its documentation-only changes at that same head.

This is a behavior-preserving extraction and public-test migration, not a user-facing feature. It moves only the chat view's Edit request dispatch, reasoning/retry callback forwarding, and concise applied/no-op result formatting into a stateless, request-scoped controller. It partially implements [#76](https://github.com/chliu1990/obsidian-emend/issues/76) but does not close that issue or approve any later feature.

| Commit | Subject | Scope |
| --- | --- | --- |
| `402905f` | `test: migrate modification behavior to public seam` | Twelve modification characterizations moved to real public view instances; only their legacy equivalents were removed. |
| `10ff96a` | `refactor: add modification controller` | Stateless controller contract, dispatch, formatting, callback forwarding, and direct unit tests. |
| `5f93724` | `refactor: delegate chat edits to modification controller` | Narrow chat-view Edit delegation plus public delegation, read-only isolation, and stale-lifecycle tests. |

Explicit exclusions are session/thread lifecycle extraction, request/abort identity extraction, streaming render/scroll generation extraction, composer draft/capacity extraction, Web draft/review extraction, control-synchronization extraction, unrelated legacy-test migration, new user behavior, new writers or review UI, coordinator/correction/freshness/target/scanner/provider/persistence changes, dependencies, styles, settings, version metadata, workflows, releases, generated bundles, and vault artifacts. Historical stage records and user behavior guides remain unchanged. Stages [54](54-public-chat-view-test-seam.md), [55](55-edit-target-flow.md), [56](56-edit-freshness.md), and [57](57-markdown-scanner.md) retain their existing ownership.

## Chosen boundary and rejected alternatives

`src/modification-controller.ts` is constructed once per Edit submission after the initial ready-user save and `requireActiveRequest(request)` succeed. It has no request, session, DOM, Web, persistence, target-capture, freshness, correction, or writer state. It forwards the supplied callbacks, calls exactly one injected dependency selected by the captured target type, formats the concise result, and propagates dependency errors unchanged.

`EmendChatView` retains synchronous target/context capture, frozen history and additional-note paths, capacity preflight, `ChatIdentity`, messages, drafts, sessions, the `AbortController` and active-request state, initial and final saves, abort/stale handling, committed-edit save behavior, Chat streaming, Web Review/Auto, rendering, and cleanup. The view owns the callback mutation of `loadingMessage.reasoning` and guarded render scheduling; the controller only forwards those callbacks.

The existing `request-coordinator.ts`, `selection-editor.ts`, `edit-response.ts` correction loop, `edit-freshness.ts`, `note-writer.ts`, and native Selection writer remain authoritative and unchanged. The controller's only runtime import is the pure `edit-summary.ts` formatter module; its other imports are type-only. It does not import the view, plugin, Obsidian UI, Web modules, persistence, freshness, or writers.

The rejected designs were:

- **A view-lifetime controller holding active requests and messages:** it would move request/session identity, broaden the refactor, and add close/stale cleanup risk.
- **A controller owning all of `submitPrompt`:** it would pull Chat, Web, capacity, persistence, and rendering state machines into this focused PR.
- **A shared edit/write executor:** dispatch and concise formatting are the common interaction; writer ordering must remain in the existing guarded modules.
- **Injecting the entire plugin:** two narrow function dependencies avoid a runtime cycle and make accidental Chat/Web routing visible in tests.

## Exact current-method extraction map

At production head `5f93724`, the current responsibilities are:

| Method or type | Current owner and boundary |
| --- | --- |
| `CapturedDraftTarget` in `chat-view.ts` | Reuses `ModificationTarget` for Full-note and Selection Edit variants. The `read-only` and `read-only-selection` variants remain local and unchanged. |
| `submitQuickAction` | Remains in the view. It checks pending state and quick-action capacity, preserves the typed draft, selects the action mode, and enters the common `submitPrompt` path. |
| `submitPrompt` before request dispatch | Remains in the view. It validates idle/session state; synchronously captures the target/context; checks the source path; freezes ready history and additional-note paths; performs capacity preflight; creates identity, messages, and abort/request state; handles drafts and rendering; awaits the initial ready-user save; and requires the request to remain active. |
| `submitPrompt` Edit branch | The view creates reasoning/retry callbacks and two narrow plugin-method dependencies. The controller selects Full-note or Selection dispatch and formats the result. The view assigns `committedEdit`, message content, and usage from the returned result. |
| `submitPrompt` read-only branch | Remains in the view and outside the controller, including Chat, Chat Selection, provisional Web drafts, Web Review/Auto configuration, activities, sources, and incompleteness warnings. |
| `submitPrompt` completion and failure handling | Remains in the view: uncommitted abort check, ready-assistant construction and save, `allowAbortedSave` for committed edits, stopped/error/save-failure handling, and active-request-owned cleanup. |
| `reviewWebCalls`, `persistMessages`, and provider-history projection | Remain in the view with their existing Web review, sanitized persistence, metadata, and originating-session history behavior. |

Full-note Edit still calls `plugin.requestChatCompletion` with an `EditSubmission`, then follows the existing Full-note coordinator and guarded vault writer. Selection Edit still calls `plugin.requestSelectionEdit` with the exact captured snapshot, prompt, signal, editor adapter, additional-note paths, history, callbacks, and Selection context policy, then follows the existing Selection coordinator, freshness guard, and native replacement. Command-palette Modify Selection still calls the Selection request path directly and never enters the chat view or this controller. Edit continues forcing Web search off.

### Public controller interfaces

```ts
export type ModificationTarget =
	| {
		readonly type: 'full-note';
		readonly mode: 'edit';
		readonly context: RequestContext;
	}
	| {
		readonly type: 'selection';
		readonly mode: 'edit';
		readonly target: SelectionEditTarget;
		readonly selectionContext: SelectionContextPolicy;
	};

export interface ModificationStreamCallbacks {
	onReasoning(text: string): void;
	onRetry(): void;
}

export interface ModificationSubmission {
	readonly target: ModificationTarget;
	readonly prompt: string;
	readonly history: ProviderHistoryMessage[];
	readonly additionalNotePaths: readonly string[];
	readonly signal: AbortSignal;
	readonly callbacks: ModificationStreamCallbacks;
}

export interface ModificationResult {
	readonly applied: boolean;
	readonly content: string;
	readonly usage: TokenUsage;
}

export interface ModificationControllerDependencies {
	requestFullNoteEdit(submission: EditSubmission): Promise<EditRequestResult>;
	requestSelectionEdit(
		snapshot: SelectionSnapshot,
		prompt: string,
		signal: AbortSignal,
		editor: SelectionEditorAdapter,
		additionalNotePaths: readonly string[],
		history: ProviderHistoryMessage[],
		callbacks: SelectionEditCallbacks,
		selectionContext: SelectionContextPolicy,
	): Promise<SelectionEditResult>;
}

export class ModificationController {
	constructor(dependencies: ModificationControllerDependencies);
	async submit(submission: ModificationSubmission): Promise<ModificationResult>;
}
```

For applied results, the controller uses `formatEditSummary`; otherwise it uses `formatNoChangeSummary`. Full-note formatting uses `context.sourceText` and source offset `0`. Selection formatting uses `target.snapshot.fullText` and `target.snapshot.from`, preserving note-absolute summary lines. The result contains only `{ applied, content, usage }`, with the usage object preserved.

## Public migration inventory and retained legacy coverage

Task 1 moved the following 12 cases to `tests/chat-view-public.test.ts`. The parameterized failure case contributes three rows. Every submission uses public view methods or rendered controls, with observations at provider requests, conversation-store saves, rendered DOM, notices, and captured editor doubles.

1. `keeps full-note Selection context on the native selection writer only`
2. `sends the same captured ready history as full-note and read-only requests`
3. `adds the Selection start offset once to note-absolute summary lines`
4. `keeps the exact no-op text when a non-applied result carries summary items`
5. `renders the Selection target and model summary as persisted plain content`
6. `renders a no-op summary after the exact no-op sentence`
7. `settles a %s failure and permits a selection retry without fallback` — `provider`, `validation`, and `stale` rows
8. `uses the existing stopped lifecycle and excludes the partial response from saves`
9. `keeps an applied edit summary when its session was deleted during the request`
10. `reports a failed save after a committed edit when Stop raced completion`

The public file grew from 53 to 65 tests while the legacy file decreased from 230 to 218, preserving the full-suite total. Only those equivalents and their unused legacy persistence wrapper were removed. The Selection submission block deliberately retains four read-only legacy rows: `never renders a summary field from a read-only response` plus `never routes read-only %s to a selection writer` for `ask`, `discuss`, and `brainstorm`. All other unrelated legacy coverage remains without retrofit expansion.

`tests/request-isolation.test.ts` remains unchanged with its 22 real coordinator/request isolation tests. Task 3 added seven public cases: Full-note delegation, Selection delegation, four parameterized Chat/Chat Selection/Web Review/Web Auto isolation rows, and one non-applied late-Edit lifecycle race. The only controller observation in those view tests is a call-through spy on public `ModificationController.prototype.submit`; no `EmendChatView` prototype/private access, hand-built public view context, or production test accessor was added. The direct controller suite contains 14 tests across the seven planned contract groups, including parameterized target callbacks and provider/validation/stale/abort error identity.

## Characterization, genuine RED, and gates through Task 3

Task 1's public migration was expected-GREEN characterization on unchanged production, not manufactured RED. Before legacy deletion, `npx vitest run tests/chat-view-public.test.ts` passed **65/65**. Task 3's four read-only isolation rows likewise passed before delegation. Its non-applied stale-lifecycle characterization also passed before production wiring: **1 passed, 71 skipped**. These characterize existing behavior rather than claiming a former product defect.

The genuine implementation RED evidence was:

- **Task 2 missing module:** `npx vitest run tests/modification-controller.test.ts` failed with one failed suite and zero tests run because `src/modification-controller.ts` did not exist. After implementation, the same command passed **14/14**.
- **Task 3 zero delegation:** the focused delegation/isolation filter produced **2 failed, 4 passed, 65 skipped** on pre-delegation production. Full-note and Selection each failed `expect(controllerSubmit).toHaveBeenCalledOnce()` with zero calls; the four read-only rows passed. After wiring, the filter passed **6 tests with 66 skipped** because the separate stale-lifecycle case had then been added.

Executed verification available through production head `5f93724` is:

| Task | Command or check | Result |
| --- | --- | --- |
| Baseline | `npm ci && npm test` | **56 files / 2,050 tests passed**. |
| Task 1 | Public characterization before legacy deletion | **65/65 passed** on unchanged production. |
| Task 1 | `npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts tests/request-isolation.test.ts` | **3 files / 305 tests passed**: 65 public, 218 legacy, 22 request-isolation. |
| Task 1 | `npm test` | **56 files / 2,050 tests passed**, matching baseline. |
| Task 1 | Focused ESLint and `git diff --check` | Passed. |
| Task 2 | `npx vitest run tests/modification-controller.test.ts` | **1 file / 14 tests passed** after genuine missing-module RED. |
| Task 2 | `npx tsc -noEmit -skipLibCheck` and focused ESLint | Passed. |
| Task 2 | `npm test` | **57 files / 2,064 tests passed**. |
| Task 2 | `git diff --check` and scoped diff inspection | Passed; only the new controller and its test file changed. |
| Task 3 | Six-file focused regression across controller, public/legacy view, request isolation, edit response, and edit summary | **6 files / 372 tests passed**. |
| Task 3 | `npm test` | **57 files / 2,071 tests passed**. |
| Task 3 | `npm run lint` | Passed. |
| Task 3 | `npm run build` | Strict TypeScript checking and production esbuild passed. |
| Task 3 | `git diff --check` and base-to-head scope inspection | Passed; no coordinator, correction, freshness, writer, target, scanner, provider, persistence, style, version, workflow, or generated-file change. |

Tasks 1–3 received their assigned independent reviews with clean gates recorded in the SDD ledger. Task 3's review explicitly covered writer routing, lifecycle/save behavior, read-only isolation, concise persistence, and privacy. These are unit/mock and static-build results, not real-Obsidian results.

## Observed pre-final-documentation-head real-Obsidian evidence

Task 5 provisioned the current PR 04 verifier, mock provider, model-control support, Obsidian/Xvfb tools, and separately installed Track Changes companion into this worktree's ignored `test_vault/`. Each run created a fresh synthetic runtime and vault; no saved chat or earlier evidence was reused as a PR 05 result. **This section records pre-final-documentation-head evidence at `a231445b2badc70687ef136ad5baf5807bed08d0`, before this Stage 58 evidence commit.** Final exact-head gate and runtime evidence belongs to the SDD Task 5 report rather than another recursive documentation commit.

The executed build and runtime commands were:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Every evidence-run command exited `0`. The six summaries reported the exact head above, zero failed scenarios, equal root and loaded `main.js` SHA-256 values, setup bundle identity matched, and final `loadedBundleMatchedRoot: true`. The common root and loaded hash was `61c632e2222958e551567aa80373e14afe1c8bd271865f844e97c6db1446b349`.

| Ignored summary under `test_vault/emend-selection-chat-verify/evidence-pr05-pre/` | Passed scenarios | Assertions | Result |
| --- | ---: | ---: | --- |
| `modification-controller/summary.json` | 6/6 | 73 | Pass |
| `markdown-scanner/summary.json` | 10/10 | 318 | Pass |
| `edit-freshness/summary.json` | 24/24 | 227 | Pass |
| `edit-target-flow/summary.json` | 5/5 | 95 | Pass |
| `stabilization/summary.json` | 6/6 | 55 | Pass |
| `sessions/summary.json` | 9/9 | 156 | Pass |
| **Total** | **60/60** | **924** | **Pass** |

### Focused modification-controller observations

1. `01-full-note-correction-summary-history-privacy` — **23 assertions**. One ambiguous candidate and one valid correction made exactly two requests to the same loopback model. The second request alone contained the private candidate and bounded typed ambiguity feedback. Exactly one guarded `vault.modify` wrote the expected CriticMarkup and no native replacement occurred. The result and schema-3 aggregate retained aggregate usage of 46 tokens, successful-only reasoning, and the concise line-4 result. A following ordinary Chat request contained only the annotated original user prompt and concise local Edit result. Follow-up history excluded rejected artifacts, diagnostics, and the captured full-note snapshot; saved-chat audits excluded rejected reasoning/candidates/summaries, Operations payloads, diagnostics, and request/source snapshots. Request evidence and saved chats excluded headers, authorization, and the dummy credential.
2. `02-selection-full-note-context-native-undo` — **8 assertions**. `Edit · Selection · Full note` sent the complete note as supporting context and named only the Selection as edit target, with no Web tools. One native `replaceRange` used captured offsets 35–70 and exact annotated Selection bytes; guarded vault writes stayed at zero and outside-Selection Unicode/source bytes stayed exact. The concise result reported note-absolute lines 5–6. Actual native undo and redo restored the complete original and annotated documents.
3. `03-quick-action-draft-and-capacity-preflight` — **8 assertions**. Fix grammar completed through the controller-backed Selection path while preserving the independent typed draft. The next over-capacity draft added no runtime or persisted message, provider request, chat save, writer call, or note-byte change.
4. `04-session-lock-note-switch-and-stale-callback-isolation` — **12 assertions**. A held Full-note Edit disabled and refused a session switch, and the same-note registry refused a second request while the first remained pending. Switching to B aborted A. Releasing A's held non-applied response and invoking its retained reasoning/retry callbacks after newer B Chat started caused no stale DOM content, save, Notice, or B-thread contamination. A retained only its ready user prompt; A and B note bytes and both writers remained untouched.
5. `05-applied-stop-save-race` — **8 assertions**. One native Selection replacement completed before a harness-held final assistant save. Stop raced that save; the assistant save options had no abort signal, then committed successfully as a ready concise result with usage and successful reasoning. Controls returned to Send, no second write occurred, and native undo/redo restored exact original/annotated bytes.
6. `06-web-review-auto-writer-free-isolation` — **14 assertions**. A real Review modal exposed a transient labelled Web draft with no Copy action. The edited URL reached the actual loopback Fetch request, and the continuation request preserved the edited URL and extraction goal in its tool-call arguments. Auto completed without a review pause. Both modes persisted only terminal answers, sanitized activity, user badges, and aggregate usage of 33 tokens. Provisional content was absent from later history, Copy, and persistence; raw tool/retrieval artifacts and credentials were absent from saved chats. No Edit result appeared and neither writer ran.

The inherited groups passed their actual scanner/fence/table/CRLF guards, disk/captured-editor/secondary-pane freshness and wrong/no-open-target refusals, held-read and immediate aborts, no-op and writer-free Chat/Chat Selection controls, stale-after-correction behavior, target/session/draft/history/capacity/Web flows, native undo, streaming reasoning, multi-pane behavior, and schema/persistence privacy checks. These were new executions against the PR 05 bundle, not inherited pass claims.

### Negative control and harness-only development failures

A temporary harness-only negative control ran once with `node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller`. It exited `1` and wrote `0 passed, 1 failed; 0 assertions` for `harness-only-negative-control`, with `loadedBundleMatchedRoot: true`. The control was removed before evidence runs; its summary is preserved at `test_vault/emend-selection-chat-verify/evidence-pr05-negative-control/summary.json`. This was a verifier self-check, not a product failure.

Three focused development runs also failed before the green evidence run; their summaries are under `test_vault/emend-selection-chat-verify/evidence-pr05-development/`. All were diagnosed as harness defects and none required a production change:

- `focused-dev1-summary.json`: 4 passed, 2 failed, 51 assertions. The Stop/save assertion read disk before Obsidian flushed the completed native edit, so it was changed to the established condition-based note-byte wait. The Web setup also incorrectly tried to redefine Chromium's non-configurable `navigator.clipboard` property instead of stubbing its `writeText` method.
- `focused-dev2-summary.json`: 5 passed, 1 failed, 59 assertions. The draft assertion ran after `deepseek-web.ts` had intentionally reset provisional content upon receiving tool calls. The mock was changed to hold between provisional content and tool-call chunks so the transient UI is observed at its actual stage.
- `focused-dev3-summary.json`: 5 passed, 1 failed, 59 assertions. The harness incorrectly expected `extractionGoal` in the DeepSeek Fetch API body. Source inspection confirmed that API receives only `url`; assertions now verify the edited URL at `/v1/tools/fetch` and both edited arguments in the actual continuation tool-call request.

### Runtime environment and limits

Evidence used Linux `6.12.117+deb13-amd64` x86_64, the official Obsidian **1.15.0** AppImage, isolated Xvfb `:101` at 1440×1000, CDP port 19224, and the separately provisioned Track Changes **2.3.0** companion. Provider traffic used only `127.0.0.1:18766` OpenAI-compatible SSE/CORS and DeepSeek Fetch mocks with a dummy SecretStorage credential. No real account, paid call, private note, external provider request, or real credential was used.

These results do not establish real-provider behavior, Windows/macOS/mobile coverage, physical OS-level input, or screen-reader/assistive-technology behavior. Keyboard coverage in inherited groups used trusted CDP-dispatched events. The root/loaded hash proves bundle identity in this harness, not behavior in an unexercised Obsidian version or host environment.

## Remaining issue #76 and user-facing scope

Only the modification submission/review interaction extraction landed in this stage. **Issue #76 remains open** for:

- session/thread lifecycle;
- request/abort identity;
- streaming render/scroll generations;
- composer draft/capacity;
- Web draft/review state; and
- control synchronization.

No session, draft, capacity, streaming, Web, menu, notice, persistence-schema, provider, Track Changes, or editing behavior changed. No later feature, broad view decomposition, new review surface, or issue closure is implied. The PR must reference rather than close #76.

## Evidence limits and later evidence ownership

The unit tests use Obsidian mocks, fake DOM, synthetic contexts, and dependency doubles. They do not prove actual host note bytes, host synchronization, native undo/redo, real-provider behavior, physical keyboard/pointer input, screen-reader behavior, or Windows/macOS/mobile coverage. The Task 3 production build proves strict compilation and bundling, not runtime behavior in Obsidian. No real account, external provider request, paid call, or real credential is part of the evidence through Task 3.

Task 4's documentation regression and link checks belong to its task report and are not host-runtime evidence. Task 5 has now added the observed pre-final-documentation-head runtime evidence above, including actual host note bytes and native undo/redo in the exercised environment. Final exact-head gate/runtime totals and bundle identities belong to the SDD Task 5 report and PR evidence rather than a recursive documentation update.
