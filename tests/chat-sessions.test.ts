import { describe, expect, it, vi } from 'vitest';
import {
	CHAT_SESSION_TITLE_MAX_CODE_POINTS,
	NEW_CHAT_TITLE,
	createChatSession,
	createChatSessionId,
	deleteChatSession,
	deriveAutomaticTitle,
	legacyConversation,
	normalizeLoadedMessage,
	normalizeManualTitle,
	reorderChatSessions,
	resolveActiveSession,
	toPersistedMessage,
	validateChatConversation,
	type ChatConversation,
	type ChatSession,
} from '../src/chat-sessions';
import type { ChatMessage } from '../src/types';

function readyMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: 'message-1',
		role: 'assistant',
		content: 'Answer',
		reasoning: 'Reasoning',
		mode: 'discuss',
		sourcePath: 'folder/Note.md',
		status: 'ready',
		timestamp: 100,
		...overrides,
	};
}

function session(id: string, overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id,
		title: `Session ${id}`,
		titleSource: 'auto',
		createdAt: 10,
		updatedAt: 20,
		messages: [],
		...overrides,
	};
}

function conversation(...sessions: ChatSession[]): ChatConversation {
	return {
		version: 3,
		lastActiveSessionId: sessions[0]?.id ?? null,
		sessions,
	};
}

describe('chat session titles', () => {
	it('keeps automatic titles at the 79 and 80 code-point boundaries', () => {
		expect(deriveAutomaticTitle('a'.repeat(79))).toBe('a'.repeat(79));
		expect(deriveAutomaticTitle('a'.repeat(80))).toBe('a'.repeat(80));
	});

	it('truncates an 81-code-point automatic title to 79 code points and an ellipsis', () => {
		const title = deriveAutomaticTitle('a'.repeat(81));
		expect(title).toBe(`${'a'.repeat(79)}…`);
		expect(Array.from(title)).toHaveLength(80);
	});

	it('counts astral characters as one code point when truncating', () => {
		const title = deriveAutomaticTitle(` ${'😀'.repeat(81)} `);
		expect(title).toBe(`${'😀'.repeat(79)}…`);
		expect(Array.from(title)).toHaveLength(80);
	});

	it('collapses whitespace and uses the default for empty automatic titles', () => {
		expect(deriveAutomaticTitle('  First\n question  ')).toBe('First question');
		expect(deriveAutomaticTitle(' \n\t ')).toBe(NEW_CHAT_TITLE);
	});

	it('normalizes manual titles without truncating them', () => {
		expect(normalizeManualTitle('  Manual\n chat  ')).toBe('Manual chat');
		expect(Array.from(normalizeManualTitle('😀'.repeat(80)))).toHaveLength(80);
		expect(CHAT_SESSION_TITLE_MAX_CODE_POINTS).toBe(80);
	});

	it('rejects empty and over-80-code-point manual titles', () => {
		expect(() => normalizeManualTitle(' \n\t ')).toThrow();
		expect(() => normalizeManualTitle('a'.repeat(81))).toThrow();
		expect(() => normalizeManualTitle('😀'.repeat(81))).toThrow();
	});
});

describe('chat session construction and active resolution', () => {
	it('uses crypto.randomUUID for new session IDs', () => {
		const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
			'00000000-0000-4000-8000-000000000000',
		);
		expect(createChatSessionId()).toBe('00000000-0000-4000-8000-000000000000');
		expect(randomUUID).toHaveBeenCalledOnce();
		randomUUID.mockRestore();
	});

	it('constructs a default auto-titled session', () => {
		expect(createChatSession({ id: 'new', now: 123 })).toEqual({
			id: 'new',
			title: 'New chat',
			titleSource: 'auto',
			createdAt: 123,
			updatedAt: 123,
			messages: [],
		});
	});

	it('constructs automatic and manual titled sessions with copied ready messages', () => {
		const automatic = createChatSession({
			id: 'automatic',
			now: 10,
			title: '  First\n prompt  ',
		});
		const messages = [
			readyMessage({ id: 'ready' }),
			readyMessage({ id: 'loading', status: 'loading' }),
		];
		const manual = createChatSession({
			id: 'manual',
			now: 20,
			title: '  My\n chat  ',
			titleSource: 'manual',
			messages,
		});

		expect(automatic).toMatchObject({ title: 'First prompt', titleSource: 'auto' });
		expect(manual).toMatchObject({ title: 'My chat', titleSource: 'manual' });
		expect(manual.messages).toEqual([messages[0]]);
		expect(manual.messages).not.toBe(messages);
	});

	it('resolves the last active session and falls back to the first in order', () => {
		const first = session('first');
		const second = session('second');
		expect(resolveActiveSession({
			version: 3,
			lastActiveSessionId: 'second',
			sessions: [first, second],
		})).toBe(second);
		expect(resolveActiveSession({
			version: 3,
			lastActiveSessionId: 'missing',
			sessions: [first, second],
		})).toBe(first);
		expect(resolveActiveSession(conversation())).toBeNull();
	});
});

