# Stage 21: SecretStorage API keys

## Goal

Move DeepSeek, Kimi, and custom-provider API keys out of plaintext plugin data and into Obsidian SecretStorage. Migrate existing keys on load, sanitize every subsequent save, resolve request credentials without changing missing-key validation or provider independence, and retain masked settings inputs.

## Plan

1. Write failing migration, save-boundary, reload, independent-update, request-resolution, deep-clone, and settings-input tests.
2. Add a focused SecretStorage adapter with exact provider IDs and an in-memory fallback. Migrate normalized plaintext during settings load, clear it in memory, and persist sanitized settings.
3. Resolve request provider clones through the plugin's `getApiKey()` helper. Route settings reads/writes through `getApiKey()` and `setApiKey()`, and make every `saveSettings()` call serialize a deep sanitized clone.
4. Run focused and full gates. Verify actual migration, full-reload resolution, and another sanitized save in an isolated real-Obsidian vault using only dummy values and boolean-only evidence.
5. Update current privacy documentation, self-review, commit and push, then verify `emend-macos-docker` through the tea API.

## Implementation details

- `src/secret-storage.ts` defines exactly `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom`. `ApiKeyStorage` reads SecretStorage first and retains a per-provider in-memory fallback; writes update both without sharing provider state.
- `src/settings.ts` exports `sanitizeSettings()`, which clones the root and all three provider configurations and sets every `apiKey` to an empty string. The masked API-key input reads through `plugin.getApiKey()` and writes through `plugin.setApiKey()` rather than storing a key in `plugin.settings`.
- `src/main.ts` migrates each nonempty legacy plaintext key during `loadSettings()`, clears the normalized in-memory field, and saves once when migration occurred. Empty legacy keys do not overwrite existing secrets. `setApiKey()` trims the value, updates SecretStorage/fallback, keeps the settings field empty, and invokes the same sanitized save path as every other setting.
- Every `saveSettings()` passes a fresh sanitized clone to `saveData()`, including when a caller has inserted a plaintext key directly into a provider config. Full-note chat and selection requests each receive a provider clone whose `apiKey` comes from `getApiKey()`; persisted settings remain sanitized. The existing provider-stream missing-key error and credential-redacting error handling are unchanged.
- The Obsidian test mock now supports the fluent settings controls needed to exercise the real settings tab. No provider transport, request protocol, write guard, conversation schema, command ID, dependency, or release metadata changed.

## Test-first and automated verification

- RED: `npx vitest run tests/secret-storage.test.ts tests/main.test.ts tests/settings.test.ts` produced **7 failed, 32 passed** across 39 tests. Failures were absent migration/helpers/sanitizer, plaintext save serialization, unresolved request keys, and direct settings-input access. This was the expected pre-implementation failure set.
- GREEN: the same focused command passed **39/39** after implementation.
- Full tests: `npm test` passed **22 files and 421 tests**.
- The first build/lint attempt caught mock-typing and UI-copy issues in the new test harness; those were corrected without weakening assertions. The final focused run, `npm run build`, `npm run lint`, and `git diff --check` all passed. A final post-documentation gate is recorded in the task report.

## Real Obsidian verification

- Environment: production Emend bundle in ignored `test_vault/stage21_vault`, isolated profile `test_vault/.emend-test-profile-21`, real Obsidian on macOS reporting `obsidian/1.11.7`, and CDP 9335. Only dummy credentials were seeded. No provider request, real account, paid call, or other vault was used.
- Initial fixture contained three nonempty plaintext provider keys. After actual plugin load, boolean-only CDP assertions confirmed that all three in-memory and persisted `apiKey` fields were empty, all exact SecretStorage IDs existed, and both `plugin.getApiKey()` and direct SecretStorage reads resolved all three expected dummy values. The verification output contained no credential values.
- After a full renderer reload, all three IDs again resolved through both paths. An actual `plugin.saveSettings()` call persisted another sanitized file. A separate Node assertion parsed `data.json` and confirmed that every provider `apiKey` was empty without printing the file or any values.
- The fixture `Stage21.md` remained byte-for-byte unchanged. Only the isolated Obsidian process was stopped afterward. Setup, scripts, profiles, plugin data, and results remain ignored under `test_vault/`.
- The first harness attempt found Obsidian's global community-plugin switch disabled; enabling that isolated setting allowed Emend to load. This was setup, not a production failure, and all migration assertions were run only after successful loading.

## Self-review

- The storage boundary uses only the three required IDs. Migration and key updates preserve per-provider independence and empty-key behavior. Requests resolve credentials while settings and every save remain sanitized.
- Sanitization returns new root/provider objects, so later mutation of the serialized clone cannot mutate live settings. SecretStorage remains authoritative after reload, with in-memory fallback available for the current session.
- Settings inputs remain password-masked and use the public plugin helpers. Missing-key validation still lives in `provider-stream.ts`; no error or notice logs a credential.
- Current `README.md`, `QUICK_START.md`, `INSTALLATION.md`, `AGENTS.md`, and `IMPLEMENTATION_PLAN.md` describe SecretStorage, sanitized plugin data, and removal implications. Historical records remain unchanged.
- No generated bundle, vault/profile content, result log, dummy plugin data, credential, or other ignored file is intended for git. Independent task-review approval, if required by the parent workflow, remains separate from this self-review.

## Implementation-run CI evidence

Implementation commit `42344f2f7f6574bc34a223f19143e70dbeb65e5c` was pushed on `feat/emend-rewrite`. Gitea push run 101 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/101 and job 123 completed with conclusion **success** on `emend-macos-docker` from 16:08:59Z through 16:09:34Z. Run, job, and log details were retrieved through `tea api`. Checkout reached `HEAD is now at 42344f2`; clean `npm ci` installed 351 packages, lint passed, all **421 tests in 22 files** passed, and the production build succeeded.
