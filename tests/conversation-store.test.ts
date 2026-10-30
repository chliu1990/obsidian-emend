import { describe, expect, it, vi } from 'vitest';
import {
	ConversationStore,
	type ConversationDataAdapter,
} from '../src/conversation-store';
import type { ChatMessage } from '../src/types';

class MemoryAdapter implements ConversationDataAdapter {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>();
	readonly operations: string[] = [];
	beforeWrite: ((path: string) => Promise<void>) | undefined;
	rejectOverwrite = false;

	async exists(path: string) {
		return this.files.has(path) || this.directories.has(path);
	}

	async read(path: string) {
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		return contents;
	}

	async write(path: string, data: string) {
		this.operations.push(`write:${path}`);
		await this.beforeWrite?.(path);
		this.files.set(path, data);
	}

	async mkdir(path: string) {
		this.operations.push(`mkdir:${path}`);
		if (this.directories.has(path)) {
			throw new Error(`Directory exists: ${path}`);
		}
		this.directories.add(path);
	}

	async remove(path: string) {
		this.operations.push(`remove:${path}`);
		if (!this.files.delete(path)) {
			throw new Error(`Missing file: ${path}`);
		}
	}

	async rename(oldPath: string, newPath: string) {
		this.operations.push(`rename:${oldPath}:${newPath}`);
		const contents = this.files.get(oldPath);
		if (contents === undefined) {
			throw new Error(`Missing file: ${oldPath}`);
		}
		if (this.rejectOverwrite && this.files.has(newPath)) {
			throw new Error('Destination file already exists!');
		}
		this.files.delete(oldPath);
		this.files.set(newPath, contents);
	}

	async process(path: string, update: (data: string) => string) {
		this.operations.push(`process:${path}`);
		const contents = update(this.files.get(path) ?? '');
		this.files.set(path, contents);
		return contents;
	}

	async copy(oldPath: string, newPath: string) {
		this.operations.push(`copy:${oldPath}:${newPath}`);
		const contents = this.files.get(oldPath);
		if (contents === undefined || this.files.has(newPath)) {
			throw new Error('Copy failed.');
		}
		this.files.set(newPath, contents);
	}
}

function readyMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: 'message-1',
		role: 'assistant',
		content: 'Answer',
		reasoning: 'Reasoning',
		mode: 'discuss',
		sourcePath: 'folder/Note.md',
		status: 'ready',
		timestamp: 1735689600000,
		usage: {
			promptTokens: 10,
			completionTokens: 4,
			totalTokens: 14,
			source: 'provider',
		},
		...overrides,
	};
}

function threadPath(adapter: MemoryAdapter) {
	const path = Array.from(adapter.files.keys()).find((candidate) =>
		candidate.endsWith('.json'),
	);
	if (!path) {
		throw new Error('No thread was written.');
	}
	return path;
}

function makeStore(adapter: MemoryAdapter) {
	const warning = vi.fn();
	const store = new ConversationStore(adapter, '.test-config', warning);
	return { store, warning };
}

