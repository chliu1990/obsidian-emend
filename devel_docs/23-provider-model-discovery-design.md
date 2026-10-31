# Stage 23: provider model discovery design

## Goal

Add an explicit **Refresh models** action to provider settings so users can populate the model selector from the configured OpenAI-compatible provider without losing manual model entry. Discovery must never run in the background, must protect credentials, and must remain a focused feature PR without a version bump.

## Scope

This stage includes:

- Authenticated `GET <base URL>/models` requests for DeepSeek, Kimi Code, and custom providers.
- Model IDs and display names only.
- Persistent per-provider caches of discovered non-secret model metadata.
- Dropdown population, custom-model preservation, configuration invalidation, and clear success/error feedback.
- Unit tests, real-Obsidian verification, and user documentation.

This stage does not include context-window accounting, output limits, modalities, reasoning-effort discovery, capability detection, automatic model selection, pagination, provider adapter frameworks, online search, vision, additional-note context, or release metadata changes.

## Current context

Provider streaming lives in `src/provider-stream.ts`; settings and model selection live in `src/settings.ts`; API keys are resolved through `EmendPlugin.getApiKey()` and SecretStorage. The model selector currently contains the preset, the current model, and a custom-model option.

DeepSeek publicly documents `GET https://api.deepseek.com/models` with a Bearer key and a top-level `data` array. The official Kimi Code client uses `GET https://api.kimi.com/coding/v1/models` with the same authorization style and a top-level `data` array. Custom chat-completions compatibility does not guarantee `/models` support, so custom discovery can fail without affecting manual entry.

References:

- https://api-docs.deepseek.com/api/list-models
- https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-kimi-code.ts
- https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/refreshProviderModels.ts

## Architecture

Add `src/model-discovery.ts` with one focused request/validation boundary. It accepts a provider connection containing name, base URL, and API key, plus an optional abort signal, and returns discovered models:

```ts
interface DiscoveredModel {
	id: string;
	displayName: string;
}
```

The module performs no Obsidian imports, settings reads, persistence, or autonomous calls. Chat streaming remains in `src/provider-stream.ts`; a broad shared-HTTP refactor is outside this stage.

Extend each `ProviderConfig` with a discovered-model list. Normalize persisted data defensively, retain only valid IDs/display names, deduplicate entries, and keep API-key sanitization unchanged. Do not persist raw provider responses, error bodies, timestamps, credentials, or endpoint fingerprints.

`EmendSettingTab` orchestrates the explicit refresh, cache updates, feedback, and rendering. `EmendPlugin` continues to own settings persistence and SecretStorage access.

## Request and response behavior

The refresh handler:

1. Captures the active provider ID and its current base URL and SecretStorage API key.
2. Requires a nonempty API key and valid HTTP(S) base URL. Model selection is not required for discovery.
3. Sends one `GET` request to the base URL with trailing slashes removed plus `/models`, with `Authorization: Bearer <key>` and `Accept: application/json`. It sends no request body and performs no automatic retry.
4. Requires a successful HTTP response and a JSON object with a top-level `data` array.
5. Accepts entries with a nonempty string `id`; uses nonempty `display_name` first, then nonempty `name`, otherwise the ID. Ignores unrecognized fields and entries without a usable ID.
6. Deduplicates by model ID while preserving the first returned entry and provider order.
7. Rejects a response with no usable models rather than replacing a valid cache with an empty list.

Provider-specific optional metadata is deliberately ignored in this stage. No missing metadata is invented.

## Settings and cache behavior

Add a **Refresh models** button to the active provider's model setting. The button is disabled while its request is pending, and duplicate clicks are ignored. Success replaces only that provider's discovered-model cache, saves settings, shows a nonsensitive success notice, and rerenders settings.

Dropdown options are the union of:

- The built-in preset model, when present.
- The provider's cached discovered models.
- The current configured model, even when absent from the cache.
- The existing custom-model sentinel and editable text field.

Refresh never changes the configured model. Duplicate option values are collapsed without changing the selected model.

Changing a provider's base URL or API key clears only that provider's discovered-model cache before saving. Selecting a model, changing reasoning effort, or changing unrelated settings does not clear the cache. Switching the active provider does not trigger discovery or modify another provider's cache.

After an awaited request, apply the result only if the captured provider is still active and its base URL and in-memory API key still match. Discard stale successes without saving or showing a success notice. A failed request leaves the prior cache and selected model intact and shows a clear error notice; it never exposes the key, authorization header, or raw secret-bearing error text.

The existing settings display remains synchronous. Loading settings, opening settings, switching providers, opening notes, and plugin startup perform no discovery requests.

## Error handling and privacy

Reuse the streaming client's user-facing error conventions where practical without coupling the modules: concise HTTP status/provider details, bounded error text, and explicit credential redaction. Abort errors propagate without retry. Network and malformed-response errors produce one failed refresh and no settings save.

Only model IDs and display names enter `data.json`. API keys continue to use SecretStorage and are read only inside the explicit refresh handler. Tests, notices, logs, screenshots, and documentation use sanitized endpoints and dummy credentials.

## Testing

Add `tests/model-discovery.test.ts` for:

- Exact URL, method, headers, signal, and absence of a request body.
- DeepSeek/Kimi-style responses, display-name fallback, malformed entries, duplicates, empty usable lists, malformed JSON, and invalid top-level shapes.
- Missing credentials, invalid base URLs, HTTP/network errors, aborts, no retries, bounded errors, and credential redaction.

Extend the Obsidian mock only with the button and dropdown behavior needed by the settings tests. Extend `tests/settings.test.ts` and normalization tests for:

- Cache round trips and malformed-cache normalization.
- No discovery on display, load, or provider switching.
- One request per explicit click and duplicate-click suppression.
- Successful dropdown population and preset/current/custom option preservation.
- Base-URL and API-key invalidation scoped to the changed provider.
- Failure preserving prior state and stale responses being discarded.

Run the full test suite, lint, production build, and `git diff --check`.

## Real-Obsidian verification

Use the gitignored test vault and a sanitized local OpenAI-compatible `/models` fixture with dummy credentials. Verify:

1. Opening settings and switching providers sends no request.
2. Refresh populates readable model labels and preserves a custom selection absent from the response.
3. The discovered list survives reload without another request.
4. Changing base URL or API key clears only the relevant cache.
5. Invalid endpoints and malformed responses show safe errors without replacing the previous list.
6. Repeated clicks cannot create overlapping refreshes, and a provider switch during refresh cannot apply stale results.

Record the scenario and results in the stage implementation document and PR. Do not use real private notes or credentials.

## Documentation and delivery

Update the README settings/provider documentation and mark only the implemented portions of `devel_docs/future-provider-and-context-features.md` complete. Keep capability metadata items unchecked where they belong to later work. Create a focused PR with privacy/network/storage impact, automated evidence, and real-Obsidian evidence. Version metadata and changelog updates remain in a separate release PR.
