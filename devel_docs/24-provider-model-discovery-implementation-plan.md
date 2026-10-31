# Provider Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, credential-safe **Refresh models** action that caches provider model IDs/display names and populates the existing model selector without background requests or losing custom model entry.

**Architecture:** A new `model-discovery.ts` owns HTTP and response validation. Existing settings normalization persists a per-provider `DiscoveredModel[]` cache, while `EmendSettingTab` orchestrates explicit refreshes and `EmendPlugin.setApiKey()` invalidates credential-specific cache entries.

**Tech Stack:** TypeScript, Obsidian settings API, browser `fetch`, Vitest, existing Obsidian test mocks, esbuild.

## Global Constraints

- Work on `feature/model-discovery`; keep this feature separate from release version changes.
- Use model IDs and display names only. Do not add context limits, modalities, reasoning metadata, or capability detection.
- Discovery occurs only after an explicit **Refresh models** click; never on load, settings display, provider switching, note events, or timers.
- Resolve credentials only through SecretStorage helpers. Never persist or log keys, authorization headers, raw responses, or error bodies.
- Preserve the current selected/custom model and editable text field. Never auto-select a returned model.
- Clear only the affected provider's cache when its base URL or API key changes.
- Keep chat streaming in `provider-stream.ts`; do not introduce a provider adapter framework or broad HTTP refactor.
- Add focused tests before implementation and make a commit after each independently testable task.
- No dependencies, manifest changes, command IDs, telemetry, vault reads, or note-write paths are needed.

## File Structure

- Create `src/model-discovery.ts`: explicit `/models` request, validation, deduplication, and safe errors.
- Create `tests/model-discovery.test.ts`: request/response/error unit tests.
- Modify `src/types.ts`: define `DiscoveredModel` and add the provider cache field.
- Modify `src/settings.ts`: defaults, normalization, dropdown union, Refresh orchestration.
- Modify `src/main.ts`: clear the relevant cache after an API-key change.
- Modify `tests/settings.test.ts`, `tests/main.test.ts`, `tests/provider-stream.test.ts`: cache and UI behavior plus required fixture updates.
- Modify `tests/mocks/obsidian.ts`: minimal button, dropdown, and Notice observation support.
- Modify `README.md`, `devel_docs/future-provider-and-context-features.md`: document shipped behavior only.
- Create `devel_docs/25-provider-model-discovery.md`: implementation details and verification evidence.

---

### Task 1: Discovery client

**Files:**
- Create: `src/model-discovery.ts`
- Create: `tests/model-discovery.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `ProviderConfig['name' | 'baseUrl' | 'apiKey']` and standard `AbortSignal`.
- Produces: `DiscoveredModel { id: string; displayName: string }` and `discoverProviderModels(provider, signal?): Promise<DiscoveredModel[]>`.

- [ ] **Step 1: Add the failing request and parser tests**

Add `DiscoveredModel` to `src/types.ts` so the tests can import the shared return type:

```ts
export interface DiscoveredModel {
	id: string;
	displayName: string;
}
```

Create tests using the existing `vi.stubGlobal('fetch', fetchMock)` and `afterEach(() => vi.unstubAllGlobals())` pattern. The core success test is:

```ts
const provider = {
	name: 'Test provider',
	baseUrl: 'https://provider.example.test/v1///',
	apiKey: 'test-api-key',
};

it('gets and normalizes models without changing provider order', async () => {
	const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
		data: [
			{ id: 'model-a', name: 'Model A' },
			{ id: 'model-b', display_name: 'Model B', name: 'Ignored' },
			{ id: 'model-a', display_name: 'Duplicate' },
			{ id: ' ', name: 'Blank' },
			{ name: 'Missing ID' },
		],
	})));
	vi.stubGlobal('fetch', fetchMock);
	const controller = new AbortController();

	await expect(discoverProviderModels(provider, controller.signal)).resolves.toEqual([
		{ id: 'model-a', displayName: 'Model A' },
		{ id: 'model-b', displayName: 'Model B' },
	]);
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
	expect(url).toBe('https://provider.example.test/v1/models');
	expect(init).toEqual({
		method: 'GET',
		headers: {
			Authorization: 'Bearer test-api-key',
			Accept: 'application/json',
		},
		signal: controller.signal,
	});
	expect(init).not.toHaveProperty('body');
});
```

Add table-driven tests proving: display name falls back to ID; non-object/non-array/malformed JSON/no-usable-model responses reject; blank key and missing/invalid/non-HTTP base URLs reject before fetch; HTTP and network errors are bounded and redact the key/Bearer credentials; abort errors propagate unchanged and no error path retries.

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `npx vitest run tests/model-discovery.test.ts`

Expected: FAIL because `../src/model-discovery` does not exist.

- [ ] **Step 3: Implement the minimal client**

Create the module with this public boundary:

```ts
import type { DiscoveredModel } from './types';

