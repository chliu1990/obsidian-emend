# Emend 2.11.0 PR 01 Public Chat-View Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small public behavioral seam for `EmendChatView`, migrate the PR 01 modification/session/render characterization set to real view instances, and prove the failed-load, stale-stream, dismissed-menu, reasoning-panel, and completion-scroll regressions through public behavior without changing runtime behavior.

**Architecture:** Construct real `EmendChatView` instances against the existing Obsidian mock and drive them through their public lifecycle, session, submission, DOM, provider, and conversation-store boundaries. The only production change is visibility widening for the existing `onOpen`, `onClose`, and `submitPrompt` methods; no wrappers, state accessors, test-only mutators, rendering hooks, or controller extraction are introduced. Existing private-prototype tests outside the explicit migration list remain temporarily as legacy regression coverage, frozen against expansion, while every PR 01 acceptance behavior receives an independent public test.

**Tech Stack:** Strict TypeScript, Obsidian 1.11.4+ desktop APIs, Vitest 4 with the existing Node environment and Obsidian mocks, the existing fake DOM, ESLint, esbuild/CommonJS for ES2021, and the established ignored real-Obsidian Linux/Xvfb loopback harness. No new dependency.

**Spec:** Global approved plan `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, PR 01 row; [Issue #87](https://github.com/chliu1990/obsidian-emend/issues/87); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `devel_docs/51-2-10-stabilization.md`.

## Global Constraints

- Keep plugin ID `emend`, view type `emend-chat-view`, existing `emend:` command IDs, and released version metadata stable until the separate 2.11.0 release PR.
- Chat, Chat Selection, Web research, image selection, and Related Notes remain writer-free. Full-note Edit alone may call guarded `vault.modify`; Selection-based edits may call only native `editor.replaceRange` on the captured range.
- Operations remain the only model-facing edit protocol. Resolve exact original anchors atomically; reject ambiguity, overlap, out-of-target ranges, malformed structure, and stale state. Never partially apply a rejected candidate.
- Existing Edit workflows continue to emit reviewable CriticMarkup. Track Changes remains separate and is the only Apply/Reject surface: no Emend diff/Apply/Reject UI, bundling, automatic installation, or second review UI.
- Only the explicit Mermaid Selection actions may compile Operations directly to final Markdown without tracking, and only that separate strategy may intersect exactly one captured, structurally closed `mermaid` fence. Shared tracked-edit fence/table/payload/inline-code/CriticMarkup guards and every non-Mermaid request remain unchanged. This is not a global tracking preference.
- Candidate-validation failure retains exactly one same-provider correction with bounded private diagnostics. Provider, abort, stale, capacity, permission, and write failures get none. Configurable retries and partial application from `#48` are outside 2.11.0.
- Image bytes are read only after explicit submission, only for declared vault-local references, and only for an exactly supported provider/model. Unsupported configurations fail without a silent text-only fallback. Selecting images together with Web Review/Auto is rejected terminally before image-byte reads or networking; do not silently disable Web, drop images, or send them through unverified Web rounds. No image bytes, base64, request bodies, or attachment snapshots enter history or persistence.
- Paths remain opt-in. Do not add resolver-generated paths, basenames, or vault names to prompts, image wire metadata, or errors when path sharing is off. User-authored embed destinations remain part of the declared note Markdown under existing prompt behavior; image names may appear only in local UI.
- Preserve ready-only originating-session history, same-note request serialization, schema-3 persistence, SecretStorage credentials, sanitized saves, capacity checks at preflight and every fetch, abort/target/generation guards, and private raw candidates/retrieval artifacts.
- Use focused modules and existing TypeScript style. Do not add a second provider stack, universal modality schema, background request/index/upload, telemetry, remote code execution, or unbundled runtime dependency.
- Every behavior PR updates `AGENTS.md`, the owning user guide, `IMPLEMENTATION_PLAN.md`/`ROADMAP.md` as applicable, and adds a new current stage record. Do not alter historical stage results.
- Feature and refactoring PRs do not bump versions, create tags, publish releases, change workflows, or submit to the Community Directory.
- Start from clean `main` at `89babd6` on branch `feature/2.11-pr01-public-chat-view-tests`. Baseline verification is 53 test files and 1,877 passing tests.
- This PR changes test architecture and method visibility only. Do not alter method bodies or user-visible behavior in `chat-view.ts`, the focused controls, persistence, providers, writers, or styles.
- PR 05 will extract the modification controller. Do not perform that decomposition, create a controller interface, or move modification logic in PR 01.

## Review Focus

1. **Failed and superseded loads:** a rejected load must expose a usable transient session, while a late load must not replace a newer note/session or resurrect a closed view. Owned by Task 1’s two failed-load tests and Task 2’s `applies only the latest note load during rapid note switches` and `does not apply a pending load after the view closes`.
2. **Stale stream generations:** callbacks and `finally` cleanup from an aborted older request must not render into, persist into, stop, or clear the newer request. Owned by Task 2’s `isolates stale stream callbacks and finally cleanup from a newer request after A → B → A`. The fixture must retain and render the old loading message after returning to A so the stale-render mutation is observable.
3. **Streaming reasoning DOM:** reasoning and answer deltas must retain the same reasoning panel, its open state, and its scroll position, including the first answer-content shape transition. Owned by Task 4’s two `keeps an opened reasoning panel…` tests.
4. **Dismissed native controls:** capacity/model refreshes must not mutate hidden menus, but Obsidian’s hide-before-click ordering must still allow exactly one current item activation. Owned by Task 5’s `does not mutate dismissed $surface menus through real view refreshes` and `accepts a just-hidden writing menu item through real view wiring`.
5. **Completion render generations:** a real completion must align only after its own Markdown generation settles; a later unrelated render must restore the reader’s position instead of applying the stale completion offset. Owned by Task 4’s two completion tests. The M12 mutation removes only the outer stale-generation early return while retaining completion binding; geometry is assigned to the current post-`setMode` elements.

