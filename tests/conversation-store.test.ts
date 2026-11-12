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

function schema3Conversation() {
	const firstMessage = readyMessage({ id: 'first-message', content: 'First answer' });
	const secondMessage = readyMessage({
		id: 'second-message',
		role: 'user',
		content: 'Second question',
		reasoning: '',
		mode: 'ask',
		usage: undefined,
		timestamp: 1735689601000,
	});
	return {
		version: 3 as const,
		lastActiveSessionId: 'second',
		sessions: [
			{
				id: 'first',
				title: 'First chat',
				titleSource: 'manual' as const,
				createdAt: 100,
				updatedAt: 200,
				messages: [firstMessage],
			},
			{
				id: 'second',
				title: 'Second chat',
				titleSource: 'auto' as const,
				createdAt: 300,
				updatedAt: 400,
				messages: [secondMessage],
			},
		],
	};
}

describe('ConversationStore schema 3 loading and lazy migration', () => {
	it('returns an empty missing aggregate without writing', async () => {
		const adapter = new MemoryAdapter();
		const { store, warning } = makeStore(adapter);

		await expect(store.loadConversation('Note.md')).resolves.toEqual({
			kind: 'missing',
			conversation: { version: 3, lastActiveSessionId: null, sessions: [] },
		});
		expect(adapter.operations).toEqual([]);
		expect(warning).not.toHaveBeenCalled();
	});

	it.each([1, 2])('loads schema %i as one stable legacy session and migrates only on save', async (version) => {
		const adapter = new MemoryAdapter();
		const { store, warning } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const messages = [
			readyMessage({ id: 'latest', timestamp: 3000 }),
			readyMessage({
				id: 'question',
				role: 'user',
				content: '  First   question\nnext  ',
				reasoning: '',
				mode: 'ask',
				usage: undefined,
				timestamp: 1000,
			}),
			readyMessage({ id: 'middle', timestamp: 2000 }),
		];
		const original = JSON.stringify({ version, messages });
		adapter.files.set(path, original);
		adapter.operations.length = 0;

		const expected = {
			kind: 'legacy',
			conversation: {
				version: 3 as const,
				lastActiveSessionId: 'legacy',
				sessions: [{
					id: 'legacy',
					title: 'First question next',
					titleSource: 'auto' as const,
					createdAt: 1000,
					updatedAt: 3000,
					messages,
				}],
			},
		};
		await expect(store.loadConversation('Note.md')).resolves.toEqual(expected);
		await expect(store.loadConversation('Note.md')).resolves.toEqual(expected);
		await expect(store.load('Note.md')).resolves.toEqual(messages);
		expect(adapter.files.get(path)).toBe(original);
		expect(adapter.operations).toEqual([]);
		expect(warning).not.toHaveBeenCalled();

		await store.save('Note.md', messages);

		expect(JSON.parse(adapter.files.get(path) ?? '')).toEqual(expected.conversation);
	});

	it('restores schema 3 order, active ID, and messages without writing', async () => {
		const adapter = new MemoryAdapter();
		const { store, warning } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const conversation = schema3Conversation();
		const original = JSON.stringify(conversation);
		adapter.files.set(path, original);
		adapter.operations.length = 0;

		await expect(store.loadConversation('Note.md')).resolves.toEqual({
			kind: 'schema3',
			conversation,
		});
		await expect(store.load('Note.md')).resolves.toEqual(conversation.sessions[1]!.messages);
		expect(adapter.files.get(path)).toBe(original);
		expect(adapter.operations).toEqual([]);
		expect(warning).not.toHaveBeenCalled();
	});

	it('compatibility save updates a sole existing schema 3 session unambiguously', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const conversation = schema3Conversation();
		conversation.sessions = [conversation.sessions[1]!];
		adapter.files.set(path, JSON.stringify(conversation));
		const replacement = readyMessage({ id: 'replacement', content: 'Replacement' });

		await store.save('Note.md', [replacement]);

		expect(JSON.parse(adapter.files.get(path) ?? '')).toEqual({
			...conversation,
			sessions: [{ ...conversation.sessions[0], messages: [replacement] }],
		});
	});
});

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
		expect(adapter.files.get(threadPath(adapter))).toContain('"version": 3');
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
			sessions: Array<{ messages: Array<Record<string, unknown>> }>;
		};
		const messages = persisted.sessions[0]?.messages ?? [];
		expect(messages).toHaveLength(1);
		expect(messages[0]).toEqual({
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

	it('treats missing legacy fields and invalid schema 3 as malformed without writing', async () => {
		const values = [
			{ messages: [] },
			{ version: 1 },
			[1, 2, 3],
			{ version: 3, lastActiveSessionId: 'missing', sessions: [] },
		];
		for (const value of values) {
			const adapter = new MemoryAdapter();
			const { store, warning } = makeStore(adapter);
			await store.save('Note.md', [readyMessage()]);
			const path = threadPath(adapter);
			const original = JSON.stringify(value);
			adapter.files.set(path, original);
			adapter.operations.length = 0;

			await expect(store.loadConversation('Note.md')).resolves.toEqual({
				kind: 'malformed',
				conversation: { version: 3, lastActiveSessionId: null, sessions: [] },
			});
			expect(adapter.files.get(path)).toBe(original);
			expect(adapter.operations).toEqual([]);
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

		await expect(store.loadConversation('Note.md')).resolves.toEqual({
			kind: 'malformed',
			conversation: { version: 3, lastActiveSessionId: null, sessions: [] },
		});

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
		expect(JSON.parse(adapter.files.get(path) ?? '')).toMatchObject({ version: 3 });
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
		const future = JSON.stringify({ version: 4, messages: [readyMessage()] });
		adapter.files.set(path, future);
		adapter.operations.length = 0;

		await expect(store.loadConversation('Note.md')).resolves.toEqual({
			kind: 'unsupported',
			conversation: { version: 3, lastActiveSessionId: null, sessions: [] },
		});
		expect(warning).toHaveBeenCalledOnce();
		await expect(store.save('Note.md', [readyMessage()])).rejects.toThrow(
			/unsupported/i,
		);

		expect(adapter.files.get(path)).toBe(future);
		expect(adapter.files.has(`${path}.corrupt`)).toBe(false);
		expect(adapter.operations).toEqual([]);
	});
});


describe('ConversationStore web citation migration', () => {
	it('round trips Review/Auto badges and actual sources in schema 3', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const messages = [
			readyMessage({
				id: 'question',
				role: 'user',
				content: 'Research',
				reasoning: '',
				webSearchMode: 'review',
			}),
			readyMessage({
				id: 'answer',
				webSources: [{
					id: 'S1',
					title: 'Actual source',
					url: 'https://example.test/source',
					snippet: 'Evidence',
				}],
				webActivities: [
					{ type: 'search', target: 'activity query', status: 'completed' },
					{ type: 'fetch', target: 'https://example.test/unreadable', status: 'failed' },
					{ type: 'fetch', target: 'https://example.test/skipped', status: 'skipped' },
				],
			}),
		];

		await store.save('Note.md', messages);

		expect(await store.load('Note.md')).toEqual(messages);
		expect(JSON.parse(adapter.files.get(threadPath(adapter)) ?? '')).toMatchObject({ version: 3 });
	});

	it('loads v1 without web metadata and writes v3 on the next save', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		adapter.files.set(path, JSON.stringify({ version: 1, messages: [readyMessage()] }));

		expect(await store.load('Note.md')).toEqual([readyMessage()]);
		await store.save('Note.md', await store.load('Note.md'));

		expect(JSON.parse(adapter.files.get(path) ?? '')).toMatchObject({ version: 3 });
	});

	it('sanitizes malformed and duplicate persisted web metadata', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', [readyMessage()]);
		const path = threadPath(adapter);
		const validSource = { id: 'S1', title: 'Actual', url: 'https://example.test/source', snippet: 'Evidence' };
		adapter.files.set(path, JSON.stringify({
			version: 2,
			messages: [
				{
					...readyMessage({ id: 'question', role: 'user' }),
					webSearchMode: 'invalid',
					webActivity: 'Searching: private query',
				},
				{
					...readyMessage({ id: 'answer' }),
					webSearchMode: 'auto',
					webSources: [
						validSource,
						validSource,
						{ ...validSource, id: 'S2' },
						{ ...validSource, id: 'S3', url: 'https://user:secret@example.test/private' },
						{ ...validSource, id: 'S4', url: 'javascript:alert(1)' },
						{ ...validSource, id: 'S5', snippet: 42 },
					],
					webActivities: [
						{ type: 'search', target: 'activity query', status: 'completed' },
						{ type: 'invalid', target: 'bad', status: 'completed' },
						{ type: 'search', target: 'bad status', status: 'pending' },
						{ type: 'search', target: 'multi\nline', status: 'completed' },
						{ type: 'fetch', target: 'https://user:secret@example.test/private', status: 'failed' },
					],
				},
			],
		}));

		const loaded = await store.load('Note.md');

		expect(loaded[0]).not.toHaveProperty('webSearchMode');
		expect(loaded[0]).not.toHaveProperty('webActivity');
		expect(loaded[1]).not.toHaveProperty('webSearchMode');
		expect(loaded[1]?.webSources).toEqual([validSource]);
		expect(loaded[1]?.webActivities).toEqual([
			{ type: 'search', target: 'activity query', status: 'completed' },
		]);
	});

	it('reloads only ordinary sanitized content, citations, activity, and main reasoning', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const warning = 'Emend could not extract information from 2 web queries. The answer may be incomplete.';
		const message = readyMessage({
			content: `Answer\n\n${warning}`,
			reasoning: 'Main reasoning only',
			webSources: [{ id: 'S1', title: 'Actual', url: 'https://example.test/source' }],
			webActivities: [
				{ type: 'search', target: 'activity query', status: 'completed' },
				{
					type: 'fetch',
					target: 'https://example.test/extraction-failed',
					status: 'failed',
					failureKind: 'extraction',
				},
			],
			webActivity: 'Searching: private query',
			searchQuery: 'private query',
			toolArguments: '{"query":"private query"}',
			toolResult: 'retrieved page',
			requestBody: '{"messages":[]}',
			failedExtractions: 2,
			readerReasoning: 'Private reader reasoning',
			extractedFacts: ['INVENTED_FACT'],
			readerSummary: 'INVENTED_SUMMARY',
			linkLabel: 'WRONG_LINK_LABEL',
			extractionPayload: '{"evidence":["private evidence extract"]}',
			evidenceExtract: 'private evidence extract',
		} as Partial<ChatMessage>);

		await store.save('Note.md', [message]);

		const raw = adapter.files.get(threadPath(adapter)) ?? '';
		expect(raw).toContain(warning);
		expect(raw).toContain('Main reasoning only');
		expect(raw).toContain('https://example.test/source');
		expect(raw).toContain('activity query');
		expect(raw).not.toContain('private query');
		expect(raw).not.toContain('retrieved page');
		expect(raw).not.toContain('requestBody');
		expect(raw).not.toContain('webActivity');
		expect(raw).not.toContain('failedExtractions');
		expect(raw).not.toContain('Private reader reasoning');
		expect(raw).not.toContain('INVENTED_FACT');
		expect(raw).not.toContain('INVENTED_SUMMARY');
		expect(raw).not.toContain('WRONG_LINK_LABEL');
		expect(raw).not.toContain('private evidence extract');
		expect(raw).not.toContain('extractionPayload');
		expect(raw).not.toContain('failureKind');
		expect(await store.load('Note.md')).toEqual([readyMessage({
			content: `Answer\n\n${warning}`,
			reasoning: 'Main reasoning only',
			webSources: [{ id: 'S1', title: 'Actual', url: 'https://example.test/source' }],
			webActivities: [
				{ type: 'search', target: 'activity query', status: 'completed' },
				{
					type: 'fetch',
					target: 'https://example.test/extraction-failed',
					status: 'failed',
				},
			],
		})]);
	});

	it('excludes transient web failure kinds and reasons from persistence', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const message = readyMessage({
			webActivities: [
				{
					type: 'fetch',
					target: 'https://example.test/network',
					status: 'failed',
					failureReason: 'network',
				},
				{
					type: 'fetch',
					target: 'https://example.test/empty',
					status: 'failed',
					failureReason: 'empty',
				},
				{
					type: 'fetch',
					target: 'https://example.test/reader',
					status: 'failed',
					failureKind: 'extraction',
					failureReason: 'reader',
					readerFailureKind: 'format',
				},
				{
					type: 'search',
					target: 'reader query',
					status: 'failed',
					failureKind: 'extraction',
					failureReason: 'reader',
					readerFailureKind: 'limit',
				},
				{
					type: 'fetch',
					target: 'https://example.test/forbidden',
					status: 'failed',
					failureReason: 'http',
					failureStatus: 403,
					attempts: 2,
				},
			],
		});

		await store.save('Note.md', [message]);

		const raw = adapter.files.get(threadPath(adapter)) ?? '';
		expect(raw).not.toContain('failureKind');
		expect(raw).not.toContain('failureReason');
		expect(raw).not.toContain('readerFailureKind');
		expect(raw).not.toContain('failureStatus');
		expect(raw).not.toContain('attempts');
		expect(raw).not.toContain('403');
		expect(await store.load('Note.md')).toEqual([readyMessage({
			webActivities: [
				{ type: 'fetch', target: 'https://example.test/network', status: 'failed' },
				{ type: 'fetch', target: 'https://example.test/empty', status: 'failed' },
				{ type: 'fetch', target: 'https://example.test/reader', status: 'failed' },
				{ type: 'search', target: 'reader query', status: 'failed' },
				{ type: 'fetch', target: 'https://example.test/forbidden', status: 'failed' },
			],
		})]);

		adapter.files.set(threadPath(adapter), JSON.stringify({
			version: 2,
			messages: [{
				...readyMessage(),
				webActivities: [{
					type: 'search',
					target: 'hand edited query',
					status: 'failed',
					failureKind: 'extraction',
					failureReason: 'reader',
					readerFailureKind: 'provider',
					failureStatus: 503,
					attempts: 2,
				}],
			}],
		}));

		expect((await store.load('Note.md'))[0]?.webActivities).toEqual([
			{ type: 'search', target: 'hand edited query', status: 'failed' },
		]);
	});
});


