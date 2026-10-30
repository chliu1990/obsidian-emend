import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/context';
import EmendPlugin from '../src/main';
import { requestAiResponse } from '../src/provider-stream';
import { DEFAULT_SETTINGS } from '../src/settings';
import * as settingsModule from '../src/settings';
import type { EmendSettings, ProviderId } from '../src/types';

vi.mock('../src/provider-stream', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/provider-stream')>();
	return { ...actual, requestAiResponse: vi.fn() };
});

vi.mock('../src/instructions-loader', () => ({
	loadAllInstructions: vi.fn(async () => ({
		agentText: '',
		skillTexts: new Map(),
	})),
}));

const PROVIDER_IDS: ProviderId[] = ['deepseek', 'kimi', 'custom'];
const SECRET_IDS = {
	deepseek: 'emend-api-key-deepseek',
	kimi: 'emend-api-key-kimi',
	custom: 'emend-api-key-custom',
} as const;

class MemorySecretStorage {
	readonly secrets = new Map<string, string>();

	getSecret(id: string) {
		return this.secrets.get(id) ?? null;
	}

	setSecret(id: string, value: string) {
		this.secrets.set(id, value);
	}
}

function makePlugin(
	persisted: EmendSettings,
	secretStorage = new MemorySecretStorage(),
) {
	let persistedData = structuredClone(persisted);
	const saved: EmendSettings[] = [];
	const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
	Object.assign(plugin, {
		app: { secretStorage, vault: {} },
		loadData: vi.fn(async () => structuredClone(persistedData)),
		saveData: vi.fn(async (data: EmendSettings) => {
			persistedData = structuredClone(data);
			saved.push(structuredClone(data));
		}),
		refreshChatModelLabels: vi.fn(),
	});
	return {
		plugin,
		secretStorage,
		saved,
		getPersisted: () => structuredClone(persistedData),
	};
}

function settingsWithPlaintextKeys() {
	const settings = structuredClone(DEFAULT_SETTINGS);
	for (const providerId of PROVIDER_IDS) {
		settings.providers[providerId].apiKey = `dummy-${providerId}-plaintext`;
	}
	return settings;
}

function expectSanitized(settings: EmendSettings) {
	for (const providerId of PROVIDER_IDS) {
		expect(settings.providers[providerId].apiKey).toBe('');
	}
}

