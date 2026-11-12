import { describe, expect, it, vi } from 'vitest';
import type {
	ChatConversation,
	ChatSession,
} from '../src/chat-sessions';
import {
	ConversationStore,
	type ConversationDataAdapter,
} from '../src/conversation-store';
import type { ChatMessage } from '../src/types';

class MemoryAdapter implements ConversationDataAdapter {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>();
	readonly operations: string[] = [];
	beforeRead: ((path: string) => Promise<void>) | undefined;
	beforeWrite: ((path: string) => Promise<void>) | undefined;
	rejectOverwrite = false;

	async exists(path: string) {
		return this.files.has(path) || this.directories.has(path);
	}

	async read(path: string) {
		await this.beforeRead?.(path);
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
		reasoning: '',
		mode: 'ask',
		sourcePath: 'Note.md',
		status: 'ready',
		timestamp: 100,
		...overrides,
	};
}

function userMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return readyMessage({
		id: 'user-1',
		role: 'user',
		content: 'Question',
		...overrides,
	});
}

function session(id: string, overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id,
		title: `Chat ${id}`,
		titleSource: 'auto',
		createdAt: 100,
		updatedAt: 100,
		messages: [],
		...overrides,
	};
}

function conversation(
	lastActiveSessionId: string | null,
	sessions: ChatSession[],
): ChatConversation {
	return { version: 3, lastActiveSessionId, sessions };
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function makeStore(adapter: MemoryAdapter) {
	const warning = vi.fn();
	const store = new ConversationStore(adapter, '.test-config', warning);
	return { store, warning };
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

function persistedConversation(adapter: MemoryAdapter): ChatConversation {
	return JSON.parse(adapter.files.get(threadPath(adapter)) ?? '') as ChatConversation;
}

async function seedConversation(
	store: ConversationStore,
	adapter: MemoryAdapter,
	value: ChatConversation,
) {
	await store.createSession('Note.md', session('seed', { messages: [] }));
	adapter.files.set(threadPath(adapter), JSON.stringify(value));
	adapter.operations.length = 0;
}

describe('ConversationStore exact-ID session mutations', () => {
	it('creates and activates a session by default', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const input = session('one', { messages: [userMessage()] });

		await expect(store.createSession('Note.md', input)).resolves.toEqual(input);

		expect(persistedConversation(adapter)).toEqual(conversation('one', [input]));
	});

	it('can create without changing the existing active session', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [session('one')]));

		await store.createSession('Note.md', session('two'), { activate: false });

		expect(persistedConversation(adapter)).toEqual(conversation('one', [
			session('one'),
			session('two'),
		]));
	});

	it('rejects a duplicate session ID without writing', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const original = conversation('one', [session('one')]);
		await seedConversation(store, adapter, original);

		await expect(store.createSession('Note.md', session('one'))).rejects.toThrow(
			/already exists/i,
		);

		expect(persistedConversation(adapter)).toEqual(original);
		expect(adapter.operations).toEqual([]);
	});

	it('snapshots a new session and nested message data at invocation', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const message = readyMessage({
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, source: 'provider' },
			webSources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source' }],
		});
		const input = session('one', { messages: [message] });

		const creating = store.createSession('Note.md', input);
		input.title = 'Changed later';
		input.messages.length = 0;
		message.content = 'Changed later';
		if (message.usage) {
			message.usage.promptTokens = 99;
		}
		const firstSource = message.webSources?.[0];
		if (firstSource) {
			firstSource.title = 'Changed later';
		}
		await creating;

		const persisted = persistedConversation(adapter).sessions[0];
		expect(persisted?.title).toBe('Chat one');
		expect(persisted?.messages[0]?.content).toBe('Answer');
		expect(persisted?.messages[0]?.usage?.promptTokens).toBe(1);
		expect(persisted?.messages[0]?.webSources?.[0]?.title).toBe('Source');
	});

	it('appends a ready user without deriving an automatic title', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [session('one')]));

		const result = await store.appendReadyMessage(
			'Note.md',
			'one',
			userMessage(),
			{ titlePrompt: 'Ignored user prompt', now: 500 },
		);

		expect(result).toEqual(session('one', {
			updatedAt: 500,
			messages: [userMessage()],
		}));
		expect(persistedConversation(adapter).sessions[0]).toEqual(result);
	});

	it('persists a ready assistant and its captured automatic title in one write', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const provider = vi.fn();
		vi.stubGlobal('fetch', provider);
		await seedConversation(store, adapter, conversation('one', [
			session('one', { title: 'New chat', messages: [userMessage()] }),
		]));

		const result = await store.appendReadyMessage(
			'Note.md',
			'one',
			readyMessage({ id: 'answer-1' }),
			{ titlePrompt: '  First\n captured   prompt  ', now: 900 },
		);

		expect(result.title).toBe('First captured prompt');
		expect(result.updatedAt).toBe(900);
		expect(result.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1']);
		expect(adapter.operations.filter((operation) => operation.startsWith('write:'))).toHaveLength(1);
		expect(adapter.operations.filter((operation) => operation.startsWith('rename:'))).toHaveLength(1);
		expect(provider).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('rejects an aborted assistant append after validation without writing or deriving its title', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const original = conversation('one', [
			session('one', { title: 'New chat', messages: [userMessage()] }),
		]);
		await seedConversation(store, adapter, original);
		const readStarted = deferred();
		const releaseRead = deferred();
		adapter.beforeRead = async () => {
			readStarted.resolve();
			await releaseRead.promise;
		};
		const controller = new AbortController();
		const options = { titlePrompt: 'Aborted title', signal: controller.signal };

		const appending = store.appendReadyMessage('Note.md', 'one', readyMessage(), options);
		await readStarted.promise;
		const rejected = expect(appending).rejects.toThrow(/abort/i);
		controller.abort();
		releaseRead.resolve();
		await rejected;

		expect(persistedConversation(adapter)).toEqual(original);
		expect(adapter.operations).toEqual([]);
	});

	it('keeps a manual title unchanged on assistant completion', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [
			session('one', { title: 'Pinned title', titleSource: 'manual' }),
		]));

		const result = await store.appendReadyMessage(
			'Note.md',
			'one',
			readyMessage(),
			{ titlePrompt: 'Replacement title', now: 700 },
		);

		expect(result).toMatchObject({
			title: 'Pinned title',
			titleSource: 'manual',
			updatedAt: 700,
		});
	});

	it.each(['loading', 'stopped', 'error'] as const)(
		'rejects a %s message without writing',
		async (status) => {
			const adapter = new MemoryAdapter();
			const { store } = makeStore(adapter);
			const original = conversation('one', [session('one')]);
			await seedConversation(store, adapter, original);

			await expect(store.appendReadyMessage(
				'Note.md',
				'one',
				readyMessage({ status }),
			)).rejects.toThrow(/ready/i);

			expect(persistedConversation(adapter)).toEqual(original);
			expect(adapter.operations).toEqual([]);
		},
	);

	it('rejects an append for a missing session without creating it', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const original = conversation('one', [session('one')]);
		await seedConversation(store, adapter, original);

		await expect(store.appendReadyMessage(
			'Note.md',
			'missing',
			readyMessage(),
		)).rejects.toThrow(/does not exist/i);

		expect(persistedConversation(adapter)).toEqual(original);
		expect(adapter.operations).toEqual([]);
	});

	it('snapshots an appended message and options at invocation', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [session('one')]));
		const message = readyMessage({
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, source: 'provider' },
		});
		const options = { titlePrompt: 'Captured title', now: 800 };

		const appending = store.appendReadyMessage('Note.md', 'one', message, options);
		message.content = 'Changed later';
		if (message.usage) {
			message.usage.totalTokens = 99;
		}
		options.titlePrompt = 'Changed later';
		options.now = 999;
		await appending;

		const persisted = persistedConversation(adapter).sessions[0];
		expect(persisted?.title).toBe('Captured title');
		expect(persisted?.updatedAt).toBe(800);
		expect(persisted?.messages[0]?.content).toBe('Answer');
		expect(persisted?.messages[0]?.usage?.totalTokens).toBe(3);
	});

	it('sets the exact active session without changing timestamps', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [
			session('one'),
			session('two', { createdAt: 200, updatedAt: 300 }),
		]));

		await store.setActiveSession('Note.md', 'two');

		expect(persistedConversation(adapter)).toEqual(conversation('two', [
			session('one'),
			session('two', { createdAt: 200, updatedAt: 300 }),
		]));
	});

	it('renames exactly one session as manual and updates only its timestamp', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [
			session('one'),
			session('two', { createdAt: 200, updatedAt: 300 }),
		]));

		const renamed = await store.renameSession(
			'Note.md',
			'two',
			'  My\n manual   title  ',
			{ now: 400 },
		);

		expect(renamed).toEqual(session('two', {
			title: 'My manual title',
			titleSource: 'manual',
			createdAt: 200,
			updatedAt: 400,
		}));
		expect(persistedConversation(adapter).sessions).toEqual([session('one'), renamed]);
	});

	it.each([
		['next', 'two', 'three'],
		['previous', 'three', 'two'],
	] as const)('uses the %s sibling when deleting an active session', async (_label, deleted, active) => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation(deleted, [
			session('one'),
			session('two'),
			session('three'),
		]));

		await expect(store.deleteSession('Note.md', deleted)).resolves.toEqual({
			activeSessionId: active,
		});
		expect(persistedConversation(adapter).lastActiveSessionId).toBe(active);
		expect(persistedConversation(adapter).sessions.map((item) => item.id)).not.toContain(deleted);
	});

	it('preserves the active ID when deleting an inactive session', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('two', [
			session('one'),
			session('two'),
		]));

		await expect(store.deleteSession('Note.md', 'one')).resolves.toEqual({
			activeSessionId: 'two',
		});
		expect(persistedConversation(adapter)).toEqual(conversation('two', [session('two')]));
	});

	it('deletes the only session into a persistently empty aggregate', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [session('one')]));

		await expect(store.deleteSession('Note.md', 'one')).resolves.toEqual({
			activeSessionId: null,
		});
		expect(persistedConversation(adapter)).toEqual(conversation(null, []));
	});

	it('reorders the exact current IDs without changing active state or timestamps', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('two', [
			session('one'),
			session('two', { createdAt: 200, updatedAt: 300 }),
			session('three'),
		]));
		const orderedIds = ['three', 'one', 'two'];

		const reordering = store.reorderSessions('Note.md', orderedIds);
		orderedIds.splice(0, orderedIds.length, 'one', 'two', 'three');
		await reordering;

		expect(persistedConversation(adapter)).toEqual(conversation('two', [
			session('three'),
			session('one'),
			session('two', { createdAt: 200, updatedAt: 300 }),
		]));
	});

	it.each([
		['duplicate', ['two', 'two']],
		['missing', ['one']],
		['unknown', ['one', 'missing']],
		['length mismatch', ['one', 'two', 'three']],
	])('rejects a %s reorder without writing', async (_label, orderedIds) => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const original = conversation('one', [session('one'), session('two')]);
		await seedConversation(store, adapter, original);

		await expect(store.reorderSessions('Note.md', orderedIds)).rejects.toThrow(
			/exactly once/i,
		);

		expect(persistedConversation(adapter)).toEqual(original);
		expect(adapter.operations).toEqual([]);
	});

	it('uses atomic fallback and cleans the temp file for a session mutation', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [session('one')]));
		adapter.rejectOverwrite = true;

		await store.renameSession('Note.md', 'one', 'Renamed');

		expect(adapter.operations).toContain(`process:${threadPath(adapter)}`);
		expect(persistedConversation(adapter).sessions[0]?.title).toBe('Renamed');
		expect(Array.from(adapter.files.keys()).some((path) => path.includes('.tmp'))).toBe(false);
	});
});