## Exact File Map

| File | Change | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-11-22-emend-2-11-pr01-public-chat-view-tests.md` | Create | This focused implementation plan. |
| `src/chat-view.ts:264,272,1659` | Modify | Widen the existing `onOpen()`, `onClose()`, and `submitPrompt()` declarations to `public`; leave every body byte-for-byte unchanged. |
| `tests/mocks/obsidian.ts:27-32` | Modify | Add the minimal `ItemView.register`/`registerEvent` lifecycle surface needed to open real views in unit tests. |
| `tests/helpers/fake-element.ts` | Create | Mechanically extract the existing `FakeElement`, `findElements`, `textOf`, and message-node helpers. Add attribute-selector lookup and controllable animation-frame support required by real view rendering. |
| `tests/helpers/chat-view-public-fixture.ts` | Create | Construct real `EmendChatView` instances with an assigned fake `contentEl`, a functional fake `app`, shared settings and `AdditionalNotesStore` references, typed provider/store doubles, session fixtures, deferred values, DOM queries, and animation-frame flushing. Neither the fixture nor its tests may access private view state. |
| `tests/chat-view-public.test.ts` | Create | Public behavioral modification/session/render tests and the new real-view dismissed-menu integration tests. |
| `tests/chat-view.test.ts` | Modify | Remove the 18 migrated cases listed below, import the extracted fake-DOM helpers, and delete only newly unused helper/import code. Preserve all unrelated legacy cases. |
| `AGENTS.md` | Modify | Record the real-instance public chat-view testing rule and the prohibition on new private-prototype retrofitting. |
| `IMPLEMENTATION_PLAN.md` | Modify | Add the public test-seam boundary and Stage 54 index entry. |
| `ROADMAP.md` | Modify | Record the shipped public test seam and remove the completed #87 deferral without changing the #76 decomposition deferral. |
| `devel_docs/54-public-chat-view-test-seam.md` | Create | Record scope, exact migration policy, RED/mutation evidence, gates, real-Obsidian scenarios, bundle identity, and environment/provider limits. |
| `test_vault/emend-selection-chat-verify/verify.mjs` | Ignored local verification only | Add deterministic `--public-chat-view` scenarios 01 and 03: one-shot conversation-adapter read rejection and an explicitly labelled hide-before-click simulation. Never commit. |
| `test_vault/emend-selection-chat-verify/mock-provider.mjs` | Ignored local verification only, if needed | Reuse or add only ordinary deterministic loopback answers required by those scenarios. Do not add stale-stream or held-Markdown scenarios. |

`tests/chat-composer-controls.test.ts` and `tests/chat-model-control.test.ts` remain unchanged and are run as focused regression suites. No public guide changes are needed because no user-facing behavior or documentation claim changes.

## Migration Boundary

### Existing private-prototype tests migrated in this PR

The public replacements must preserve the existing assertions or strengthen them through DOM/provider/store observations. Delete each listed old case in the same task that adds its public replacement.

**Task 1 — failed-load recovery**

1. `recovers a usable transient session when the thread load fails`
2. `shows New chat as usable after a failed thread load`

**Task 2 — session and stream behavior**

3. `applies only the latest note load during rapid note switches`
4. `does not apply a pending load after the view closes`
5. `restores the active session and keeps drafts, controls, history, and capacity session-scoped`
6. `isolates stale stream callbacks and finally cleanup from a newer request after A → B → A` (the removed private case was named `…after A1 → A2 → B → A1`)
7. `refuses a session switch while a request is in flight`

**Task 3 — modification behavior**

8. `saves the ready user message and completed assistant message with usage`
9. `persists one concise corrected Edit summary with aggregate usage and clean later history`
10. `routes automatic displayed Selection through the exact native-editor request and normal saves`
11. `preserves the typed draft after a successful quick action`
12. `persists an applied edit result when Stop races the ready snapshot`

**Task 4 — rendering and completion scrolling**

13. `keeps the streamed answer through the terminal Markdown transition`
14. `keeps the plain answer when Markdown rendering fails`
15. `keeps an opened reasoning panel and its scroll while streaming`
16. `keeps the opened reasoning panel when the first answer content arrives`
17. `restores the reader position when an unrelated render follows a completion`
18. `wires a real completion to its own render generation before aligning`

The Task 5 real-view menu tests are additional integration coverage. The existing focused-control M10 tests stay in place.

### Remaining private tests

- Leave every unlisted legacy case in `tests/chat-view.test.ts`; do not silently delete, skip, or weaken it.
- The shared fake-DOM extraction is the only permitted mechanical change to those cases.
- Keep `viewPrototype`, `productionSubmitPrompt`, `productionPersistMessages`, and `Object.setPrototypeOf` only where still required by remaining legacy cases. Remove any that become unused.
- Add no new entries to the legacy prototype type, no new hand-built view contexts, and no new private-field casts. New or changed behavioral coverage belongs in `tests/chat-view-public.test.ts`.
- Legacy tests continue running in the full suite, but they do not count as evidence for PR 01’s required public behaviors.
- PR 05 must use this public seam for controller characterization and must migrate any remaining legacy modification test it touches rather than copying its retrofit pattern.
- PR 01 may close the scoped #87 deliverable after all 18 migrations and the new integration tests pass, but documentation and the PR description must not claim that the entire legacy suite is private-cast-free.

## TDD and Characterization Policy

Task 1 has a genuine compile-time RED because the public methods do not yet exist in TypeScript’s public contract.

The migrated behaviors are already fixed on the baseline, so their initial public characterization runs should be green. Do not manufacture implementation RED by weakening assertions. Instead, each required regression area includes a temporary, local mutation check against the old defective logic: observe the named public test fail, restore the mutation immediately, and observe it pass. Mutation changes are never committed.

---

### Task 1: Public View Seam, Real-Instance Fixture, and Failed-Load Recovery

**Files:**
- Create: `tests/helpers/fake-element.ts`
- Create: `tests/helpers/chat-view-public-fixture.ts`
- Create: `tests/chat-view-public.test.ts`
- Modify: `src/chat-view.ts:264,272,1659`
- Modify: `tests/mocks/obsidian.ts:27-32`
- Modify: `tests/chat-view.test.ts`

**Interfaces:**
- Produces the existing methods with public visibility and unchanged bodies:

```ts
public async onOpen(): Promise<void>;
public async onClose(): Promise<void>;
public async submitPrompt(
	prompt?: string,
	options?: { fromQuickAction?: boolean },
): Promise<void>;
```

- Produces the real-instance fixture:

```ts
export interface PublicChatViewFixtureOptions {
	activePath?: string | null;
	sourceText?: string;
	selectedText?: string;
	defaultMode?: SelectableMode;
}

