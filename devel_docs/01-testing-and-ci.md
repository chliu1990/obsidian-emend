# Stage 01: Testing and CI

## Goal

Establish a reproducible unit-test harness, a Gitea Actions workflow, and durable stage records without changing plugin runtime behavior.

## Plan

1. Preserve the user-authored planning documents in a baseline commit and create `feat/emend-rewrite`.
2. Write settings-normalization tests before adding the test harness and observe the missing-script failure.
3. Add Vitest with an aliased Obsidian mock, include tests in typed linting and TypeScript checks, and add the Gitea workflow.
4. Register a Docker Desktop-backed repository runner and verify local and hosted checks.
5. Record actual results, then commit and push the implementation and any later CI-evidence documentation.

## Implementation details

- Baseline commit `c6e49c9` (`docs: define Emend rewrite`) preserved `AGENTS.md`, `LICENSE`, `README.md`, and `IMPLEMENTATION_PLAN.md`; branch `feat/emend-rewrite` was created from it.
- Added `npm test` (`vitest run`) and `npm run test:watch` (`vitest`). Vitest 4 with Vite 7 is used because the current Vite 8 peer range conflicts with the project's pinned esbuild 0.25.5. No runtime dependency was added.
- Configured `tests/**/*.test.ts`, the Node environment, cleared mocks, and an `obsidian` alias to `tests/mocks/obsidian.ts`. Tests and `vitest.config.ts` are included in `tsconfig.json`; coverage output is ignored by Git and ESLint.
- Added tests for `normalizeSettings(null)` returning current defaults and a persisted numeric context limit surviving normalization. Production source behavior was not changed.
- Added `.gitea/workflows/ci.yaml` with Node 24 and the ordered `npm ci`, lint, test, and build checks.
- Repository runner query returned no registered runners. Docker Desktop was not available: neither its standard application paths nor Spotlight found it, and both Docker Desktop and Colima contexts had no running daemon. No alternative container stack was started and no registration token was requested.
- Status: **blocked at runner registration and hosted CI verification**. The local implementation is committed, but the branch has not been pushed and no Gitea workflow run has been triggered.

## Verification results

- Red: `npm test` before the harness failed with npm's `Missing script: "test"` error, as expected.
- Green: `npm test` passed with Vitest 4.1.12: 1 test file and 2 tests passed.
- `npm run lint` passed with no errors or warnings after correcting harness-only lint findings.
- `npm run build` passed, including strict TypeScript checking and the production esbuild bundle.
- `git diff --check` passed.
- `tea api repos/cliu/obsidian-emend/actions/runners --login mygitea` returned `{"runners":[],"total_count":0}`.
- Hosted CI was not run because Docker Desktop is unavailable. Runner state, Gitea run URLs, and hosted conclusions remain unverified rather than assumed successful.