describe('ConversationStore schema', () => {
	it('round trips ready messages with mode, reasoning, usage, and timestamps', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const messages = [
			readyMessage(),
			readyMessage({
				id: 'message-2',
				role: 'user',
				content: 'Question',
				reasoning: '',
				mode: 'ask',
				usage: undefined,
				timestamp: 1735689601000,
			}),
		];

		await store.save('folder/Note.md', messages);

		expect(await store.load('folder/Note.md')).toEqual(messages);
		expect(adapter.files.get(threadPath(adapter))).toContain('"version": 1');
	});

	it('serializes only ready messages and omits runtime-only fields', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const runtimeMessage = readyMessage({
			apiKey: 'secret-key',
			requestBody: '{"messages":[]}',
			noteSnapshot: '# Secret note',
		} as Partial<ChatMessage>);

		await store.save('Note.md', [
			runtimeMessage,
			readyMessage({ id: 'loading', status: 'loading' }),
			readyMessage({ id: 'error', status: 'error' }),
			readyMessage({ id: 'stopped', status: 'stopped' }),
		]);

		const raw = adapter.files.get(threadPath(adapter)) ?? '';
		const persisted = JSON.parse(raw) as {
			messages: Array<Record<string, unknown>>;
		};
		expect(persisted.messages).toHaveLength(1);
		expect(persisted.messages[0]).toEqual({
			id: 'message-1',
			role: 'assistant',
			content: 'Answer',
			reasoning: 'Reasoning',
			mode: 'discuss',
			sourcePath: 'folder/Note.md',
			status: 'ready',
			timestamp: 1735689600000,
			usage: {
				promptTokens: 10,
				completionTokens: 4,
				totalTokens: 14,
				source: 'provider',
			},
		});
		expect(raw).not.toContain('secret-key');
		expect(raw).not.toContain('requestBody');
		expect(raw).not.toContain('noteSnapshot');
	});

	it('loads valid ready messages and filters invalid or non-ready entries', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.files.set(
			path,
			JSON.stringify({
				version: 1,
				messages: [
					readyMessage(),
					readyMessage({ id: 'loading', status: 'loading' }),
					{ ...readyMessage({ id: 'bad-mode' }), mode: 'invalid' },
					readyMessage({ id: 'bad-time', timestamp: Number.NaN }),
					{
						...readyMessage({ id: 'bad-usage' }),
						usage: { promptTokens: 1, completionTokens: 2 },
					},
					null,
				],
			}),
		);

		expect(await store.load('Note.md')).toEqual([readyMessage()]);
	});

	it.each([
		['negative', { promptTokens: -1, completionTokens: 4, totalTokens: 3 }],
		['fractional', { promptTokens: 10.5, completionTokens: 4, totalTokens: 14.5 }],
		['incomplete', { promptTokens: 10, completionTokens: 4 }],
		['non-numeric', { promptTokens: '10', completionTokens: 4, totalTokens: 14 }],
	])('filters persisted %s usage instead of loading it', async (_label, usage) => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.files.set(
			path,
			JSON.stringify({
				version: 1,
				messages: [{ ...readyMessage(), usage }],
			}),
		);

		expect(await store.load('Note.md')).toEqual([]);
	});

	it('loads legacy provider usage without a source as provider-reported', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		const legacyMessage = {
			...readyMessage(),
			usage: {
				promptTokens: 10,
				completionTokens: 4,
				totalTokens: 14,
			},
		};
		adapter.files.set(
			path,
			JSON.stringify({ version: 1, messages: [legacyMessage] }),
		);

		expect(await store.load('Note.md')).toEqual([readyMessage()]);
	});

	it('treats a missing version or message list as malformed', async () => {
		for (const value of [{ messages: [] }, { version: 1 }, [1, 2, 3]]) {
			const adapter = new MemoryAdapter();
			const { store, warning } = makeStore(adapter);
			await store.save('Note.md', [readyMessage()]);
			const original = JSON.stringify(value);
			adapter.files.set(threadPath(adapter), original);

			const loaded = await store.load('Note.md');

			expect(loaded).toEqual([]);
			expect(warning).toHaveBeenCalledOnce();
		}
	});
});

describe('ConversationStore paths and atomic writes', () => {
	it('uses unique SHA-256 path keys and bounded sanitized basenames', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const longName = `../${'unsafe / name '.repeat(30)}.md`;

		await store.save('folder/Note.md', [readyMessage()]);
		const firstPath = threadPath(adapter);
		await store.save('other/Note.md', [readyMessage()]);
		const paths = Array.from(adapter.files.keys()).filter((path) =>
			path.endsWith('.json'),
		);
		await store.save(longName, [readyMessage()]);
		const boundedPath = Array.from(adapter.files.keys()).find(
			(path) => path.endsWith('.json') && !paths.includes(path),
		);

		expect(paths).toHaveLength(2);
		expect(new Set(paths).size).toBe(2);
		expect(firstPath).toMatch(/^\.test-config\/emend\/chats\/Note-[a-f0-9]{64}\.json$/);
		expect(boundedPath).toBeDefined();
		expect(boundedPath?.split('/').pop()?.length).toBeLessThanOrEqual(120);
		expect(boundedPath).not.toContain('..');
		expect(boundedPath).not.toContain('unsafe / name');
		expect(boundedPath).toMatch(/[a-f0-9]{64}\.json$/);
	});

	it('writes a temp file and atomically renames it over the thread', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.operations.length = 0;

		await store.save('Note.md', [readyMessage({ content: 'New answer' })]);

		const writes = adapter.operations.filter((operation) =>
			operation.startsWith('write:'),
		);
		const renames = adapter.operations.filter((operation) =>
			operation.startsWith('rename:'),
		);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain('.tmp');
		expect(writes[0]).not.toBe(`write:${path}`);
		expect(renames).toEqual([
			`${renames[0]?.split(':').slice(0, 2).join(':')}:${path}`,
		]);
		expect(adapter.operations.indexOf(writes[0] ?? '')).toBeLessThan(
			adapter.operations.indexOf(renames[0] ?? ''),
		);
		expect(adapter.operations).not.toContain(`remove:${path}`);
		expect(adapter.files.get(path)).toContain('New answer');
		expect(Array.from(adapter.files.keys()).some((key) => key.includes('.tmp'))).toBe(false);
	});

	it('uses atomic DataAdapter processing when rename cannot replace an existing thread', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.rejectOverwrite = true;
		adapter.operations.length = 0;

		await store.save('Note.md', [readyMessage({ content: 'Replacement' })]);

		expect(adapter.files.get(path)).toContain('Replacement');
		expect(adapter.operations).toContain(`process:${path}`);
		expect(adapter.operations).not.toContain(`remove:${path}`);
		expect(Array.from(adapter.files.keys()).some((key) => key.includes('.tmp'))).toBe(false);
	});

	it('serializes saves per note so an older save cannot overwrite a newer one', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		let releaseFirstWrite: (() => void) | undefined;
		let markFirstWriteStarted: (() => void) | undefined;
		const firstWrite = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve;
		});
		const firstWriteStarted = new Promise<void>((resolve) => {
			markFirstWriteStarted = resolve;
		});
		adapter.beforeWrite = async () => {
			if (adapter.operations.filter((item) => item.startsWith('write:')).length === 1) {
				markFirstWriteStarted?.();
				await firstWrite;
			}
		};

		const olderSave = store.save('Note.md', [readyMessage({ content: 'Older' })]);
		const newerSave = store.save('Note.md', [readyMessage({ content: 'Newer' })]);
		await firstWriteStarted;
		expect(adapter.operations.filter((item) => item.startsWith('write:'))).toHaveLength(1);

		releaseFirstWrite?.();
		await Promise.all([olderSave, newerSave]);

		expect((await store.load('Note.md'))[0]?.content).toBe('Newer');
		expect(adapter.operations.filter((item) => item.startsWith('write:'))).toHaveLength(2);
	});

	it('captures the ready-message snapshot when save is called', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const messages = [readyMessage({ content: 'Original' })];
		const saving = store.save('Note.md', messages);
		messages[0]!.content = 'Mutated later';

		await saving;

		expect((await store.load('Note.md'))[0]?.content).toBe('Original');
	});
});