export interface PublicChatViewFixture {
	readonly view: EmendChatView;
	readonly contentEl: FakeElement;
	readonly conversationStore: ConversationStoreDouble;
	readonly requestChatCompletion: Mock<EmendPlugin['requestChatCompletion']>;
	readonly requestSelectionEdit: Mock<EmendPlugin['requestSelectionEdit']>;
	readonly captureChatContext: Mock<() => RequestContext>;
	readonly captureSelectionEditTarget: Mock<() => SelectionEditTarget>;
	readonly settings: EmendSettings;
	readonly additionalNotesStore: AdditionalNotesStore;
	open(): Promise<void>;
	close(): Promise<void>;
	setActivePath(path: string | null): void;
	flushAnimationFrame(): void;
}

export function createPublicChatViewFixture(
	options?: PublicChatViewFixtureOptions,
): PublicChatViewFixture;
```

The fixture constructs shared host state along these lines, with the exact typed aliases left to the implementer:

```ts
const settings = structuredClone(DEFAULT_SETTINGS);
const additionalNotesStore = new AdditionalNotesStore();
const contentEl = new FakeElement();
const view = new EmendChatView(new WorkspaceLeaf(), plugin);
Object.assign(view, { app, contentEl });
```

Before `view.onOpen()`, the fixture must satisfy all of the following:

- `plugin.settings` and `fixture.settings` are the same object.
- `plugin.additionalNotesStore` and `fixture.additionalNotesStore` are the same object.
- `view.contentEl` is the constructed `FakeElement`, not the empty object supplied by the current `ItemView` mock.
- `app.workspace.on(name, callback)` accepts both `editor-change` and `editor-selection-change`, retains or returns the callback registration as needed by the fixture, and returns an event reference accepted by `registerEvent`.
- `app.vault.getName()` returns a synthetic vault name such as `TestVault`.
- `app.scope` is a real mocked `Scope`, because `onOpen()` registers the composer scope.
- Any adapter read double required by existing capacity tests remains available under `app.vault.adapter`.

`ConversationStoreDouble` exposes `vi.fn` doubles with the exact existing signatures for `loadConversation`, `createSession`, `appendReadyMessage`, `setActiveSession`, `renameSession`, `deleteSession`, and `reorderSessions`. Export `deferred<T>()`, `makeSession()`, `loadedConversation()`, DOM query helpers, and a cleanup function that closes every created fixture after each test.

- The fixture may cast its plugin double to `EmendPlugin`; it must not cast `EmendChatView` to expose private state or call `EmendChatView.prototype`.
- `open()` and `close()` call only `view.onOpen()` and `view.onClose()`.
- Tests obtain the textarea, messages scroller, session selector, buttons, message elements, and reasoning elements from `view.contentEl`.

- [ ] **Step 1: Extract the shared fake DOM without changing behavior**

Move the existing fake-DOM implementation and generic query helpers to `tests/helpers/fake-element.ts` and import them back into `tests/chat-view.test.ts`.

Add only:

- `[data-message-id="…"]` support in `querySelector`;
- `requestAnimationFrame`/`cancelAnimationFrame` on the fake owner window;
- an exported flush helper that runs one queued frame and clears its handle.

Do not unify the separate control-specific fake DOMs.

- [ ] **Step 2: Add the real fixture and the two failed-load tests**

Add these tests to `tests/chat-view-public.test.ts`:

```ts
it('recovers a usable transient session when the thread load fails', async () => {
	// loadConversation rejects with Error('Unreadable thread').
	// Open the real view, type 'Question', and activate the real Send button.
	// Assert the exact Notice, one provider request, persisted ready user and
	// assistant, and a rendered ready answer containing 'Answer'.
});