export interface ProviderDiscoveryConnection {
	name: string;
	baseUrl: string;
	apiKey: string;
}

export async function discoverProviderModels(
	provider: ProviderDiscoveryConnection,
	signal?: AbortSignal,
): Promise<DiscoveredModel[]>
```

The implementation must trim the key/base URL, remove trailing slashes, require the key and an HTTP(S) URL, and perform exactly one `fetch(`${baseUrl}/models`, { method: 'GET', headers, signal })`. Require a non-OK response to throw a sanitized error. Parse JSON, require a record with a `data` array, and reduce it as follows:

```ts
const models: DiscoveredModel[] = [];
const seen = new Set<string>();
for (const entry of data) {
	if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue;
	const id = entry.id.trim();
	if (seen.has(id)) continue;
	seen.add(id);
	const displayName = [entry.display_name, entry.name]
		.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
		?.trim() ?? id;
	models.push({ id, displayName });
}
if (models.length === 0) throw new Error('The provider returned no usable models.');
return models;
```

Catch non-abort errors, replace every occurrence of the API key with `[redacted]`, replace Bearer credentials, cap messages at 2000 characters, and avoid echoing successful response payloads.

- [ ] **Step 4: Run discovery and existing provider tests**

Run: `npx vitest run tests/model-discovery.test.ts tests/provider-stream.test.ts`

Expected: all focused tests PASS; streaming behavior remains unchanged.

- [ ] **Step 5: Commit the discovery boundary**

```bash
git add src/model-discovery.ts src/types.ts tests/model-discovery.test.ts
git commit -m "feat: add provider model discovery client"
```

---

### Task 2: Persistent per-provider cache and invalidation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Test: `tests/settings.test.ts`, `tests/main.test.ts`, `tests/provider-stream.test.ts`

**Interfaces:**
- Consumes: `DiscoveredModel` from Task 1 and existing `saveSettings()`/`setApiKey()`.
- Produces: required `ProviderConfig.discoveredModels: DiscoveredModel[]`, normalized defaults `[]`, and API-key cache invalidation.

- [ ] **Step 1: Write failing normalization and key-invalidation tests**

Add normalization cases with exact expected behavior:

```ts
it('normalizes and deduplicates discovered model caches', () => {
	const settings = normalizeSettings({ providers: { deepseek: {
		discoveredModels: [
			{ id: ' model-a ', displayName: ' Model A ' },
			{ id: 'model-a', displayName: 'Duplicate' },
			{ id: '', displayName: 'Invalid' },
			{ id: 'model-b', displayName: '' },
			null,
		],
	} } });
	expect(settings.providers.deepseek.discoveredModels).toEqual([
		{ id: 'model-a', displayName: 'Model A' },
		{ id: 'model-b', displayName: 'model-b' },
	]);
	expect(settings.providers.kimi.discoveredModels).toEqual([]);
});

