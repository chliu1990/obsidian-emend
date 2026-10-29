# Stage 01: Testing and CI

## Goal

Establish a reproducible unit-test harness, a Gitea Actions workflow, and durable stage records without changing plugin runtime behavior.

## Plan

1. Preserve the user-authored planning documents in a baseline commit and create `feat/emend-rewrite`.
2. Write settings-normalization tests before adding the test harness and observe the missing-script failure.
3. Add Vitest with an aliased Obsidian mock, include tests in typed linting and TypeScript checks, and add the Gitea workflow.
4. Register a dedicated Docker-backed repository runner using the existing Colima runtime and verify local and hosted checks.
5. Record actual results, then commit and push the implementation and any later CI-evidence documentation.

## Implementation details

- Baseline commit `c6e49c9` (`docs: define Emend rewrite`) preserved `AGENTS.md`, `LICENSE`, `README.md`, and `IMPLEMENTATION_PLAN.md`; branch `feat/emend-rewrite` was created from it.
- Added `npm test` (`vitest run`) and `npm run test:watch` (`vitest`). Vitest 4 with Vite 7 is used because the current Vite 8 peer range conflicts with the project's pinned esbuild 0.25.5. No runtime dependency was added.
- Configured `tests/**/*.test.ts`, the Node environment, cleared mocks, and an `obsidian` alias to `tests/mocks/obsidian.ts`. Tests and `vitest.config.ts` are included in `tsconfig.json`; coverage output is ignored by Git and ESLint.
- Added tests for `normalizeSettings(null)` returning current defaults and a persisted numeric context limit surviving normalization. Production source behavior was not changed.
- Added `.gitea/workflows/ci.yaml` with Node 24 and the ordered `npm ci`, lint, test, and build checks.
- Started the existing Colima runtime and verified Docker server 27.4.0. Registered `emend-macos-docker` as repository runner id 7 with the unique `emend-macos` label mapped to `docker://catthehacker/ubuntu:act-24.04`; the workflow targets that label so jobs cannot be claimed by `nv3060`.
- Registration tokens were obtained through the authenticated `tea` API, exposed only to the runner process environment, and never written to repository files or documentation. Reconfiguration was limited to the local runner container, its data volume, and its old repository registration.
- The exact ARM64 act image was digest-verified and loaded locally after external registry failures. To make repeated CI practical on the slow external network, the local image also contains the official Node 24.22.1 ARM64 tool cache; `actions/setup-node` confirmed the cache hit.
- Implementation commit `b16f098` introduced the harness and workflow. CI-routing fix commit `4834b3c` selected the dedicated runner and updated contributor guidance.

## Verification results

- Red: `npm test` before the harness failed with npm's `Missing script: "test"` error, as expected.
- Green: `npm test` passed with Vitest 4.1.12: 1 test file and 2 tests passed.
- `npm run lint` passed with no errors or warnings after correcting harness-only lint findings.
- `npm run build` passed, including strict TypeScript checking and the production esbuild bundle.
- `npm ci` and `git diff --check` passed locally.
- `tea api repos/cliu/obsidian-emend/actions/runners --login mygitea` confirmed runner id 7 named `emend-macos-docker`, online, with label `emend-macos`.
- The initial `b16f098` runs on `nv3060` failed and are not acceptance evidence. CI-fix attempt 1 on the dedicated runner also failed before checkout when Docker Hub returned EOF while pulling the act image; attempt 2 was intentionally interrupted to seed the persistent Node tool cache.
- CI-fix attempt 3, job 16, completed with **success** on `emend-macos-docker` for commit `4834b3c0f7271a84d00dcad488de2f479fb93f18`. Its log begins `emend-macos-docker(version:v0.6.1) received task 16`, and checkout, setup-node, `npm ci`, lint, test, and build all report success.
- Gitea run: http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/4; job: http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/4/jobs/16.