describe('chat session ordering and deletion', () => {
	it('reorders the exact ID set without changing the active ID or caller input', () => {
		const original = conversation(session('a'), session('b'), session('c'));
		original.lastActiveSessionId = 'b';

		const reordered = reorderChatSessions(original, ['c', 'a', 'b']);

		expect(reordered.sessions.map((item) => item.id)).toEqual(['c', 'a', 'b']);
		expect(reordered.lastActiveSessionId).toBe('b');
		expect(original.sessions.map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(reordered).not.toBe(original);
		expect(reordered.sessions).not.toBe(original.sessions);
	});

	it.each([
		['duplicate', ['a', 'a', 'b']],
		['missing', ['a', 'b']],
		['unknown', ['a', 'b', 'unknown']],
		['length mismatch', ['a', 'b', 'c', 'd']],
	])('rejects a reorder with a %s ID', (_label, orderedIds) => {
		const original = conversation(session('a'), session('b'), session('c'));
		expect(() => reorderChatSessions(original, orderedIds)).toThrow();
		expect(original.sessions.map((item) => item.id)).toEqual(['a', 'b', 'c']);
	});

	it('activates the next sibling after deleting the active session', () => {
		const original = conversation(session('a'), session('b'), session('c'));
		original.lastActiveSessionId = 'b';
		const result = deleteChatSession(original, 'b');

		expect(result.activeSessionId).toBe('c');
		expect(result.conversation.lastActiveSessionId).toBe('c');
		expect(result.conversation.sessions.map((item) => item.id)).toEqual(['a', 'c']);
		expect(original.sessions.map((item) => item.id)).toEqual(['a', 'b', 'c']);
	});

	it('activates the previous sibling after deleting the active last session', () => {
		const original = conversation(session('a'), session('b'), session('c'));
		original.lastActiveSessionId = 'c';
		expect(deleteChatSession(original, 'c').activeSessionId).toBe('b');
	});

	it('preserves the active session when deleting an inactive session', () => {
		const original = conversation(session('a'), session('b'), session('c'));
		original.lastActiveSessionId = 'b';
		const result = deleteChatSession(original, 'a');
		expect(result.activeSessionId).toBe('b');
		expect(result.conversation.lastActiveSessionId).toBe('b');
	});

	it('deletes the last session to an empty aggregate with no active ID', () => {
		const result = deleteChatSession(conversation(session('only')), 'only');
		expect(result).toEqual({
			conversation: { version: 3, lastActiveSessionId: null, sessions: [] },
			activeSessionId: null,
		});
	});
});

describe('legacy conversation conversion', () => {
	it('uses the first ready user prompt and finite message timestamp bounds', () => {
		const messages = [
			readyMessage({ id: 'answer', role: 'assistant', timestamp: -50 }),
			readyMessage({
				id: 'question',
				role: 'user',
				content: '  First\n legacy prompt  ',
				timestamp: -20,
			}),
			readyMessage({ id: 'later', role: 'user', content: 'Later', timestamp: -10 }),
			readyMessage({ id: 'loading', role: 'user', status: 'loading', timestamp: -1000 }),
		];

		expect(legacyConversation(messages)).toEqual({
			version: 3,
			lastActiveSessionId: 'legacy',
			sessions: [{
				id: 'legacy',
				title: 'First legacy prompt',
				titleSource: 'auto',
				createdAt: -50,
				updatedAt: -10,
				messages: messages.slice(0, 3),
			}],
		});
	});

	it('uses the default title and zero timestamps for an empty legacy thread', () => {
		expect(legacyConversation([])).toEqual({
			version: 3,
			lastActiveSessionId: 'legacy',
			sessions: [{
				id: 'legacy',
				title: 'New chat',
				titleSource: 'auto',
				createdAt: 0,
				updatedAt: 0,
				messages: [],
			}],
		});
	});

	it('uses New chat when a legacy thread has no ready user message', () => {
		expect(legacyConversation([readyMessage({ role: 'assistant' })]).sessions[0]?.title)
			.toBe('New chat');
	});
});

describe('shared message serialization', () => {
	it('persists only the existing message allowlist and role-specific web fields', () => {
		const message = readyMessage({
			content: 'Edit applied — 1 change tracked. Review in Track Changes.\nTarget: Full note.\n\nSummary\n\n- Replaced line 1.',
			reasoning: 'Main reasoning',
			usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, source: 'estimated' },
			webSearchMode: 'auto',
			webSources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source' }],
			webActivities: [{ type: 'search', target: 'query', status: 'completed' }],
			webActivity: 'transient activity',
			requestBody: 'private request',
		} as Partial<ChatMessage>);

		expect(toPersistedMessage(message)).toEqual({
			id: 'message-1',
			role: 'assistant',
			content: message.content,
			reasoning: 'Main reasoning',
			mode: 'discuss',
			sourcePath: 'folder/Note.md',
			status: 'ready',
			timestamp: 100,
			usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, source: 'estimated' },
			webSources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source' }],
			webActivities: [{ type: 'search', target: 'query', status: 'completed' }],
		});
	});

	it('normalizes source-less usage and sanitizes loaded web metadata', () => {
		const message = {
			...readyMessage({
				webSources: [
					{ id: 'S1', title: 'Source', url: 'https://example.test/source' },
					{ id: 'S1', title: 'Duplicate', url: 'https://example.test/other' },
					{ id: 'S2', title: 'Credentials', url: 'https://user:secret@example.test/private' },
				],
				webActivities: [
					{ type: 'search', target: ' query ', status: 'failed', failureReason: 'network', attempts: 2 },
					{ type: 'search', target: 'multi\nline', status: 'completed' },
				],
				webActivity: 'transient activity',
			}),
			usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
		} as ChatMessage;

		expect(normalizeLoadedMessage(message)).toEqual(readyMessage({
			usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, source: 'provider' },
			webSources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source' }],
			webActivities: [{ type: 'search', target: 'query', status: 'failed' }],
		}));
	});
});