it('drops malformed discovered model caches', () => {
	for (const discoveredModels of ['invalid', 42, {}, null]) {
		expect(normalizeSettings({ providers: { kimi: { discoveredModels } } })
			.providers.kimi.discoveredModels).toEqual([]);
	}
});
```

Add a `main.test.ts` case that seeds `settings.providers.deepseek.discoveredModels` and Kimi's cache, calls `await plugin.setApiKey('deepseek', 'new-key')`, and expects DeepSeek `[]`, Kimi unchanged, SecretStorage updated, and persisted API keys empty. Add `discoveredModels: []` to the existing hand-built `ProviderConfig` fixture in `provider-stream.test.ts` and expected provider defaults in `settings.test.ts`.

- [ ] **Step 2: Run focused tests and confirm the red state**

Run: `npx vitest run tests/settings.test.ts tests/main.test.ts tests/provider-stream.test.ts`

Expected: FAIL because `discoveredModels` is absent and `setApiKey()` does not invalidate it.

- [ ] **Step 3: Implement cache normalization and invalidation**

Add to `ProviderConfig`:

```ts
discoveredModels: DiscoveredModel[];
```

Add `discoveredModels: []` to all three defaults. In `normalizeProviderConfig()`, use a helper with this behavior:

```ts
function normalizeDiscoveredModels(value: unknown): DiscoveredModel[] {
	if (!Array.isArray(value)) return [];
	const models: DiscoveredModel[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue;
		const id = entry.id.trim();
		if (seen.has(id)) continue;
		seen.add(id);
		models.push({
			id,
			displayName: typeof entry.displayName === 'string' && entry.displayName.trim()
				? entry.displayName.trim()
				: id,
		});
	}
	return models;
}
```

Set `discoveredModels: normalizeDiscoveredModels(config.discoveredModels)` in the normalized provider. In `EmendPlugin.setApiKey()`, immediately after storing the trimmed key, clear only `this.settings.providers[providerId].discoveredModels` before the sanitized save. In the base-URL `onChange` handler in `settings.ts`, assign the trimmed URL and `config.discoveredModels = []` before saving.

- [ ] **Step 4: Run cache and regression tests**

Run: `npx vitest run tests/settings.test.ts tests/main.test.ts tests/provider-stream.test.ts tests/secret-storage.test.ts`

Expected: all focused tests PASS and SecretStorage migration remains intact.

- [ ] **Step 5: Commit the cache behavior**

```bash
git add src/types.ts src/settings.ts src/main.ts tests/settings.test.ts tests/main.test.ts tests/provider-stream.test.ts
git commit -m "feat: cache discovered models per provider"
```

---

### Task 3: Explicit Refresh models settings action

**Files:**
- Modify: `src/settings.ts`
- Modify: `tests/mocks/obsidian.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `discoverProviderModels()` and `ProviderConfig.discoveredModels` from Tasks 1–2.
- Produces: explicit Refresh click orchestration and a dropdown containing preset, cache, current model, and `__custom__` without duplicates.

- [ ] **Step 1: Extend mocks and write failing UI tests**

Extend the mock with chainable button/dropdown state, not a DOM framework:

```ts
interface ButtonComponent {
	buttonEl: { disabled: boolean };
	text: string;
	clickHandler: () => unknown;
	setButtonText(value: string): ButtonComponent;
	setDisabled(value: boolean): ButtonComponent;
	onClick(handler: () => unknown): ButtonComponent;
}

interface DropdownComponent {
	options: Record<string, string>;
	value: string;
	onChangeHandler: (value: string) => unknown;
	addOption(value: string, label: string): DropdownComponent;
	setValue(value: string): DropdownComponent;
	onChange(handler: (value: string) => unknown): DropdownComponent;
}
```

Store `buttons` and `dropdowns` on each `Setting`; retain async handlers. Store Notice constructor messages in a static `messages` array for assertions. Reset `Setting.instances` and `Notice.messages` before each UI test.

Mock `discoverProviderModels` and use a plugin stub with cloned settings, dummy `getApiKey`, `setApiKey`, and `saveSettings`. Cover these exact scenarios:

```ts
it('does not discover models on display or provider switching', async () => {
	tab.display();
	expect(discoverProviderModels).not.toHaveBeenCalled();
	await activeProviderDropdown.onChangeHandler('kimi');
	expect(discoverProviderModels).not.toHaveBeenCalled();
});

it('refreshes once and preserves the current custom model', async () => {
	vi.mocked(discoverProviderModels).mockResolvedValue([
		{ id: 'model-a', displayName: 'Model A' },
	]);
	plugin.settings.providers.deepseek.model = 'local-custom';
	tab.display();
	await latestModelSetting().buttons[0].clickHandler();
	const dropdown = latestModelSetting().dropdowns[0];
	expect(dropdown.options).toMatchObject({
		'deepseek-flash': 'deepseek-flash',
		'model-a': 'Model A',
		'local-custom': 'local-custom',
		__custom__: 'Custom model',
	});
	expect(dropdown.value).toBe('local-custom');
	expect(plugin.settings.providers.deepseek.model).toBe('local-custom');
	expect(plugin.saveSettings).toHaveBeenCalledOnce();
});
```

Also test one in-flight click only, blank-key/HTTP failure preserving cache and model with no save, base-URL invalidation, and stale result discard after provider/base-URL/key changes. Use deferred promises for pending/race cases and always await the retained click handler.