it('shows New chat as usable after a failed thread load', async () => {
	// Assert one 'New chat' option, enabled New/Rename/Delete buttons,
	// and enabled Send after typing and dispatching input.
});
```

Use dummy credentials and no network. The store must create the transient session with the ready user before the provider call and append the ready assistant afterward. Before the failed-load assertions, include one fixture smoke assertion that `onOpen()` completes with `settings` and `additionalNotesStore` identical to the plugin-double references and the composer rendered inside the assigned `contentEl`. This is fixture validation, not an additional migrated test.

- [ ] **Step 3: Run the public-contract RED checks**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts
npm run build
```

Expected before the production/mock seam is completed:

- Vitest fails while opening the real view because the existing `ItemView` mock lacks the registration surface, such as `this.registerEvent is not a function`.
- Once the mock surface is present but before visibility widening, `npm run build` fails with TypeScript protected/private access errors for `onOpen`, `onClose`, or `submitPrompt`. Vitest transpilation alone is not accepted as the public-contract check.

- [ ] **Step 4: Implement the minimal seam**

In `tests/mocks/obsidian.ts`, add:

```ts
register<T>(disposable: T): T;
registerEvent(eventRef: unknown): void;
```

`register` returns the supplied disposable; `registerEvent` accepts the host event reference. No view-state emulation is added. These mock registration methods only permit `onOpen()` to register resources; the fixture must additionally supply assigned `contentEl`, workspace events, vault naming, and scope rather than relying on missing host objects being swallowed by a legacy hand-built context.

In `src/chat-view.ts`, add only the `public` keyword to the three existing methods. Do not reformat or edit their bodies.

- [ ] **Step 5: Verify green and remove the two retrofitted equivalents**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts
npm run build
```

Expected: both failed-load public tests and every remaining legacy test pass; strict type-checking and the production build pass.

Delete the two corresponding old tests and any now-unused imports.

- [ ] **Step 6: Mutation-check H4**

Temporarily remove only the transient-session installation from the failed-load `catch`, leaving the Notice intact.

Run:

```bash
npx vitest run tests/chat-view-public.test.ts -t "thread load fails"
```

Expected RED: the controls remain unusable or Send produces no provider request/ready exchange. Restore the production code immediately and rerun the two tests; expected PASS. Do not commit the mutation.

- [ ] **Step 7: Check the public-suite boundary and commit**

Run:

```bash
! rg -n 'EmendChatView\.prototype|Object\.setPrototypeOf|viewPrototype|productionSubmitPrompt|productionPersistMessages' \
	tests/chat-view-public.test.ts tests/helpers/chat-view-public-fixture.ts
```

Expected: no matches.

```bash
git add src/chat-view.ts tests/mocks/obsidian.ts tests/helpers/fake-element.ts \
	tests/helpers/chat-view-public-fixture.ts tests/chat-view-public.test.ts \
	tests/chat-view.test.ts docs/superpowers/plans/2026-11-22-emend-2-11-pr01-public-chat-view-tests.md
git commit -m "test: add public chat-view behavioral seam"
```

---

### Task 2: Migrate Session and Stream-Generation Characterization

**Files:**
- Modify: `tests/chat-view-public.test.ts`
- Modify: `tests/chat-view.test.ts`
- Reuse: `tests/helpers/chat-view-public-fixture.ts`

**Interfaces:**
- Consumes `PublicChatViewFixture`, `deferred<T>()`, `makeSession()`, `loadedConversation()`, and the public session methods already present on `EmendChatView`.
- Produces no production interface.

- [ ] **Step 1: Add the five public session tests**

Add the following behavior, using only real view methods and observable state:

1. **`applies only the latest note load during rapid note switches`**
   - Hold `First.md` and `Second.md` loads in separate deferreds.
   - Resolve Second first, then First.
   - Assert the context and rendered messages remain Second’s, with no `first` message and no loading controls left enabled incorrectly.

2. **`does not apply a pending load after the view closes`**
   - Start `onOpen()` with a held load, call the real `onClose()`, then resolve the stored session.
   - Await the open promise.
   - Assert no loaded message is rendered, no provider call occurs, and the content is cleared.

3. **`restores active session drafts, policies, Related notes, capacity, and origin history through the public view`**
   - Load `a1`/`a2` with active `a2` and their distinct ready answers.
   - Configure policy only through real controls: choose `Chat · Selection`; choose `Web Auto`; choose `Edit · Selection · Full note` and assert its trigger summary and tooltip; then choose `Edit · Full note`, preserving the previously selected Selection-context policy.
   - Add `Reference.md` through `fixture.additionalNotesStore.add('A.md', 'Reference.md')`; do not substitute a private store field.
   - Across session switches, preserve and assert exact per-session draft restoration, active selector value, rendered originating messages, current Edit mode and `Edit · Full note` trigger, retained Chat target and Web choice revealed through public `setMode('ask')` as `Chat · Selection · Auto search`, retained Selection context checked across another public session switch while `Edit · Selection · Full note` and its full-note-context tooltip are visible, visible Related-notes path and `fixture.additionalNotesStore.list('A.md') === ['Reference.md']`, and exact capacity-summary text for each active session.
   - Use additional switches within this one test to make retained policies publicly visible; do not read hidden policy fields and do not reselect a policy merely to pretend it was retained.
   - Derive expected capacity summaries through the existing capacity estimator/formatter and each session’s ready history. Assert the exact `a1` and `a2` summaries after switching and again after returning, rather than merely checking that a refresh function ran.
   - Finish with the originating-session follow-up and assert history contains `second-answer`, not `first-answer`.

4. **`isolates stale stream callbacks and finally cleanup from a newer request after A → B → A`**
   - Start a held request on A and capture its provider callbacks, signal, and rendered loading-message ID.
   - Switch A → B → A using only `setActivePath()` and `refreshTargetNote()`, then start a new held request on A.
   - Configure the fixture/store to return the same in-memory A session and message objects when reloading A. In particular, it must retain the old loading message rather than sanitizing it out of the test fixture.
   - Before emitting stale content, assert the old loading message ID is again rendered in the current public DOM. This mandatory non-vacuity precondition gives the unguarded-render mutation an existing body element to update.
   - Emit `STALE_STREAM_CONTENT` through the old callbacks and resolve the old request.
   - Assert no stale marker appears in the current old or new message bodies or append calls, the new signal remains un-aborted, and Stop still belongs to the new request.
   - Resolve the new response and assert only the new answer becomes ready.

5. **`refuses a session switch while a request is in flight`**
   - Hold a request with sessions `a1`/`a2`.
   - Set the selector to `a2` and call `switchActiveSession('a2')`.
   - Assert it snaps back to `a1`, remains disabled, `setActiveSession` is not called, and the request signal is not aborted.
   - Complete the stream and assert the answer becomes ready.

- [ ] **Step 2: Run characterization green before deleting old coverage**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts
```

