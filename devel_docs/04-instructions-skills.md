# Stage 04: Load vault instructions and discover skills safely

## Goal

Load only vault-root `AGENTS.md` and directly referenced Markdown skills beneath vault-root `skills/`, with deterministic ordering and strict path rejection, without changing the legacy runtime.

## Plan

1. Write focused parser tests for inline-code and Markdown-link references, directory and explicit-file forms, normalization, ordering, deduplication, and unsafe or non-Markdown references.
2. Write loader tests for missing files, sequential reads, trimmed content, `TFile` checks, repeated loading, and non-recursive discovery.
3. Run the focused suite against the missing module and capture the expected red result before implementation.
4. Implement direct vault lookups and sequential reads without vault scans or caches, then run focused green tests and the full local gate.
5. Self-review the diff, commit and push the implementation, verify Gitea Actions on `emend-macos-docker`, and record the implementation and documentation-evidence runs.

## Implementation details

- Added `LoadedInstructions`, structurally compatible with Stage 03's `InstructionPromptParts`, plus `extractSkillPaths()` and `loadAllInstructions()` in `src/instructions-loader.ts`.
- Skill discovery accepts inline-code spans and Markdown link targets in source order. Repeated slashes and one trailing slash are normalized; directory references append `SKILL.md`, while explicit `.md` files load directly. Normalized duplicates are skipped.
- Absolute paths, URL schemes, backslashes, traversal or current-directory segments, paths outside vault-root `skills/`, and non-Markdown file references are rejected rather than sanitized into alternate targets.
- The loader reads only `AGENTS.md` as the instruction entry point. It uses exact `getAbstractFileByPath()` lookups, checks `instanceof TFile`, reads discovered skills sequentially, trims skill content, and silently skips missing entries.
- No content or path cache is retained, so each call observes current root and skill content. Skill content is never parsed for further references. No `getMarkdownFiles()` or other vault scan is used.
- This stage adds no legacy request-flow wiring, UI, dependency, automatic background request, or vault write.

## Verification results

- Red: `npx vitest run tests/instructions-loader.test.ts` failed because `src/instructions-loader.ts` did not yet exist. The expected missing-feature red state ran no tests.
- Green: the same focused command passed 1 file and 18 tests after implementation; it still passes after test-only lint cleanup.
- Full local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed. Vitest reports 4 files and 45 tests passed; lint produced no findings; the build includes strict TypeScript checking and production bundling.
- Self-review: the diff is limited to the requested loader, focused tests, and this stage record. No legacy runtime/chat/provider file, dependency, generated bundle, vault data, or secret was changed. No Obsidian UI or real-provider test is applicable to this domain-only stage.
- Implementation commit `fd91d172ff157941e64dea82386d2a024804e248`: Gitea run 24 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/24 and job 33 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/24/jobs/33 completed with conclusion **success** on `emend-macos-docker`. Checkout, setup-node, `npm ci`, lint, test, and build all succeeded.
- Documentation-evidence CI: pending.