describe('schema-3 conversation validation', () => {
	it('round trips ordered sessions with active ID and sanitized ready messages', () => {
		const richMessage = readyMessage({
			content: 'Edit applied — 1 change tracked. Review in Track Changes.\nTarget: Selection.\n\nModel summary\n\n- Replaced line 2.',
			reasoning: 'Successful reasoning',
			usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17, source: 'provider' },
			webSources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source', snippet: 'Evidence' }],
			webActivities: [
				{ type: 'search', target: 'query', status: 'completed' },
				{ type: 'fetch', target: 'https://example.test/source', status: 'failed' },
			],
		});
		const value = conversation(
			session('first', { title: 'First chat', messages: [richMessage] }),
			session('second', { title: 'Manual name', titleSource: 'manual', createdAt: -10, updatedAt: 0 }),
		);
		value.lastActiveSessionId = 'second';

		const validated = validateChatConversation(JSON.parse(JSON.stringify(value)));

		expect(validated).toEqual(value);
		expect(validated).not.toBe(value);
		expect(validated.sessions).not.toBe(value.sessions);
	});

	it('filters invalid and non-ready message entries without rejecting the session', () => {
		const valid = readyMessage();
		const value = conversation(session('one', {
			messages: [
				valid,
				readyMessage({ id: 'loading', status: 'loading' }),
				readyMessage({ id: 'bad-time', timestamp: Number.NaN }),
				null as unknown as ChatMessage,
			],
		}));

		expect(validateChatConversation(value).sessions[0]?.messages).toEqual([valid]);
	});

	it('loads legacy source-less usage as provider-reported in schema 3', () => {
		const message = {
			...readyMessage(),
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		};
		const value = conversation(session('one', { messages: [message as ChatMessage] }));
		expect(validateChatConversation(value).sessions[0]?.messages[0]?.usage).toEqual({
			promptTokens: 1,
			completionTokens: 2,
			totalTokens: 3,
			source: 'provider',
		});
	});

	it.each([
		['duplicate IDs', {
			version: 3,
			lastActiveSessionId: 'one',
			sessions: [session('one'), session('one')],
		}],
		['a missing ID', {
			version: 3,
			lastActiveSessionId: 'one',
			sessions: [{ ...session('one'), id: undefined }],
		}],
		['an empty ID', {
			version: 3,
			lastActiveSessionId: '',
			sessions: [session('')],
		}],
	])('rejects %s', (_label, value) => {
		expect(() => validateChatConversation(value)).toThrow();
	});

	it.each([
		['an unknown active reference', conversation(session('one')), 'unknown'],
		['a null active reference with sessions', conversation(session('one')), null],
		['an active reference without sessions', conversation(), 'one'],
	])('rejects %s', (_label, value, lastActiveSessionId) => {
		expect(() => validateChatConversation({ ...value, lastActiveSessionId })).toThrow();
	});

	it.each([
		['empty title', { title: '' }],
		['unnormalized title', { title: ' Two\n lines ' }],
		['overlong title', { title: 'a'.repeat(81) }],
		['invalid title source', { titleSource: 'automatic' }],
		['missing title source', { titleSource: undefined }],
		['non-finite creation timestamp', { createdAt: Number.POSITIVE_INFINITY }],
		['non-numeric update timestamp', { updatedAt: '20' }],
	])('rejects a session with %s', (_label, overrides) => {
		const value = conversation(session('one'));
		value.sessions[0] = { ...value.sessions[0]!, ...overrides } as ChatSession;
		expect(() => validateChatConversation(value)).toThrow();
	});

	it.each([
		['a non-object aggregate', []],
		['the wrong version', { ...conversation(), version: 2 }],
		['a non-array session container', { ...conversation(), sessions: {} }],
		['a non-array message container', conversation(session('one', { messages: {} as ChatMessage[] }))],
	])('rejects %s', (_label, value) => {
		expect(() => validateChatConversation(value)).toThrow();
	});
});