describe('ConversationStore exact-ID mutation migration safeguards', () => {
	const newSession = {
		id: 'new',
		title: 'New chat',
		titleSource: 'auto' as const,
		createdAt: 10,
		updatedAt: 10,
		messages: [],
	};
	const legacyMutations: Array<[
		string,
		(store: ConversationStore) => Promise<unknown>,
	]> = [
		['create', (store) => store.createSession('Note.md', newSession)],
		['append', (store) => store.appendReadyMessage('Note.md', 'legacy', readyMessage())],
		['set-active', (store) => store.setActiveSession('Note.md', 'legacy')],
		['rename', (store) => store.renameSession('Note.md', 'legacy', 'Renamed legacy')],
		['delete', (store) => store.deleteSession('Note.md', 'legacy')],
		['reorder', (store) => store.reorderSessions('Note.md', ['legacy'])],
	];

	it.each(legacyMutations)('migrates a legacy thread on a valid %s mutation', async (_name, mutate) => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		adapter.files.set(path, JSON.stringify({ version: 2, messages: [readyMessage()] }));
		adapter.operations.length = 0;

		await mutate(store);

		expect(JSON.parse(adapter.files.get(path) ?? '')).toMatchObject({ version: 3 });
		await expect(store.loadConversation('Note.md')).resolves.toMatchObject({ kind: 'schema3' });
	});

	const unsupportedMutations: Array<[
		string,
		(store: ConversationStore) => Promise<unknown>,
	]> = [
		['create', (store) => store.createSession('Note.md', newSession)],
		['append', (store) => store.appendReadyMessage('Note.md', 'legacy', readyMessage())],
		['set-active', (store) => store.setActiveSession('Note.md', 'legacy')],
		['rename', (store) => store.renameSession('Note.md', 'legacy', 'Renamed legacy')],
		['delete', (store) => store.deleteSession('Note.md', 'legacy')],
		['reorder', (store) => store.reorderSessions('Note.md', ['legacy'])],
	];

	it.each(unsupportedMutations)('rejects %s without touching an unsupported thread', async (_name, mutate) => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const future = JSON.stringify({ version: 4, sessions: [] });
		adapter.files.set(path, future);
		adapter.operations.length = 0;

		await expect(mutate(store)).rejects.toThrow(/unsupported/i);

		expect(adapter.files.get(path)).toBe(future);
		expect(adapter.files.has(`${path}.corrupt`)).toBe(false);
		expect(adapter.operations).toEqual([]);
	});

	it('backs up malformed bytes for a valid create replacement', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const malformed = '{broken session original}';
		adapter.files.set(path, malformed);
		adapter.operations.length = 0;

		await store.createSession('Note.md', newSession);

		expect(adapter.files.get(`${path}.corrupt`)).toBe(malformed);
		expect(JSON.parse(adapter.files.get(path) ?? '')).toMatchObject({
			version: 3,
			lastActiveSessionId: 'new',
		});
		expect(adapter.operations.filter((operation) => operation.includes('.corrupt'))).toHaveLength(1);
	});

	it('does not back up or replace malformed bytes for a missing exact ID', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await store.save('Note.md', []);
		const path = threadPath(adapter);
		const malformed = '{broken session original}';
		adapter.files.set(path, malformed);
		adapter.operations.length = 0;

		await expect(store.appendReadyMessage('Note.md', 'missing', readyMessage()))
			.rejects.toThrow(/does not exist/i);

		expect(adapter.files.get(path)).toBe(malformed);
		expect(adapter.files.has(`${path}.corrupt`)).toBe(false);
		expect(adapter.operations).toEqual([]);
	});
});
