# Stage 03: Deterministic modes, prompts, and permissions

## Goal

Add the domain contracts for explicit Ask, Edit, Discuss, and Brainstorm modes, deterministic code-level note-write permission, CriticMarkup editing prompts, and ordered instruction sections without changing the legacy runtime.

## Plan

1. Write focused tests for mode metadata, message and provider-history types, note-write permission, base and selection prompts, CriticMarkup requirements, and instruction ordering.
2. Run the focused tests against the missing domain modules and capture the expected red result.
3. Add shared domain types, the mode catalog and prompt builders, and a permission predicate that allows writes only for Edit.
4. Run focused green tests and the full local gate, then self-review the diff for scope, strict typing, and unintended runtime changes.
5. Commit and push the implementation, verify Gitea Actions on `emend-macos-docker`, and record the implementation and documentation-evidence runs.

## Implementation details

- Added `Mode`, `AiMessage`, `ProviderHistoryMessage`, and `InstructionPromptParts` to `src/types.ts`; `EmendSettings.defaultMode` now reuses `Mode`. Provider history contains only `role` and `content`, while chat messages additionally carry their explicit mode.
- Added the four-entry `MODES` catalog in `src/mode.ts` with unique IDs, labels, and Obsidian icons. Ask, Discuss, and Brainstorm prompts forbid note writes and direct responses to chat.
- Edit prompts require the complete note with CriticMarkup insertions, deletions, substitutions, comments, and highlights. Selection prompts request only the modified selected portion. Both preserve Markdown structures, existing CriticMarkup, and the note's language and forbid surrounding prose or code fences.
- Prompt assembly trims instruction content, preserves skill discovery order under `=== Loaded Skills ===`, places `=== Agent Instructions ===` last, and omits empty sections.
- Added `canWriteToNote()` in `src/permissions.ts`; its only allowed case is `mode === 'edit'`. This stage adds no write calls and does not wire the new domain API into chat, providers, or the legacy diff flow.

## Verification results

- Red: `npx vitest run tests/mode.test.ts tests/permissions.test.ts` failed both suites because `src/mode.ts` and `src/permissions.ts` did not yet exist. No tests ran in this expected missing-feature red state.
- Green: the same focused command passed 2 files and 14 tests after implementation.
- Full local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed. Vitest reports 3 files and 27 tests passed; lint produced no findings; the build includes strict TypeScript checking and production bundling.
- Self-review: the diff is limited to the requested domain types, mode/prompt and permission modules, focused tests, and this stage record. No legacy runtime/chat/provider file, dependency, generated bundle, vault data, or secret was changed. No Obsidian UI or real-provider test is applicable to this domain-only stage.
- Implementation commit `a48bb955e1555978098ce08f87d33daed3053362`: Gitea run 21 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/21 and job 30 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/21/jobs/30 completed with conclusion **success** on `emend-macos-docker`. Checkout, setup-node, `npm ci`, lint, test, and build all succeeded.
- Documentation-evidence CI: pending.