describe('ConversationStore corruption recovery', () => {
	it('leaves malformed JSON untouched on load and warns without echoing data', async () => {
		const adapter = new MemoryAdapter();
		const { store, warning } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		const malformed = '{not-json: do-not-echo-this-secret}';
		adapter.files.set(path, malformed);
		adapter.operations.length = 0;

		expect(await store.load('Note.md')).toEqual([]);

		expect(adapter.files.get(path)).toBe(malformed);
		expect(adapter.operations).toEqual([]);
		expect(warning).toHaveBeenCalledOnce();
		expect(warning.mock.calls[0]?.[0]).not.toContain('do-not-echo-this-secret');
	});

	it('backs up malformed data once per save and atomically writes the replacement', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		const malformed = '{broken original}';
		adapter.files.set(path, malformed);

		await store.load('Note.md');
		await store.save('Note.md', [readyMessage({ content: 'Recovered' })]);

		expect(adapter.files.get(`${path}.corrupt`)).toBe(malformed);
		expect(JSON.parse(adapter.files.get(path) ?? '')).toMatchObject({ version: 1 });
		expect(adapter.files.get(path)).toContain('Recovered');
		expect(adapter.operations.filter((operation) => operation.includes('.corrupt'))).toHaveLength(1);
	});

	it('reuses the single corrupt backup for later corruption', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.files.set(path, 'first malformed');
		await store.load('Note.md');
		await store.save('Note.md', [readyMessage()]);
		adapter.files.set(path, 'second malformed');
		await store.load('Note.md');

		await store.save('Note.md', [readyMessage({ content: 'Recovered again' })]);

		expect(adapter.files.get(`${path}.corrupt`)).toBe('second malformed');
		expect(
			Array.from(adapter.files.keys()).filter((key) => key.includes('.corrupt')),
		).toEqual([`${path}.corrupt`]);
	});

	it('never overwrites an unsupported future schema version', async () => {
		const adapter = new MemoryAdapter();
		const { store, warning } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		const future = JSON.stringify({ version: 2, messages: [readyMessage()] });
		adapter.files.set(path, future);
		adapter.operations.length = 0;

		expect(await store.load('Note.md')).toEqual([]);
		expect(warning).toHaveBeenCalledOnce();
		await expect(store.save('Note.md', [readyMessage()])).rejects.toThrow(
			/unsupported/i,
		);

		expect(adapter.files.get(path)).toBe(future);
		expect(adapter.files.has(`${path}.corrupt`)).toBe(false);
		expect(adapter.operations).toEqual([]);
	});
});