describe('ConversationStore queued session mutation composition', () => {
	it('composes create, append, rename, reorder, set-active, and delete from fresh state', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		const firstWriteStarted = deferred();
		const releaseFirstWrite = deferred();
		adapter.beforeWrite = async () => {
			if (adapter.operations.filter((item) => item.startsWith('write:')).length === 1) {
				firstWriteStarted.resolve();
				await releaseFirstWrite.promise;
			}
		};

		const creatingOne = store.createSession('Note.md', session('one'));
		const creatingTwo = store.createSession('Note.md', session('two'), { activate: false });
		const appendingOne = store.appendReadyMessage('Note.md', 'one', userMessage(), { now: 200 });
		const renamingTwo = store.renameSession('Note.md', 'two', 'Pinned two', { now: 300 });
		const reordering = store.reorderSessions('Note.md', ['two', 'one']);
		const settingActive = store.setActiveSession('Note.md', 'two');
		const appendingTwo = store.appendReadyMessage(
			'Note.md',
			'two',
			readyMessage({ id: 'answer-two' }),
			{ titlePrompt: 'Ignored manual title', now: 400 },
		);
		const deletingOne = store.deleteSession('Note.md', 'one');
		await firstWriteStarted.promise;
		expect(adapter.operations.filter((item) => item.startsWith('write:'))).toHaveLength(1);

		releaseFirstWrite.resolve();
		await expect(appendingOne).resolves.toMatchObject({ updatedAt: 200 });
		await expect(renamingTwo).resolves.toMatchObject({ title: 'Pinned two' });
		await Promise.all([
			creatingOne,
			creatingTwo,
			reordering,
			settingActive,
			appendingTwo,
			deletingOne,
		]);

		expect(persistedConversation(adapter)).toEqual(conversation('two', [
			session('two', {
				title: 'Pinned two',
				titleSource: 'manual',
				updatedAt: 400,
				messages: [readyMessage({ id: 'answer-two' })],
			}),
		]));
	});

	it('does not resurrect a deleted session or clobber another session metadata', async () => {
		const adapter = new MemoryAdapter();
		const { store } = makeStore(adapter);
		await seedConversation(store, adapter, conversation('one', [
			session('one', { messages: [userMessage({ id: 'one-user' })] }),
			session('two', { messages: [userMessage({ id: 'two-user' })] }),
			session('three', { messages: [userMessage({ id: 'three-user' })] }),
		]));
		const deleteWriteStarted = deferred();
		const releaseDeleteWrite = deferred();
		adapter.beforeWrite = async () => {
			deleteWriteStarted.resolve();
			await releaseDeleteWrite.promise;
		};

		const deleting = store.deleteSession('Note.md', 'one');
		await deleteWriteStarted.promise;
		const lateAppend = store.appendReadyMessage(
			'Note.md',
			'one',
			readyMessage({ id: 'late-answer' }),
			{ titlePrompt: 'Late title', now: 900 },
		);
		const renamingTwo = store.renameSession('Note.md', 'two', 'Pinned two', { now: 300 });
		const appendingTwo = store.appendReadyMessage(
			'Note.md',
			'two',
			readyMessage({ id: 'two-answer' }),
			{ titlePrompt: 'Ignored', now: 400 },
		);
		const reordering = store.reorderSessions('Note.md', ['three', 'two']);
		const settingActive = store.setActiveSession('Note.md', 'two');
		releaseDeleteWrite.resolve();

		await deleting;
		await expect(lateAppend).rejects.toThrow(/does not exist/i);
		await Promise.all([renamingTwo, appendingTwo, reordering, settingActive]);

		expect(persistedConversation(adapter)).toEqual(conversation('two', [
			session('three', { messages: [userMessage({ id: 'three-user' })] }),
			session('two', {
				title: 'Pinned two',
				titleSource: 'manual',
				updatedAt: 400,
				messages: [
					userMessage({ id: 'two-user' }),
					readyMessage({ id: 'two-answer' }),
				],
			}),
		]));
	});
});