- [ ] **Step 2: Run settings tests and confirm the red state**

Run: `npx vitest run tests/settings.test.ts`

Expected: FAIL because Refresh is absent and cached options are not rendered.

- [ ] **Step 3: Implement dropdown union and Refresh orchestration**

Import `discoverProviderModels` and `Notice`. Add a private pending flag to `EmendSettingTab`. Build model options through a `Map<string, string>` in this order: preset, discovered cache, current model, then custom sentinel. Use discovered `displayName` labels and `config.model || CUSTOM_MODEL_OPTION` as the selected value.

Add a button to the model setting:

```ts
.addButton((button) =>
	button
		.setButtonText('Refresh models')
		.setDisabled(this.modelRefreshPending)
		.onClick(async () => {
			await this.refreshModels(provider.id);
		}),
)
```

Implement `refreshModels(providerId)` with this exact state flow: return if pending; capture provider name/base URL/key; set pending; call discovery once; after await require active provider, base URL, and current key to match captures; assign `discoveredModels`; save once; show a nonsensitive success Notice. On error show `Emend: <sanitized message>` without saving. In `finally`, clear pending and rerender so every visible button is reenabled. Never assign `config.model` in this handler.

- [ ] **Step 4: Run all automated checks**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: all tests PASS, no ESLint findings, successful strict TypeScript/esbuild, and no whitespace errors.

- [ ] **Step 5: Commit the settings action**

```bash
git add src/settings.ts tests/settings.test.ts tests/mocks/obsidian.ts
git commit -m "feat: add explicit provider model refresh"
```

---

### Task 4: Documentation, real-Obsidian verification, and review

**Files:**
- Modify: `README.md`
- Modify: `devel_docs/future-provider-and-context-features.md`
- Create: `devel_docs/25-provider-model-discovery.md`
- Create only inside ignored `test_vault/`: local `/models` fixture and CDP verification scripts.

**Interfaces:**
- Consumes: the production bundle and all Task 1–3 behavior.
- Produces: publishable user documentation and reproducible sanitized verification evidence.

- [ ] **Step 1: Update current documentation**

Document that **Settings → Emend → Refresh models** explicitly calls the configured provider's `/models` endpoint with the SecretStorage key, that returned IDs/display names populate the selector, custom model entry remains available, lists persist locally, and base-URL/API-key changes clear the relevant list. State that unsupported custom endpoints show an error and that no discovery occurs automatically.

Check off only completed model-discovery bullets in the deferred document. Keep context/output/modality/reasoning/capability metadata unchecked and explicitly deferred.

- [ ] **Step 2: Verify in real Obsidian with sanitized local services**

Build and install the production bundle in a new ignored test-vault instance with Track Changes and a CORS-enabled loopback `/models` mock using a dummy key. Record actual Obsidian/CDP interaction evidence for all six spec scenarios: zero requests on settings/provider switching; successful labels and custom preservation; reload persistence without a request; base-URL/key invalidation; malformed/HTTP failure preservation and safe Notice; duplicate-click and stale-response guards. Do not use real accounts, external providers, private notes, or real credentials.

- [ ] **Step 3: Run the clean final gate**

Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`

Expected: lockfile install succeeds, all tests PASS, lint/build succeed, and no whitespace errors.

- [ ] **Step 4: Record evidence and commit documentation**

Create `devel_docs/25-provider-model-discovery.md` with Goal, implementation details, exact commands/results, real-Obsidian observations, privacy/network/storage impact, and remaining deferred metadata. Commit:

```bash
git add README.md devel_docs/future-provider-and-context-features.md devel_docs/25-provider-model-discovery.md
git commit -m "docs: document provider model discovery"
```

- [ ] **Step 5: Independent review and focused fixes**

Dispatch a coder subagent for read-only correctness/security/spec review of the complete diff. Convert any confirmed finding into a failing regression test, make the smallest fix, rerun the focused and full gates, and commit each fix separately. Do not expand scope during review.

- [ ] **Step 6: Publish the focused PR and verify GitHub CI**

Push `feature/model-discovery` to GitHub, open a PR referencing the roadmap item, and include behavior, non-goals, privacy/network/storage impacts, automated evidence, and real-Obsidian evidence. Use `gh` to confirm required `check` succeeds. Report the PR URL and CI result; do not merge without the user's approval.
