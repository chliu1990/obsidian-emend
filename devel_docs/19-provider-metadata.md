# Stage 19: Provider presets and publication metadata

## Goal

Update the built-in DeepSeek and Kimi Code presets to their current documented model IDs and endpoints, align publication authorship metadata, remove the inherited author URL, and preserve existing provider overrides, custom-provider behavior, version 2.0.0, and original attribution.

## Plan

1. Add focused tests for exact provider catalog/default values, unchanged custom-provider behavior, valid persisted overrides, matching manifest/package authorship, removed `authorUrl`, and retained version 2.0.0.
2. Run the focused settings suite against the old implementation and confirm the expected preset/metadata failures before changing production values.
3. Update only the two provider presets and publication metadata. Refresh lockfile metadata through npm and change only stale current provider examples.
4. Confirm the values against the cited provider documentation, run the full local gate, review the diff, and record implementation and Gitea CI evidence.

## Implementation details

- `src/settings.ts` now uses DeepSeek model `deepseek-flash` with the unchanged base URL `https://api.deepseek.com`. Kimi uses model `k3.1-pro` and Kimi Code base URL `https://api.kimi.com/coding/v1` in both `AI_PROVIDERS` and `DEFAULT_SETTINGS`.
- Custom-provider defaults, editable URLs/models, reasoning controls, request-usage defaults, normalization, and persisted valid model overrides are unchanged.
- `manifest.json` and `package.json` use author `Chang Liu and Kimi K3.1 Pro`. The inherited `authorUrl` is removed and no replacement URL is claimed. Version 2.0.0 is retained.
- `npm install --package-lock-only --ignore-scripts` refreshed lockfile metadata through npm and reported `up to date`; lockfile version 3 already contained consistent `2.0.0` root and package entries, so npm made no lockfile diff and no inconsistent manual version edit was made.
- `QUICK_START.md` now shows the exact DeepSeek and Kimi Code presets and identifies the Kimi Code key. `README.md` and `AGENTS.md` contained no stale model IDs or endpoint examples and were not changed. Historical Stage 02 records remain historical.
- `tests/settings.test.ts` covers the exact provider catalog/defaults, custom-provider retention, existing valid per-provider overrides, matching manifest/package author, absent `authorUrl`, and version 2.0.0. Original `LICENSE` and `CREDITS.md` attribution is unchanged.

## Verification results

- TDD red: `npx vitest run tests/settings.test.ts` failed exactly two tests before implementation. Publication metadata received `Taha Yiğit Melek` instead of `Chang Liu and Kimi K3.1 Pro`; provider presets received `deepseek-v4-flash`, `kimi-k2-turbo-preview`, and `https://api.moonshot.cn/v1`. The other 26 tests passed, including custom-provider and valid persisted override coverage.
- TDD green: the same focused command passed all 28 tests after the minimal implementation. A subsequent test-only lint correction changed `JSON.parse` assignments to explicit type assertions without changing assertions or runtime code.
- Source-backed configuration: [DeepSeek model details](https://api-docs.deepseek.com/quick_start/pricing) lists model `deepseek-flash` and OpenAI-format base URL `https://api.deepseek.com`; its [model metadata API](https://api-docs.deepseek.com/api/list-models) confirms `https://api.deepseek.com/models`. [Kimi Code API/models](https://www.kimi.com/code/docs/en/) lists model ID `k3.1-pro`, OpenAI-compatible China base URL `https://api.kimi.com/coding/v1`, and the corresponding `/chat/completions` endpoint. The [third-party configuration guide](https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html) uses the same Kimi Code service. No provider API or paid call was made.
- Full local gate: `npm test` passed 20 files and 410 tests; `npm run build` passed strict TypeScript checking and production bundling; `npm run lint` passed with no findings; `git diff --check` passed. An earlier gate had the same passing tests/build but stopped on the two new unsafe-assignment lint findings, which were corrected before this final complete gate.
- Self-review confirmed that only the requested preset values, publication metadata, focused tests, quick-start examples, and this stage record changed. Persisted valid values still override defaults; no request, write, permission, or settings-normalization contract changed. Version 2.0.0 and original attribution remain intact. No generated bundle, vault/profile data, credential, or other ignored file is included in git.