Expected: all five new tests pass on the unchanged fixed implementation. This is expected characterization GREEN, not evidence that a new production fix was needed.

- [ ] **Step 3: Remove the five old private-prototype cases and run both suites**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts
```

Expected: all tests pass with no duplicate old equivalents.

- [ ] **Step 4: Mutation-check stale rendering and cleanup**

Perform two separate temporary mutations, restoring each before the next:

- Make `scheduleRequestRender` schedule without its active-request guard. First verify independently that the old loading node is present before the old callback; if it is absent, fix fixture/store retention rather than accepting a vacuous mutation result. Expected RED: `STALE_STREAM_CONTENT` reaches the current DOM.
- Make old-request `finally` cleanup run without checking `this.activeRequest === request`. Expected RED: the new request is aborted/cleared or Send replaces Stop prematurely.

Run after each mutation:

```bash
npx vitest run tests/chat-view-public.test.ts -t "isolates stale stream callbacks"
```

Restore all production changes and rerun; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/chat-view-public.test.ts tests/chat-view.test.ts
git commit -m "test: migrate session behavior to public chat-view seam"
```

---

### Task 3: Migrate Modification Submission and Persistence Characterization

**Files:**
- Modify: `tests/chat-view-public.test.ts`
- Modify: `tests/chat-view.test.ts`
- Reuse: `tests/helpers/chat-view-public-fixture.ts`

**Interfaces:**
- Consumes the real view’s public `submitPrompt`, public mode controls, plugin request doubles, and conversation-store doubles.
- The corrected-Edit test continues using the real `EditRequestCoordinator`, `operationEditStrategy`, and a writer double. It does not mock private view persistence or rendering methods.

- [ ] **Step 1: Add the five public modification tests**

1. **`saves the ready user message and completed assistant message with usage`**
   - Submit `Question`; return `Answer` with `{ promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' }`.
   - Assert the store first persists the ready user and then the ready user plus assistant.
   - Assert the assistant usage and the exact DOM footer `Provider usage · 4 total · 3 prompt · 1 completion`.

2. **`persists one concise corrected Edit summary with aggregate usage and clean later history`**
   - Keep the existing invalid-then-valid Operations coordinator scenario.
   - Assert two provider rounds, exactly one write of `Alpha {~~beta~>delta~~}.`, and aggregate usage 30/7/37.
   - Assert only the concise summary and successful reasoning enter the rendered/persisted assistant message.
   - Assert rejected candidate text, valid raw Operations, and rejected reasoning do not enter persisted messages.
   - Switch to Chat through the real writing menu, submit `Next question`, and assert history is exactly the user Edit prompt plus concise summary.

3. **`routes automatic displayed Selection through the exact native-editor request and normal saves`**
   - Create the fixture with `defaultMode: 'edit'` and a usable selection such as `selectedText: 'beta'`.
   - Open the real view without choosing any writing-menu target and assert the automatic writing trigger displays `Edit · Selection`.
   - Submit through the real composer and assert the exact captured snapshot and editor object, prompt, signal, additional-note paths, history, callbacks, and `'default'` context reach `requestSelectionEdit`.
   - Do not choose `Edit · Selection` from the menu; doing so would lose the old automatic-displayed-target characterization.
   - Assert `requestChatCompletion` is not called.
   - Assert the concise summary and usage persist, while raw JSON and selection snapshots do not.
   - Continue with a Chat request and assert history contains only the concise Edit exchange.

4. **`preserves the typed draft after a successful quick action`**
   - In Edit mode, type `Keep this` and click the real `fix-grammar` quick action.
   - Assert the submitted prompt is `QUICK_ACTIONS[0].prompt`, the assistant becomes ready, and the current textarea still contains `Keep this`.
   - Do not inspect the private draft map.

5. **`persists an applied edit result when Stop races the ready snapshot`**
   - Use a persisted session and an applied Selection result.
   - Activate the real Stop button in a queued microtask as the provider result settles.
   - Assert the committed assistant remains ready, the concise summary persists, and the assistant save is attempted without an abort signal.
   - Assert the final control is enabled Send, not Stopping.

