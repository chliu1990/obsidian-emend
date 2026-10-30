# Stage 20: Operations-only editing and selection quick actions

## Goal

Make the validated closed JSON operation protocol the only model-facing editing protocol, remove the persisted strategy choice and CriticMarkup document/selection prompts, and reuse the three shared quick actions in the selection modal without creating another provider or write path. Preserve internal CriticMarkup validation, Track Changes output, stale/abort/permission guards, and native selection undo.

## Plan

1. Write failing factory, settings-normalization, prompt-surface, and selection-modal tests; verify the expected red runs before implementation.
2. Remove the CriticMarkup strategy object, model-facing CriticMarkup prompt builders, `EditStrategyId`, persisted `editStrategy`, and its settings selector. Make `getEditStrategy()` argument-free and always return `operationEditStrategy`; leave read-only prompts unchanged.
3. Render `QUICK_ACTIONS` in the selection modal and route each action through the existing `submit(prompt)` path. Share pending control state so exact single submission, disabled controls, settlement, cancellation, and failure behavior remain consistent.
4. Migrate existing coordinator/isolation fixtures to operation responses while retaining their original guard assertions. Run focused and full gates, then verify real Obsidian editing with an isolated vault, loopback mock, Track Changes, and dummy credentials.
5. Update current documentation, self-review, commit and push, verify `emend-macos-docker` through the tea API, and record implementation-run CI evidence separately.

## Implementation details

- `src/edit-strategy.ts` retains the shared `EditStrategy` boundary with the literal `operations` ID. `getEditStrategy()` takes no settings argument and always returns `operationEditStrategy`; the CriticMarkup strategy export is removed. `src/main.ts` uses that factory for both full-note and selection coordinators.
- `src/mode.ts` now exposes the shared system-prompt builder only for Ask, Discuss, and Brainstorm. Their prompt text and instruction ordering are unchanged. The full-note and selection CriticMarkup prompt builders are removed; operation prompts remain in `src/operation-edit-strategy.ts`.
- `src/types.ts` and `src/settings.ts` no longer define or persist `editStrategy`. Normalization drops legacy `critic-markup`, `operations`, and malformed values while retaining valid sibling settings. The **Edit strategy** selector is removed. No provider, context, or privacy setting changed.
- `src/selection-modal.ts` renders the shared `QUICK_ACTIONS` IDs, labels, and exact prompts. Every click calls the existing `submit(prompt)` method; typed instructions still call the same method with no explicit prompt argument. A shared pending helper disables the textarea, normal submit button, and all quick actions. The existing active-controller guard rejects duplicates. Settlement clears the controller and restores controls when the modal remains open; success closes it and failures leave it available for retry.
- `src/critic-markup.ts`, `src/operation-edit-strategy.ts`, `src/note-writer.ts`, `src/selection-editor.ts`, and `src/request-coordinator.ts` are unchanged. Operations still compile into CriticMarkup, pass Stage 07 revalidation, and use the same stale-source, active-target, abort, permission, single-write, and native editor-range guards.
- Existing CriticMarkup engine tests remain. Removed strategy tests were replaced with internal preparation-contract coverage; coordinator, sequential-edit, request-isolation, selection, and unload fixtures now return bare JSON operations while preserving their original behavior assertions.

## Test-first and automated verification

- Operations-only RED: `npx vitest run tests/operation-edit-strategy.test.ts tests/settings.test.ts tests/mode.test.ts` produced **12 failed, 108 passed** across 120 tests. Failures were the old strategy export, required factory argument, persisted/default strategy field, retained legacy settings, and CriticMarkup selection prompt export. Read-only and operation validation tests remained green.
- Operations-only GREEN: the same command passed **120/120** after the minimal wiring removal.
- Selection-action RED: `npx vitest run tests/selection-modal.test.ts` produced **5/5 expected failures** because none of the three quick-action buttons existed.
- The first green attempt exposed a test helper that bypassed class-field initialization and stale selection fixtures that still injected the deleted strategy. The helper was changed to use the real modal constructor and fixtures were migrated to Operations; no production guard was weakened.
- Selection-action GREEN: `npx vitest run tests/selection-modal.test.ts tests/selection-editor.test.ts tests/operation-edit-strategy.test.ts` passed **117/117**, covering exact prompts, no typed input, duplicate-click rejection, pending disabled controls, settlement re-enabling, and provider/validation failures with no editor read or replacement.
- Final full gate: `npm test && npm run build && npm run lint && git diff --check` passed with **21 test files and 414 tests**, strict TypeScript checking, production esbuild, no lint findings, and no whitespace errors.

