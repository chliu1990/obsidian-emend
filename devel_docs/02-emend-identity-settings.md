# Stage 02: Emend identity and settings

## Goal

Rename the plugin to Emend and replace legacy persisted provider settings with clean DeepSeek, Kimi, and custom OpenAI-compatible presets while temporarily preserving the legacy JSON chat protocol, inline suggestions, and diff review.

## Plan

1. Write normalization tests first for malformed data, exact provider presets and defaults, valid per-provider values, context limits, and removal of legacy fields.
2. Add shared settings types and strict normalization, then replace the settings tab with provider, model, reasoning, default-mode, privacy, and context controls.
3. Rename plugin registrations and CSS together, adapt the legacy provider path to the new settings shape, and update current-behavior documentation and attribution.
4. Run the full local gate, inspect persistence-after-reload code paths, and record whether a real Obsidian UI check was performed.
5. Commit and push the implementation, verify Gitea Actions on `emend-macos-docker`, then record the implementation and documentation-evidence runs.

## Implementation details

- Added `src/types.ts` with `ProviderId`, `ReasoningEffort`, `ProviderConfig`, and `EmendSettings`. Settings now store a `providers` record with independent `baseUrl`, `apiKey`, `model`, and `reasoningEffort` values.
- Defaults are DeepSeek, Ask mode, high reasoning, 12,000 context characters, and disabled note-path sharing. DeepSeek uses `https://api.deepseek.com` and `deepseek-v4-flash`; Kimi uses `https://api.moonshot.cn/v1` and `kimi-k2-turbo-preview`. Custom starts blank. Normalization rejects malformed containers and legacy provider IDs, enforces a minimum of 1,000 characters, and does not migrate Lapis Lazuli data.
- Replaced the settings tab with active-provider selection, per-provider key/base URL/model controls, preset/custom model selection, reasoning and default-mode dropdowns, note-path sharing, and context limit controls. Model and reasoning settings have icons. No instruction-file picker remains.
- Renamed the plugin to `emend`, main class to `EmendPlugin`, view to `emend-chat-view`, chat command to `emend:open-chat`, and CSS namespace to `emend-`. The legacy inline command remains temporarily. Version stays `1.0.2` and `isDesktopOnly` remains `false`.
- DeepSeek, Kimi, and custom providers share the existing non-streaming OpenAI-compatible `requestUrl` transport. The temporary answer/edit JSON protocol, in-editor diff review, and inline suggestions remain. Reasoning effort and default mode are persisted for later stages and are not sent or applied by the legacy runtime.
- Updated README, project guidance, package metadata, and attribution without presenting planned modes, streaming, CriticMarkup, or skill loading as implemented.

## Verification results

- Red: `npx vitest run tests/settings.test.ts` against the legacy implementation ran 13 tests with 6 expected failures covering missing presets, old defaults, unretained provider configs, context clamping, and legacy-field removal.
- Green: the same focused command passed all 13 tests after typed normalization was implemented.
- Full local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed. Vitest reports 1 file and 13 tests passed; lint produced no findings; the build includes strict TypeScript checking and production bundling.
- Settings persistence code inspection: passed. Each control mutates the active provider's own nested config or the relevant global setting, `saveSettings()` saves the complete object, and `loadSettings()` normalizes persisted unknown data into fresh provider objects. Provider switching does not copy one provider's values into another.
- Real Obsidian UI check: Emend 1.0.2 was installed and enabled in the ignored `test_vault` on Obsidian 1.13.7. The UI initially exposed erased Model and Reasoning effort labels; mounting icons on child spans fixed this and a real app reload confirmed the corrected labels/icons. Distinct dummy provider configurations and global preferences were then entered without real credentials. A subsequent app/plugin reload could not be delivered after Obsidian's remote accessibility tree became unavailable, so persistence after reload remains unverified and is not claimed as passed.
- `test_vault/` is excluded from Git and ESLint. The agent-created `.stage02-manual-vault/` was removed after confirming it contained only the agent's disposable files; neither vault is tracked.
- Implementation commit `226a13bb215fecdd92fe4f99328b6d7af3631990`: Gitea run 16 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/16 and job 24 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/16/jobs/24 completed with conclusion **success** on `emend-macos-docker` (runner id 7). Checkout, setup-node, `npm ci`, lint, test, and build all succeeded.
- Documentation-evidence commit and Gitea run: pending.