- [ ] **Step 2: Run public characterization and remove the five old equivalents**

Run before deletion:

```bash
npx vitest run tests/chat-view-public.test.ts
```

Expected: all five pass against unchanged behavior.

Delete the five corresponding private-prototype tests, then run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts \
	tests/edit-response.test.ts tests/edit-summary.test.ts
```

Expected: all pass, including unchanged writer and summary suites.

- [ ] **Step 3: Check privacy and writer-boundary assertions in review**

Confirm the new tests still prove:

- no raw candidate or rejected reasoning persistence;
- no Selection fallback to the ordinary request;
- exactly the existing full-note writer call in the corrected-Edit test;
- no new writer or note mutation introduced by the fixture.

If any assertion cannot be observed publicly, retain it through store/writer/provider call inspection rather than reading private view fields.

- [ ] **Step 4: Commit**

```bash
git add tests/chat-view-public.test.ts tests/chat-view.test.ts
git commit -m "test: migrate modification behavior to public chat-view seam"
```

---

### Task 4: Migrate Streaming Rendering and Completion-Scroll Characterization

**Files:**
- Modify: `tests/chat-view-public.test.ts`
- Modify: `tests/chat-view.test.ts`
- Reuse: `tests/helpers/fake-element.ts`
- Reuse: `tests/helpers/chat-view-public-fixture.ts`

**Interfaces:**
- Consumes real provider callbacks, fake animation frames, deferred `MarkdownRenderer.render` promises, and DOM geometry.
- Produces no public rendering or scrolling method.

- [ ] **Step 1: Add the six public rendering tests**

1. **`keeps the streamed answer through the terminal Markdown transition`**
   - Stream `Streamed **full** answer` and hold Markdown rendering.
   - Before release, assert the real assistant node is ready, contains the complete plain answer, and has exactly one answer-content element.
   - Resolve Markdown with `Rendered:Streamed **full** answer`; assert replacement with exactly one rendered-content element.

2. **`keeps the plain answer when Markdown rendering fails`**
   - Load a ready answer through the store and hold its Markdown render.
   - Assert the plain answer is visible immediately.
   - Reject rendering; assert the same text remains and no duplicate answer body appears.

3. **`keeps an opened reasoning panel and its scroll while streaming`**
   - Start a real held submission and emit reasoning/content through captured provider callbacks.
   - Flush the real scheduled frame, open the rendered `<details>`, and set reasoning `scrollTop = 120`.
   - Emit two further deltas and flush each frame.
   - Assert the exact same details and reasoning-content elements, `open === true`, `scrollTop === 120`, and the latest answer text.
   - Resolve the provider to avoid leaked pending work.

4. **`keeps the opened reasoning panel when the first answer content arrives`**
   - Begin with reasoning only, open the panel, and set `scrollTop = 64`.
   - Emit the first answer content and flush.
   - Assert element identity, open state, scroll offset, and answer text are preserved.

5. **`restores the reader position when an unrelated render follows a completion`**
   - Complete a real response with its Markdown render held and retain the assistant message ID.
   - Call `setMode('edit')` to create the unrelated render with a second held Markdown promise.
   - After `setMode`, query the current messages scroller and current assistant element from `fixture.contentEl`.
   - Assign `scrollTop = 275`, scroller top `100`, and assistant top `25` to those current elements, giving the stale alignment a `-75` delta and an incorrect result of `200`. Do not use disconnected pre-`setMode` elements.
   - Resolve the stale completion render first and assert the current scroller remains `275`, not `200`.
   - Resolve the unrelated render and assert its own restore also yields `275`.

6. **`aligns a real completion only after its own Markdown generation settles`**
   - Complete a real response with Markdown held.
   - Set scroller `scrollTop = 40`, scroller top `100`, and completed-response top `260`.
   - Assert no alignment before Markdown settles.
   - Resolve that render and assert `scrollTop === 200`.
   - This replaces the old private `responseStartRenderGeneration` assertion with the observable completion behavior.

- [ ] **Step 2: Run characterization and remove the six old equivalents**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts
```

Expected: all six pass on the fixed baseline.

Delete their private-prototype counterparts and run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts
```

Expected: all pass.

- [ ] **Step 3: Mutation-check M1**

Temporarily bypass the same-shape cached streaming update so the body is rebuilt on every delta.

Run:

```bash
npx vitest run tests/chat-view-public.test.ts -t "keeps an opened reasoning panel"
```

Expected RED: details/content identity changes, `open` becomes false, or scroll resets. Restore immediately and rerun; expected PASS.

- [ ] **Step 4: Mutation-check M12**

Temporarily remove or bypass only the outer `if (generation !== this.renderGeneration) return;` guard in `settleMarkdownRender`. Retain both `responseStartRenderGeneration = this.renderGeneration + 1` and the existing `boundGeneration === generation` completion check. The stale completion therefore passes the mutated outer guard and still qualifies as a completion render, producing the observable incorrect `200` jump on the current post-`setMode` geometry.

Run:

```bash
npx vitest run tests/chat-view-public.test.ts -t "unrelated render follows a completion"
```

Expected RED: the stale completion applies the response offset and the scroller becomes `200` instead of `275`. Restore immediately and rerun both completion tests; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/chat-view-public.test.ts tests/chat-view.test.ts
git commit -m "test: migrate streaming and scroll behavior to public seam"
```