describe('SecretStorage API keys', () => {
	beforeEach(() => {
		vi.mocked(requestAiResponse).mockReset();
	});

	it('migrates all three plaintext keys, clears memory, and saves sanitized settings', async () => {
		const harness = makePlugin(settingsWithPlaintextKeys());

		await harness.plugin.loadSettings();

		for (const providerId of PROVIDER_IDS) {
			expect(
				harness.secretStorage.getSecret(SECRET_IDS[providerId]),
			).toBe(`dummy-${providerId}-plaintext`);
			expect(harness.plugin.getApiKey(providerId)).toBe(
				`dummy-${providerId}-plaintext`,
			);
		}
		expectSanitized(harness.plugin.settings);
		expect(harness.saved).toHaveLength(1);
		expectSanitized(harness.saved[0] as EmendSettings);
		expectSanitized(harness.getPersisted());
	});

	it('preserves an existing secret when a whitespace-only legacy key is sanitized', async () => {
		const persisted = structuredClone(DEFAULT_SETTINGS);
		persisted.providers.deepseek.apiKey = ' \t\n ';
		const secretStorage = new MemorySecretStorage();
		secretStorage.setSecret(SECRET_IDS.deepseek, 'dummy-existing-secret');
		const harness = makePlugin(persisted, secretStorage);

		await harness.plugin.loadSettings();

		expect(secretStorage.getSecret(SECRET_IDS.deepseek)).toBe(
			'dummy-existing-secret',
		);
		expect(harness.plugin.getApiKey('deepseek')).toBe('dummy-existing-secret');
		expectSanitized(harness.plugin.settings);
		expect(harness.saved).toHaveLength(1);
		expectSanitized(harness.getPersisted());
	});

	it('serializes a deep sanitized clone on every save regardless of caller state', async () => {
		const harness = makePlugin(structuredClone(DEFAULT_SETTINGS));
		await harness.plugin.loadSettings();
		harness.plugin.settings.providers.kimi.apiKey = 'dummy-untrusted-key';
		harness.plugin.settings.providers.kimi.baseUrl = 'https://kimi.example.test';

		await harness.plugin.saveSettings();

		expect(harness.saved).toHaveLength(1);
		const saved = harness.saved[0] as EmendSettings;
		expectSanitized(saved);
		expect(saved).not.toBe(harness.plugin.settings);
		expect(saved.providers).not.toBe(harness.plugin.settings.providers);
		expect(saved.providers.kimi).not.toBe(harness.plugin.settings.providers.kimi);
		expect(saved.providers.kimi.baseUrl).toBe('https://kimi.example.test');
		saved.providers.kimi.baseUrl = 'https://changed.example.test';
		expect(harness.plugin.settings.providers.kimi.baseUrl).toBe(
			'https://kimi.example.test',
		);
	});

	it('resolves every provider after reload from sanitized persisted data', async () => {
		const storage = new MemorySecretStorage();
		const first = makePlugin(settingsWithPlaintextKeys(), storage);
		await first.plugin.loadSettings();
		const reloaded = makePlugin(first.getPersisted(), storage);

		await reloaded.plugin.loadSettings();

		expect(reloaded.saved).toHaveLength(0);
		for (const providerId of PROVIDER_IDS) {
			expect(reloaded.plugin.getApiKey(providerId)).toBe(
				`dummy-${providerId}-plaintext`,
			);
		}
	});

	it('keeps updates independent, supports empty keys, and never saves plaintext', async () => {
		const harness = makePlugin(structuredClone(DEFAULT_SETTINGS));
		await harness.plugin.loadSettings();
		for (const providerId of PROVIDER_IDS) {
			await harness.plugin.setApiKey(providerId, ` dummy-${providerId}-new `);
		}

		await harness.plugin.setApiKey('deepseek', '');

		expect(harness.plugin.getApiKey('deepseek')).toBe('');
		expect(harness.plugin.getApiKey('kimi')).toBe('dummy-kimi-new');
		expect(harness.plugin.getApiKey('custom')).toBe('dummy-custom-new');
		expect(harness.saved).toHaveLength(4);
		for (const saved of harness.saved) {
			expectSanitized(saved);
		}
		expectSanitized(harness.getPersisted());
	});

	it('uses SecretStorage keys for requests without reintroducing plaintext settings', async () => {
		const harness = makePlugin(structuredClone(DEFAULT_SETTINGS));
		await harness.plugin.loadSettings();
		harness.secretStorage.setSecret(
			SECRET_IDS.deepseek,
			'dummy-request-secret',
		);
		vi.mocked(requestAiResponse).mockResolvedValue({
			content: 'Answer',
			reasoning: '',
		});
		const context = {
			file: { path: 'Secret.md' },
			sourceText: 'Source',
			selection: { from: 0, to: 0 },
			noteLabel: 'Secret.md',
			markdown: 'Source',
		} as RequestContext;

		await harness.plugin.requestChatCompletion({
			context,
			mode: 'ask',
			prompt: 'Question',
			history: [],
			callbacks: { onContent: vi.fn(), onReasoning: vi.fn() },
			signal: new AbortController().signal,
		});

		expect(requestAiResponse).toHaveBeenCalledOnce();
		expect(vi.mocked(requestAiResponse).mock.calls[0]?.[0].provider.apiKey).toBe(
			'dummy-request-secret',
		);
		expectSanitized(harness.plugin.settings);
	});
});

describe('sanitizeSettings', () => {
	it('deep-clones every provider config and clears every API key', () => {
		const sanitize = (
			settingsModule as typeof settingsModule & {
				sanitizeSettings?: (settings: EmendSettings) => EmendSettings;
			}
		).sanitizeSettings;
		expect(sanitize).toBeTypeOf('function');
		if (!sanitize) {
			throw new Error('sanitizeSettings is missing.');
		}
		const original = settingsWithPlaintextKeys();

		const sanitized = sanitize(original);

		expectSanitized(sanitized);
		expect(sanitized).not.toBe(original);
		for (const providerId of PROVIDER_IDS) {
			expect(sanitized.providers[providerId]).not.toBe(
				original.providers[providerId],
			);
			expect(sanitized.providers[providerId].baseUrl).toBe(
				original.providers[providerId].baseUrl,
			);
		}
		sanitized.providers.custom.model = 'changed-model';
		expect(original.providers.custom.model).toBe(DEFAULT_SETTINGS.providers.custom.model);
	});
});