## Real Obsidian and local-mock verification

- Environment: production Emend bundle in ignored `test_vault/stage20_vault`, isolated profile `test_vault/.emend-test-profile-20`, real Obsidian on macOS with `navigator.userAgent` reporting `obsidian/1.11.7`, CDP 9334, Track Changes 2.3.0, and a CORS-enabled loopback SSE mock at `http://127.0.0.1:8799/v1`. All credentials were dummy values. No real account, paid request, or other vault was used. Only these isolated processes were stopped afterward.
- Actual command: `node test_vault/cdp-eval-20.mjs test_vault/stage20-scenarios.js`, followed by `node test_vault/verify-stage20.mjs`. The verifier passed **6 actual requests**, **3 selection actions**, **6 freshly rebuilt Track Changes panels**, **2 invalid/no-write cases**, old-settings normalization, selector absence, and persisted native undo.
- Every mock request had an operation-only system prompt containing `bare JSON array`; none contained the removed `Return the COMPLETE note with every requested change marked using CriticMarkup` instruction. Full-note Edit produced exactly `Alpha {~~beta~>OPERATION_FULL~~} gamma.` and one live replacement card.
- Actual modal clicks for Fix grammar, Make concise, and Add examples each started with three enabled buttons and an empty textarea. During every pending request all actions, the textarea, and **Modify selection** were disabled. A second click on the disabled action caused no additional request. Each exact shared prompt appeared exactly once for its fixture, and each successful modal closed after one guarded native replacement.
- Resulting editor and persisted Markdown matched exactly: `This sentence {~~have~>has~~} a small grammar problem.`, `{~~This is a sentence that is unnecessarily very long.~>This sentence is too long.~~}`, and `Emend validates edits.{++ For example, invalid operations leave the source unchanged.++}`. Their live panels showed the corresponding replacement, replacement, and insertion card.
- Native `editor.undo()` after the grammar edit restored both editor and persisted Markdown to exactly `This sentence have a small grammar problem.` after an explicit view save.
- Malformed full-note output returned `Operation edit response must be a bare JSON array.` and left `InvalidFull20.md` as `Alpha beta gamma.`. Malformed selection output left `SelectionInvalid20.md` as `INVALID_TARGET must remain unchanged.` and re-enabled all modal controls. Both live panels showed `0 comments · 0 suggestions`.
- The fixture initially contained `editStrategy: "critic-markup"`. Real plugin loading removed it from in-memory settings, saving removed it from `data.json`, and the actual Emend settings tab listed provider, mode, privacy, and context controls but no **Edit strategy** item.
- Initial harness attempts exposed an auxiliary restored Settings window and editor-autosave timing; the CDP target, window setup, and explicit view-save evidence capture were corrected before the final clean run. These were harness issues, not production failures. All scripts, fixtures, profiles, logs, copied bundles, and dummy settings remain ignored under `test_vault/`.

## Self-review

- Operations are the only model-facing edit protocol. No runtime CriticMarkup strategy object, CriticMarkup full/selection prompt builder, strategy setting, or selector remains; read-only prompt text is unchanged.
- Internal CriticMarkup parsing/reject-view/sequential validation and Track Changes compilation are preserved. No write guard, provider transport, permission contract, storage schema, command ID, or quick-action prompt changed.
- Selection actions reuse the existing modal submission callback and active-controller guard. They add no provider, history, persistence, or writer path, and pending/failure behavior is covered by unit and real UI checks.
- Current `README.md`, `QUICK_START.md`, `AGENTS.md`, and `IMPLEMENTATION_PLAN.md` describe the Operations-only contract and selection actions. Historical stage records retain their original opt-in/default descriptions as evidence of earlier behavior.
- No generated bundle, vault/profile content, request log, credential, dependency, or other ignored file is intended for git. No implementation or verification blocker was found. Independent task-review approval, if required by the parent workflow, remains separate from this self-review.

## Implementation-run CI evidence

Implementation commit `c8e2a274e32e4b55756d3d5c869822414cdde96c` was pushed on `feat/emend-rewrite`. Gitea push run 97 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/97 and job 119 completed with conclusion **success** on `emend-macos-docker` from 15:42:58Z through 15:43:22Z. All run, job, and log details were retrieved through `tea api`. Checkout reached `HEAD is now at c8e2a27`; Node/npm verification, clean `npm ci`, lint, all **414 tests in 21 files**, and the production build succeeded.