---

### Task 5: Prove Dismissed Controls Through Real View Wiring

**Files:**
- Modify: `tests/chat-view-public.test.ts`
- Test only: `tests/chat-composer-controls.test.ts`
- Test only: `tests/chat-model-control.test.ts`

**Interfaces:**
- Consumes the real writing/model triggers, existing `Menu`/`MenuItem` mocks, public `refreshCapacityEstimate()`, and public `refreshModelControl()`.
- Produces no production interface.

- [ ] **Step 1: Add dismissed-menu and hide-before-click integration tests**

Add:

```ts
it.each(['writing', 'model'] as const)(
	'does not mutate dismissed %s menus through real view refreshes',
	async (surface) => {
		// Open the real view and the selected trigger's real menu.
		// Spy on a representative item's setChecked/setDisabled.
		// Hide the menu, clear spy history, and run the appropriate public refresh.
		// For model, change the plugin-double active provider before refreshModelControl.
		// Assert no mutation call on the hidden item and aria-expanded === 'false'.
	},
);

it('accepts a just-hidden writing menu item through real view wiring', async () => {
	// Open the writing menu, call menu.hide(), then activate 'Edit · Full note'.
	// Assert the real trigger becomes 'Edit · Full note' and no provider request occurs.
});
```

Use `view.refreshCapacityEstimate()` for the writing menu and `view.refreshModelControl()` for the model menu. Spying on host menu-item methods is permitted; reading the view’s private control fields is not.

- [ ] **Step 2: Run the public and focused-control suites**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts \
	tests/chat-composer-controls.test.ts tests/chat-model-control.test.ts
```

Expected: all pass. The two focused-control M10 tests remain unchanged.

- [ ] **Step 3: Mutation-check M10 and native activation**

Temporarily remove `activeMenu = null` from the writing/model `onHide` handlers.

Run:

```bash
npx vitest run tests/chat-view-public.test.ts -t "dismissed"
```

Expected RED: the hidden item receives a `setChecked` or `setDisabled` call during the real view refresh.

Restore immediately and rerun the dismissed and just-hidden tests; expected PASS. The activation test guards against “fixing” M10 by rejecting every hidden menu item.

- [ ] **Step 4: Commit**

```bash
git add tests/chat-view-public.test.ts
git commit -m "test: cover dismissed chat controls through real view wiring"
```

---

### Task 6: Deterministic Real-Obsidian Harness Evidence

**Files:**
- Ignored local only: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored local only if needed: `test_vault/emend-selection-chat-verify/mock-provider.mjs`

**Interfaces:** No production or committed test interface. Produce ignored scenario results and evidence for Task 7.

- [ ] **Step 1: Prepare the existing ignored harness**

Use the established synthetic vault, loopback SSE, CORS, dummy SecretStorage credentials, local Obsidian tools, and Track Changes installation. If the worktree lacks the ignored harness/tools, copy the three harness scripts from `/home/chang/Projects/obsidian-emend/test_vault/emend-selection-chat-verify/` and link the existing local tools/installations into the corresponding worktree paths. Add `--public-chat-view` with only scenarios 01 and 03 below. Do not add real stale-SSE or held-Markdown scenarios.

- [ ] **Step 2: Add scenario `01-failed-load-recovers-usable-chat`**

- Inject a one-shot rejection into `app.vault.adapter.read` for the synthetic note’s conversation-aggregate read, with `Error('Synthetic conversation read rejection')`.
- Restore the original adapter method immediately after that one rejection.
- This is a rejected load, not malformed conversation data; do not use malformed bytes or assert `.corrupt` behavior.
- Assert the exact load Notice, usable New chat, enabled New/Rename/Delete/Send controls, and a successful ordinary loopback submission.
- Assert exactly one provider request and valid ready user/assistant schema-3 persistence after the transient session materializes.
- Assert the injected read rejected exactly once and subsequent store operations use the restored adapter.

- [ ] **Step 3: Add scenario `03-dismissed-menu-hide-before-click-simulation`**

- Open the real writing/model menus and retain their item callbacks.
- Simulate host ordering deterministically by calling `menu.hide()` before invoking the selected item callback.
- Trigger capacity/model refreshes after dismissal and assert no dismissed item receives checked/disabled mutations.
- Invoke the just-hidden current item exactly once and assert exactly one writing/model choice.
- Name and document this as a CDP-driven hide-before-click simulation. It is not evidence of physical pointer input, native OS menu behavior, or macOS coverage.

- [ ] **Step 4: Run deterministic real-Obsidian verification**

Build first, then run:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --public-chat-view
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Expected:

- `--public-chat-view` runs scenarios 01 and 03 only.
- The existing stabilization run supplies real M1 reasoning-panel evidence.
- The sessions run supplies actual full-note/Selection modification, persistence, exact note bytes, and native-undo evidence.
- Stale stream generations and M12 completion-scroll races are public-unit evidence only in this PR.
- `loadedBundleMatchedRoot === true`.
- Record code head, bundle hash, Linux/Xvfb environment, Obsidian version evidence, scenario/assertion counts, and limitations. Do not claim physical input, native macOS menus, real providers, or other platforms.

Do not commit harness or evidence files.

---

### Task 7: Canonical Documentation and Final Gate

**Files:**
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ROADMAP.md`
- Create: `devel_docs/54-public-chat-view-test-seam.md`

