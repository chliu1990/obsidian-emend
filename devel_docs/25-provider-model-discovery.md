# Stage 25: provider model discovery documentation and verification

## Goal

Document and verify the completed explicit provider model-discovery feature in real Obsidian without using real accounts, credentials, private notes, or external provider APIs. Keep the change focused on user documentation, deferred-roadmap accuracy, sanitized local verification, and evidence; do not change runtime code, release metadata, or generated files under version control.

## Implementation details

- **Settings → Emend → Refresh models** is the only discovery trigger. It resolves the active provider's API key through SecretStorage and sends one authenticated `GET <base URL>/models` request with no body, retry, or background discovery.
- The discovery boundary accepts a top-level `data` array, retains usable model IDs, prefers `display_name` and then `name` for labels, falls back to the ID, ignores malformed entries, deduplicates by ID, and rejects an empty usable list.
- The selector combines the built-in preset, discovered models, the current configured model, and the existing custom-model control. Refresh does not change the selected model, so a custom selection absent from the response remains available.
- Each provider persists only its normalized non-secret `{ id, displayName }` list. Base-URL and API-key changes clear only that provider's list; provider switching does not discover or clear another provider's cache.
- Failed, malformed, and unsupported-endpoint refreshes preserve the previous cache and selection. Awaited successes are discarded if the provider, base URL, or in-memory API key changed during the request. Errors are bounded and credential-safe.
- `README.md` now documents the explicit request, SecretStorage credential use, selector/custom behavior, persistence, invalidation, unsupported custom endpoints, and absence of automatic discovery. `devel_docs/future-provider-and-context-features.md` checks only the completed discovery behavior and leaves capability metadata explicitly deferred.
- No `src/`, `tests/`, `styles.css`, dependency, manifest, command-ID, or release-metadata file changed in this documentation task. The production bundle was built and copied only into the ignored isolated vault.

## Verification results

### Clean local gate

Actual command:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: **PASS**. `npm ci` installed 351 packages from the committed lockfile. Vitest passed **23 files and 457 tests**. ESLint completed with no findings, strict TypeScript checking and production esbuild succeeded, and `git diff --check` reported no whitespace errors.

Before installing the isolated verification copy, `npm run build` also completed successfully. That production `main.js`, the existing `manifest.json`, and `styles.css` were copied into ignored `test_vault/stage23_vault/.obsidian/plugins/emend/`.

### Real Obsidian and loopback-fixture evidence

Environment: real Obsidian on macOS reporting `obsidian/1.11.7`, Chrome `142.0.7444.265`, Electron `39.5.1`; CDP 9337; a new ignored vault `test_vault/stage23_vault`; a new ignored profile `test_vault/.emend-test-profile-23`; Emend and Track Changes enabled; and a CORS-enabled loopback fixture at `http://127.0.0.1:8801/v1`. Only dummy credentials and the synthetic `Stage23.md` fixture were used. No real provider account, external provider request, private note, user profile, or real credential was accessed.

Actual verification commands:

```bash
node test_vault/setup-stage23.mjs
node test_vault/mock-models-23.mjs
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$PWD/test_vault/.emend-test-profile-23" --remote-debugging-port=9337
node test_vault/cdp-eval-23.mjs test_vault/stage23-before-reload.js > test_vault/stage23-before-reload.json
node test_vault/cdp-eval-23.mjs "location.reload();'Stage 23 renderer reload requested'" > test_vault/stage23-reload-command.json
node test_vault/cdp-eval-23.mjs test_vault/stage23-after-reload.js > test_vault/stage23-after-reload.json
node test_vault/verify-stage23.mjs
```

The fresh vault first displayed Obsidian's expected trust prompt. CDP clicked **Trust author and enable plugins** only in the disposable profile. The sanitized verifier passed all six scenarios and checked eight actual `GET /v1/models` requests. Every request carried an accepted dummy Bearer credential and no body; request logs contain no credential value.

1. **No implicit discovery — PASS.** Opening Emend settings and switching DeepSeek → Kimi → Custom → DeepSeek left the `/models` count at zero and all caches empty.
2. **Readable labels and custom preservation — PASS.** Explicit DeepSeek and Kimi refreshes each caused exactly one request. Both selectors showed `Alpha readable label` and `Beta readable label`. Duplicate/malformed fixture entries did not create options. DeepSeek's selected `manual-model`, which was absent from the response, remained selected alongside the preset and **Custom model**; Kimi's `k3.1-pro` selection also remained unchanged. Notices included `Emend: DeepSeek model list refreshed.`
3. **Reload persistence without discovery — PASS.** The count was two before an actual `location.reload()`, two when the post-reload script started, and two after reopening settings and switching providers. Both normalized lists and readable options restored from local storage, with `manual-model` still selected.
4. **Scoped base-URL/API-key invalidation — PASS.** Actual settings-input changes cleared DeepSeek's in-memory and persisted cache for either a base-URL change or an API-key change while Kimi's cached list remained unchanged. Explicit refreshes repopulated DeepSeek between checks.
5. **Safe failure preservation — PASS.** With a valid DeepSeek cache present, a malformed response produced `Emend: The provider returned malformed JSON.` and HTTP 503 produced `Emend: Model discovery failed with HTTP 503.` Both preserved the cached options and selected model. Notices contained neither fixture response-body canaries nor dummy credentials/authorization text; Kimi's cache remained unchanged.
6. **Duplicate-click and stale-response guards — PASS.** Two immediate clicks during a 700 ms response produced exactly one request and retained the selection. During a separate delayed refresh, switching to Kimi caused the `stale-id`/`STALE_MUST_NOT_APPLY` response to be discarded: neither memory nor `data.json` changed, no success Notice appeared, and switching back caused no additional request.

Final storage contained only the two normalized ID/display-name pairs per refreshed provider, empty plaintext `apiKey` fields, and none of the fixture's ignored raw-response fields. `Stage23.md` remained byte-for-byte unchanged. Only the isolated Obsidian process and loopback mock were stopped afterward; the pre-existing Obsidian process remained running.

One UI discrepancy was observed and is reported for independent review rather than changed in this documentation task: immediately after the first click, the actual refresh button's `disabled` property remained `false`. The in-flight guard still suppressed the second click, so the required no-overlap behavior passed, but the button did not visually/programmatically disable while pending as described in the approved design.

All scripts, profiles, vault content, dummy settings, sanitized request logs, and CDP result files remain ignored under `test_vault/` and are not part of the documentation commit.

## Privacy, network, and storage impact

- Discovery adds no automatic, periodic, startup, settings-open, provider-switch, or note-open network behavior. The explicit refresh sends the configured base URL-derived `/models` request and SecretStorage Bearer key only to the configured provider.
- Only normalized model IDs and display names are added to local plugin data. API keys remain in SecretStorage; raw responses, response metadata, error bodies, timestamps, and credentials are not cached.
- Unsupported custom `/models` endpoints can produce an error without affecting manual model entry or the last valid cache. Errors redact credentials and omit HTTP response bodies.
- Verification made loopback requests only. Its logs record request method/path, dummy-credential acceptance, body absence, fixture mode, and delay—not authorization values.

## Remaining deferred metadata and non-goals

Context-window limits, output limits, supported modalities, reasoning-effort discovery, and API-capability metadata remain unchecked and explicitly deferred. Automatic model selection, pagination, provider adapter frameworks, online search, vision, additional-note context, capability inference, and release metadata changes are not part of this feature. No missing capability metadata is invented.
