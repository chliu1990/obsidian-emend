# Stage 55: Resolved edit-target flow and pure target lookup

## Status, scope, and exclusions

Implemented on `feature/2.11-pr02-edit-target-flow` from base `8adbc7729469881b6bdeb245fa1b817bb71de6df`. The code head for the implementation, complete unit gate, and real-Obsidian evidence in this record is `f6c10f43a52474e7d87154f5e5b862af0e4ccf19`.

This behavior-preserving refactor resolves [#78](https://github.com/chliu1990/obsidian-emend/issues/78). It replaces parallel Edit-target choice/display fields with one maintained resolved state, retains one synchronous captured submission identity, and makes Markdown target lookup read-only. Existing menus, notices, drafts, capacity formulas, context policies, session behavior, persistence, request coordination, writers, and freshness checks remain unchanged. The current editing guide already describes these behaviors, so no user-guide change was needed.

The implementation commits are:

| Commit | Subject | Scope |
| --- | --- | --- |
| `176427b` | `refactor: add maintained edit target state` | Pure `EditTargetState` resolution and refresh operations. |
| `51dc7d6` | `refactor: make Markdown target lookup pure` | Read-only target lookup and explicit lifecycle ownership tests. |
| `1b609e7` | `test: assert exact stale target error` | Anchored wrong-target error assertion; test only. |
| `f6c10f4` | `refactor: unify edit target display and capture` | Single view state, public migration, and mechanically equivalent legacy fixtures. |

Explicit exclusions are [#76](https://github.com/chliu1990/obsidian-emend/issues/76) controller extraction or broader `chat-view.ts` decomposition, [#77](https://github.com/chliu1990/obsidian-emend/issues/77) freshness-contract redesign, [#79](https://github.com/chliu1990/obsidian-emend/issues/79) scanner consolidation, unrelated legacy-test migration, new user-facing behavior, new writers or providers, dependencies, version metadata, release workflows, and generated or vault artifacts. Full-note and Selection freshness contracts were not unified.

## Maintained target and one-time capture

`src/edit-target.ts` owns the discriminated readonly `EditTargetState`:

```ts
export type EditTargetState =
	| { readonly choice: 'auto'; readonly resolved: ResolvedEditTarget }
	| { readonly choice: 'full-note'; readonly resolved: 'full-note' }
	| { readonly choice: 'selection'; readonly resolved: 'selection' };
```

`resolveEditTargetState(choice, hasUsableSelection)` resolves automatic targeting to Selection only when usable Selection exists, otherwise to Full note. Explicit Full-note and Selection states retain their resolution regardless of availability. `refreshEditTargetState` returns a newly resolved state for automatic targeting and returns an explicit state object unchanged. The former `resolveEditTarget` helper was removed, leaving no second resolution flow.

`src/chat-view.ts` owns one `private editTarget: EditTargetState`, initialized as automatic Full note without host I/O. Writing-menu choices resolve once. Display state, draft/action capacity, quick-action capacity, and submission all consume `this.editTarget.resolved`.

- Same-note target/capacity refreshes call `refreshEditTargetState` before the no-composer early return, so maintenance does not depend on a composer control existing.
- Only a real note change resets targeting to automatic. The controller-approved implementation resets to automatic Full note without an eager Selection lookup; the normal real-view render then performs the maintained refresh against current Selection availability. This preserves the prior lazy behavior.
- Same-note session switches and Chat/Edit switches do not reset the target state. Automatic same-note refreshes may change its resolved availability without changing its automatic choice.

The existing `CapturedDraftTarget` discriminated union remains the submission identity. Its Full-note `RequestContext` or Selection `SelectionEditTarget` is captured synchronously once before the initial save, and later awaits reuse that captured object rather than resolving again. Source-path checks, additional-note capture, coordinator calls, and writer signatures are unchanged.

Explicit Selection remains Selection across refreshes. If explicit or maintained automatic Selection vanishes before capture, submission fails with `Select non-whitespace text first.` before messages, requests, saves, or writes; neither case silently falls back to Full note. A later automatic Full-note submission is valid only after a maintained automatic refresh has actually resolved Full note.

## Pure Markdown lookup and separate writer contracts

`getTargetMarkdownView()` retains its precedence without assigning last-active state:

1. active Markdown view;
2. explicitly remembered view if still open;
3. first open Markdown view found by leaf iteration;
4. `null`.

The first-open result is a local read result, not a new remembered target. `rememberActiveMarkdownView()` is the sole updater, called at load and by the existing `active-leaf-change`, `file-open`, and rename-driven refresh path. Repeated target reads cannot replace explicit lifecycle memory.

Full-note Edit still uses only guarded `vault.modify` after exact disk and every-open-editor freshness, active-target, abort, and permission checks. Selection Edit and Modify Selection still use only native `editor.replaceRange` on the captured range after their captured-editor source, active-target, abort, and permission checks. Target-state unification did not alter either writer or merge their different freshness contracts.

## Public fixture and exact migration inventory

The shared public fixture gained only:

- `setSelectedText(text: string): void`;
- `emitWorkspaceEvent(name: 'editor-change' | 'editor-selection-change'): void`.

Selection offsets are recomputed per capture and availability is dynamic. Empty, whitespace-only, collapsed, or missing Selection capture throws `Select non-whitespace text first.`. The fixture exposes no view state. Public tests use real `EmendChatView` instances and public lifecycle, submission, session, target, refresh, DOM, provider, store, and host-event boundaries, without private-prototype access, private-field casts, hand-built public-view contexts, or test-only production accessors.

Thirty parameterized public rows preserve the following 25 named legacy cases:

1. `applies %s atomically with one render and capacity calculation`
2. `applies $title atomically with its targeting policy`
3. `retains the explicit target and maintained Web choice through Edit and Chat`
4. `retains Chat and Edit targeting policies across unrelated writing and mode choices`
5. `rejects stale menu and submission callbacks after rerender and close`
6. `blocks submissions and duplicate choices during a deferred save without rerendering`
7. `initially displays Selection when automatic targeting has usable text`
8. `initially displays Full note for an empty or whitespace selection: %j`
9. `preserves explicit $choice targeting across renders and Chat/Edit switches`
10. `resets to auto only for real note changes while preserving per-note drafts`
11. `updates automatic Selection-first targeting without replacing composer DOM or reloading chat`
12. `keeps Related notes available in Chat and enables every quick action in Edit`
13. `changes target state without requests or content reads and preserves the draft`
14. `synchronizes Edit controls after quick-action Selection capture fails and preserves the draft`
15. `formats full-note summaries against the captured note source`
16. `renders a full-note summary with no bullets`
17. `keeps explicit Full note on the ordinary request despite a usable selection`
18. `fails closed without messages, saves, or fallback when %s Selection capture fails`
19. `aborts Chat Selection on a note switch and resets all target policies`
20. `uses the complete full-note source instead of the bounded Markdown window`
21. `uses the captured Selection snapshot and updates when the Edit target changes`
22. `keeps small Selection quick actions enabled while the full note is over capacity`
23. `refreshes the automatic Edit target when the selection appears`
24. `captures the selection and additional-note paths before a deferred initial save`
25. `aborts the captured selection request on a note switch without saving it to the new thread`

Two new public rows reject captured Full-note and Selection source-path mismatches before messages or saves. With the existing 21 public cases, the final public file has **53 tests**: 21 existing + 30 migrated rows + 2 new rows. The named legacy cases were removed from `tests/chat-view.test.ts`, which retains **230** unrelated legacy tests. That file was not wholesale migrated; its remaining cases are legacy coverage, not a pattern for new work. Later work must migrate any legacy case it touches to the public seam.

### Controller-approved mechanical fixture scope

The initial full suite exposed stale hand-built contexts after the old fields were removed. The controller explicitly authorized mechanical updates to three additional legacy files and retained the lazy note-reset design rather than adding production compatibility fallbacks or moving the maintained refresh behind the composer guard.

- `tests/quick-actions.test.ts`: ordinary submission received automatic Full-note state, preserving its old implicit Full-note behavior; the visible-Selection context replaced its old displayed Selection with automatic Selection state.
- `tests/request-isolation.test.ts`: sequential Full-note edits and the refused-session-switch case received automatic Full-note state; the composer-originated Selection lock case received automatic Selection state.
- `tests/main.test.ts`: three partial plugin doubles received `hasUsableSelection: () => false`, preserving their implicit Full-note setup without invoking an incomplete workspace mock during maintained refresh.

No test body or assertion in those three files changed, and no additional case migrated. Shared legacy fixtures in `tests/chat-view.test.ts` received only equivalent initial `EditTargetState` values. Public-test lint cleanup typed captured results and added one narrow unbound-method suppression for an inspected adapter mock; it did not remove or weaken assertions.

## Characterization, genuine RED, and restored mutations

The public behavior characterizations passed against unchanged old production code: **53/53 tests**. Earlier characterization failures were fixture-timing or mock assumptions, not user-facing behavior discrepancies. No production defect was found during the refactor or real-Obsidian work.

| Area | RED evidence | Restored or implemented GREEN |
| --- | --- | --- |
| Pure state operations | With the new tests and no exports, `npx vitest run tests/edit-target.test.ts` failed **12/12** because `resolveEditTargetState` and `refreshEditTargetState` were absent. | The focused file passed **12/12** after implementation and again after a type-only branch correction. |
| Lookup purity | On old production, `npx vitest run tests/main.test.ts -t "target"` produced **1 failed / 8 passed / 32 skipped**. Repeated active-B reads overwrote remembered A, so chat-focus lookup incorrectly returned B. | After deleting getter assignments, the same target filter passed **9 tests / 32 skipped**. |
| Explicit lifecycle ownership | Temporarily removing only `rememberActiveMarkdownView()` from the shared lifecycle callback made both non-active target tests fail: **2 failed / 39 skipped**. | Restoring the call immediately passed **2 tests / 39 skipped**; the mutation was never committed. |
| Vanished automatic Selection | Temporarily recomputing submission targeting from current availability instead of maintained display state caused the automatic vanished-Selection case to reach Full-note routing: **1 failed / 1 passed / 51 skipped**. The explicit Selection row still failed closed. | Restoring the old branch passed **2 tests / 51 skipped** before the planned refactor; the mutation was never committed. |

The restored-mutation runs prove detection of the targeted drift; they are not claims that those mutations shipped.

## Unit and full-gate evidence through Task 3

Dependencies were already installed and the lockfile was unchanged, so `npm ci` was omitted under the repository rule.

Task 1's final full gate passed **54 files / 1,887 tests**, lint, strict TypeScript/production build, and `git diff --check`.

Task 2's target-focused run passed **9 tests**, and its writer/lookup run passed **3 files / 130 tests** across `tests/main.test.ts`, unchanged `tests/note-writer.test.ts`, and unchanged `tests/selection-editor.test.ts`. This included existing wrong-target, target-view-switch, stale-source, and immediate/pending-read abort cases. Task 2's final full gate passed **54 files / 1,892 tests**, lint, build, and diff check. Its later exact-error assertion fix passed `tests/main.test.ts` **41/41** without a production change.

At Task 3 code head `f6c10f43a52474e7d87154f5e5b862af0e4ccf19`, final focused verification passed:

```text
npx vitest run tests/edit-target.test.ts tests/chat-view-public.test.ts tests/chat-view.test.ts
Test Files  3 passed (3)
Tests       295 passed (295)

npx vitest run tests/quick-actions.test.ts tests/request-isolation.test.ts tests/main.test.ts
Test Files  3 passed (3)
Tests       82 passed (82)
```

The 295 tests comprise 12 edit-target + 53 public + 230 legacy. The separate public run passed **53/53**. Strict `npx tsc -noEmit -skipLibCheck` and focused ESLint passed. Searches found no old target fields in the refactored view/legacy target fixtures, no prohibited private-prototype mechanisms in the public suite/fixture, and no remaining `resolveEditTarget` helper references.

The final full gate at that code head passed:

- `npm test`: **54 files / 1,894 tests**;
- `npm run lint`: passed;
- `npm run build`: strict TypeScript checking and production esbuild passed;
- `git diff --check`: passed.

## Real-Obsidian evidence at code head

Task 4 built this worktree's production bundle and ran the ignored synthetic-vault harness at code head `f6c10f43a52474e7d87154f5e5b862af0e4ccf19`. It did not change production source, committed tests, mock-provider behavior, version metadata, or workflows. Existing ignored probes were mechanically migrated from `displayedEditTarget` to `editTarget.resolved` and `editTargetChoice` to `editTarget.choice` before the groups ran.

| Harness group | Scenarios | Assertions |
| --- | ---: | ---: |
| `--edit-target-flow` | 5 passed, 0 failed | 95 |
| `--sessions` | 9 passed, 0 failed | 156 |
| `--stabilization` | 6 passed, 0 failed | 55 |
| **Total** | **20 passed, 0 failed** | **306** |

Every final summary recorded head `f6c10f43a52474e7d87154f5e5b862af0e4ccf19`, bundle SHA-256 `fe60c60c538930ce1ac1bfc86938ae8d699c8f28e8df9c33689f2c45e054da2a`, and `loadedBundleMatchedRoot: true`. Independent root and loaded `main.js` hashes were both:

```text
fe60c60c538930ce1ac1bfc86938ae8d699c8f28e8df9c33689f2c45e054da2a
```

Each group setup also asserted root/loaded identity before launch. Task 4's build and `git diff --check` passed. Harness-development failures were diagnosed as unsupported host calls, incorrect prompt/selection/shared-editor assumptions, or missing maintained refresh driving; none was used as final evidence or required a production fix.

### Focused scenarios

`01-note-session-mode-target-state` passed **18 assertions**. Explicit target and mode survived Chat/Edit and same-note session transitions with exact per-session drafts. Real note changes reset automatic targeting and resolved current Selection availability, while per-note drafts and active sessions restored independently. Control-only transitions made no provider requests, content reads, or writes and retained exact bytes.

`02-popout-automatic-selection-native-undo` passed **15 assertions**. A real Markdown leaf in an Obsidian popout remained the non-active target while chat had focus. Automatic Selection sent the complete multiline Selection with Default Smart context, used native offsets **37–72**, made no guarded vault write, produced concise Selection results, and restored exact native undo/redo bytes.

`03-vanished-selection-fail-closed` passed **17 assertions**. Automatic maintained Selection and explicit Selection independently failed before messages, provider requests, thread/save, or writes after their Selection vanished. Neither fell back to Full note. A subsequent intentional Full-note request occurred only after a real note reset and maintained automatic refresh resolved Full note; only that successful exchange persisted.

`04-wrong-target-stale-abort` passed **22 assertions**. Real Full-note and Selection A-to-B wrong-target guards returned the exact stale-note error without rerouting, correction, result/save, or persisted note changes. Selection stale-source rejection preserved the synthetic user edit; Stop and note-switch followed by late SSE release produced no late writes or stopped assistant persistence and did not create a B thread.

The Full-note wrong-target probe explicitly asserted zero instrumented guarded vault calls for A and zero native replacements for A/B. **It did not separately query B's vault-modify log.** Exact A and B bytes were asserted unchanged, so no B modification persisted, but the instrumentation alone must not be described as proving zero B-side vault calls.

`05-full-note-versus-native-selection-routing` passed **23 assertions**. Explicit Full note despite live Selection used the complete note and exactly one guarded vault write with no native replacement. Automatic Selection with Default Smart and explicit Selection with full-note supporting context used only native replacement at their captured ranges, retained Selection as the sole edit target, and restored exact native undo/redo bytes. All three requests were single-round and advertised no Web tools.

The existing sessions group covered session/draft/history isolation, reload sanitization and schema handling, pending locks and aborts, native undo, capacity, Web/privacy, and narrow keyboard behavior. The stabilization group covered Selection inside existing markup, typing during a Full-note request, unbalanced fence payloads, reasoning streaming, multi-pane freshness, and rename repointing. Their historical scope is not redefined here.

### Preserved ignored evidence

Task 4's summaries and screenshots are under ignored paths:

- `test_vault/emend-selection-chat-verify/evidence-task4/edit-target-flow/summary.json`;
- `test_vault/emend-selection-chat-verify/evidence-task4/sessions/summary.json`;
- `test_vault/emend-selection-chat-verify/evidence-task4/stabilization/summary.json`.

The focused directory contains the five scenario screenshots and request/writer/native logs. Generated harnesses, evidence, synthetic vault content, local settings, and bundles were not committed or tracked.

## Environment and evidence limits

- Platform: Linux `x86_64`, Debian kernel `6.12.117+deb13-amd64`; official Obsidian **1.15.0** AppImage; isolated Xvfb `:101`; CDP port `19224`.
- Theme: default Obsidian dark theme. Light/Moonstone and third-party themes were not exercised in this matrix.
- Input: real DOM/workspace actions and CDP-dispatched events. No physical OS-level keyboard, pointer, or window-manager input was exercised. Popout evidence covers the exercised Markdown-leaf flow, not every window-manager or multi-monitor edge case.
- Provider: loopback OpenAI-compatible SSE/CORS at `127.0.0.1:18766`, deterministic synthetic Operations/responses, and a dummy SecretStorage credential. No real account, real credential, external network, paid call, or real-provider behavior is claimed.
- Preserved request/evidence audits found no credential, authorization header, request headers, or API-key fields. Notes were synthetic; path sharing remained off except for the pre-existing synthetic stabilization rename scenario.
- Native undo/redo was exercised in the actual Obsidian editor for the popout and Selection context-policy scenarios.
- No screen reader/assistive technology, mobile, Windows, macOS, other Obsidian versions, exact tokenizer, or unexercised popout-edge coverage is claimed. Unit evidence uses Obsidian mocks and does not replace those environment boundaries.

This record intentionally contains **code-head** evidence from Tasks 1–4. The canonical-documentation commit changes the embedded build identity. Task 6 owns the ultimate exact-head clean gate, rebuilt real-Obsidian rerun, and resulting bundle identity; no final documentation-head runtime result is claimed in this stage record.