**Interfaces:** Document the public signatures from Task 1 and fixture policy; produce no runtime interface.

- [ ] **Step 1: Run the complete unit migration check**

Run:

```bash
npx vitest run tests/chat-view-public.test.ts tests/chat-view.test.ts \
	tests/chat-composer-controls.test.ts tests/chat-model-control.test.ts
! rg -n 'EmendChatView\.prototype|Object\.setPrototypeOf|viewPrototype|productionSubmitPrompt|productionPersistMessages' \
	tests/chat-view-public.test.ts tests/helpers/chat-view-public-fixture.ts
```

Expected: all focused tests pass, no private-prototype access occurs in the public suite/fixture, and the branch has 18 migrated cases plus three net-new real-view menu cases. Record actual totals rather than copying planned arithmetic into evidence.

- [ ] **Step 2: Update canonical ownership documents**

In `AGENTS.md` testing guidance, require real view instances through public lifecycle/submission/session methods and DOM/provider/store boundaries, and prohibit new private-prototype retrofitting.

In `IMPLEMENTATION_PLAN.md`, add the public test-seam boundary under context/session architecture and Stage 54, `Public chat-view behavioral test seam`, to the numbered index. Do not move historical Stage 51 text.

In `ROADMAP.md`, add the public test seam to recently shipped status with the Stage 54 link, remove the completed #87 deferral, and keep #76 and unrelated deferrals unchanged.

Create Stage 54 with baseline/scope, the three visibility-only production changes, the 18-test migration list and remaining-legacy policy, characterization and restored-mutation RED/GREEN evidence, local gate results, deterministic real scenarios 01 and 03, existing stabilization/session evidence, head/bundle identity, screenshots where available, and environment limits. Explicitly state that the entire legacy file was not converted, no runtime behavior changed, scenario 03 is a hide-before-click simulation, and stale-stream/M12 coverage is public-unit/mutation evidence rather than real-Obsidian evidence.

Do not update `CHANGELOG.md`, package/version metadata, or user guides. Do not document malformed-byte `.corrupt` assertions, real stale-SSE/held-Markdown coverage, physical menu coverage, or native macOS coverage.

- [ ] **Step 3: Commit canonical documentation**

```bash
git add AGENTS.md IMPLEMENTATION_PLAN.md ROADMAP.md \
	devel_docs/54-public-chat-view-test-seam.md
git commit -m "docs: record public chat-view test seam"
```

Confirm `test_vault/`, `main.js`, source maps, and local settings remain untracked.

- [ ] **Step 4: Run the full local gate on the exact submitted head**

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit zero. Record actual test totals in Stage 54/PR evidence as appropriate; do not invent totals in advance. If the documentation commit changed the embedded build identity, rebuild and rerun the deterministic real-Obsidian commands so final smoke evidence matches the submitted head; distinguish earlier code-head results from final-head confirmation.

- [ ] **Step 5: Perform final scoped review**

Verify:

- `src/chat-view.ts` differs only by three `public` keywords and no focused-control production source changed.
- All 18 old cases have public equivalents and none remains duplicated or weakened.
- The fixture exposes shared settings/`AdditionalNotesStore` and supplies assigned `contentEl`, workspace events, vault naming, and scope.
- Automatic Selection is tested without an explicit target-menu choice.
- All session policy, Related-notes, and capacity observations are retained.
- The A → B → A stale test proves the old loading node is rendered before mutation.
- M12 uses current post-`setMode` geometry and the specified outer-guard mutation.
- No public test or fixture accesses private view state.
- No controller decomposition, version change, generated bundle, workflow edit, or vault file is included.
- No real stale-SSE or held-Markdown scenario is claimed, and documentation makes no real-provider, physical-input, screen-reader, native macOS, or non-Linux claim.

## Non-Goals

- Fixing H4, M1, M10, M12, or any other behavior again; they are already fixed on the baseline.
- Extracting the PR 05 modification controller or splitting `chat-view.ts`.
- Migrating every unrelated composer, model-selection, capacity, Web, additional-notes, or keyboard test.
- Adding test-only production setters/getters, render callbacks, state snapshots, dependency-injection constructors, or a new public controller API.
- Introducing JSDOM, another DOM library, a second provider stack, or any runtime dependency.
- Changing writers, edit-target selection, freshness, request serialization, persistence schemas, path privacy, menu behavior, CSS, or user-visible copy.
- Editing historical Stage 51 results.
- Version bumps, tags, releases, workflow changes, or Community Directory work.
- New real-Obsidian stale-SSE or held-Markdown race scenarios.
- Physical-pointer, native OS menu-ordering, macOS, or screen-reader claims from scenario 03.
- Malformed-byte fixtures as a substitute for H4’s rejected-load path.

## Decisions Left to Implementers

- Internal organization and TypeScript aliases inside the two test helpers, provided their public signatures remain as specified and no private view access is introduced.
- Exact fake-DOM animation-frame queue representation and selector implementation, provided existing legacy tests remain green.
- The exact local mechanism for installing and immediately restoring the one-shot adapter read rejection, provided it rejects only the target aggregate read and leaves subsequent persistence functional.
- The least invasive CDP implementation of scenario 03’s explicit `hide()`-then-callback simulation, provided its simulation limits are recorded and no production code changes are introduced.
- Cleanup of imports/helpers made unused by the explicit migrations only.

Any failing public characterization test that reveals a production behavior difference is a stop-and-report condition, not permission to include an unrelated fix in PR 01.
