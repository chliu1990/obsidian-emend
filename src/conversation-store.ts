import type { DataAdapter } from 'obsidian';
import {
	deleteChatSession,
	deriveAutomaticTitle,
	isReadyMessage,
	legacyConversation,
	normalizeManualTitle,
	reorderChatSessions,
	toPersistedMessage,
	validateChatConversation,
	type ChatConversation,
	type ChatSession,
} from './chat-sessions';
import type { ChatMessage } from './types';

export const CONVERSATION_SCHEMA_VERSION = 3;

export type ConversationLoadKind =
	| 'schema3'
	| 'legacy'
	| 'missing'
	| 'malformed'
	| 'unsupported';

export interface LoadedChatConversation {
	kind: ConversationLoadKind;
	conversation: ChatConversation;
}

export type ConversationDataAdapter = Pick<
	DataAdapter,
	'exists' | 'read' | 'write' | 'mkdir' | 'remove' | 'rename' | 'copy' | 'process'
>;

type ThreadInspection =
	| { kind: 'schema3' | 'legacy'; conversation: ChatConversation }
	| { kind: 'malformed' }
	| { kind: 'unsupported' };

type MutationInspection = {
	path: string;
	conversation: ChatConversation;
	kind: 'schema3' | 'legacy' | 'missing' | 'malformed';
	malformedContents?: string;
};

const MALFORMED_WARNING =
	'Emend could not read a saved chat. The original file was preserved.';
const UNSUPPORTED_WARNING =
	'Emend found a chat with an unsupported schema version. It will not be overwritten.';
const UNSUPPORTED_ERROR =
	'Cannot save this chat because its stored schema version is unsupported.';
const MISSING_SESSION_ERROR = 'Chat session does not exist.';

export class ConversationStore {
	private readonly writeQueues = new Map<string, Promise<unknown>>();
	private readonly chatDirectory: string;

	constructor(
		private readonly adapter: ConversationDataAdapter,
		configDir: string,
		private readonly warn: (message: string) => void,
	) {
		const root = configDir.replace(/\/+$/, '');
		this.chatDirectory = `${root}${root ? '/' : ''}emend/chats`;
	}

	async loadConversation(notePath: string): Promise<LoadedChatConversation> {
		const pendingWrite = this.writeQueues.get(notePath);
		if (pendingWrite) {
			await pendingWrite.catch(() => undefined);
		}
		const path = await this.getThreadPath(notePath);
		if (!(await this.adapter.exists(path))) {
			return { kind: 'missing', conversation: emptyConversation() };
		}

		const inspection = inspectThread(await this.adapter.read(path));
		if (inspection.kind === 'schema3' || inspection.kind === 'legacy') {
			return inspection;
		}
		this.warn(
			inspection.kind === 'unsupported'
				? UNSUPPORTED_WARNING
				: MALFORMED_WARNING,
		);
		return { kind: inspection.kind, conversation: emptyConversation() };
	}

	async createSession(
		notePath: string,
		session: ChatSession,
		options?: { activate?: boolean },
	): Promise<ChatSession> {
		const persistedSession = snapshotSession(session);
		const activate = options?.activate ?? true;
		return this.queueMutation(notePath, (inspection) => {
			if (inspection.conversation.sessions.some((item) => item.id === persistedSession.id)) {
				throw new Error('Chat session already exists.');
			}
			const lastActiveSessionId = activate || !inspection.conversation.lastActiveSessionId
				? persistedSession.id
				: inspection.conversation.lastActiveSessionId;
			return {
				conversation: {
					...inspection.conversation,
					lastActiveSessionId,
					sessions: [...inspection.conversation.sessions, persistedSession],
				},
				result: persistedSession,
			};
		});
	}

	async appendReadyMessage(
		notePath: string,
		sessionId: string,
		message: ChatMessage,
		options?: { titlePrompt?: string; now?: number; signal?: AbortSignal },
	): Promise<ChatSession> {
		if (!isReadyMessage(message)) {
			throw new Error('Only ready chat messages can be appended.');
		}
		const persistedMessage = toPersistedMessage(message);
		const titlePrompt = options?.titlePrompt;
		const now = mutationTimestamp(options?.now);
		return this.queueMutation(notePath, (inspection) => {
			const index = exactSessionIndex(inspection.conversation, sessionId);
			const current = inspection.conversation.sessions[index];
			if (!current) {
				throw new Error(MISSING_SESSION_ERROR);
			}
			const deriveTitle = persistedMessage.role === 'assistant' &&
				current.titleSource === 'auto' &&
				titlePrompt !== undefined;
			const updated: ChatSession = {
				...current,
				title: deriveTitle ? deriveAutomaticTitle(titlePrompt) : current.title,
				updatedAt: now,
				messages: [...current.messages, persistedMessage],
			};
			return {
				conversation: {
					...inspection.conversation,
					sessions: inspection.conversation.sessions.map((session, itemIndex) =>
						itemIndex === index ? updated : session
					),
				},
				result: updated,
			};
		}, options?.signal);
	}

	async setActiveSession(notePath: string, sessionId: string): Promise<void> {
		return this.queueMutation(notePath, (inspection) => {
			exactSessionIndex(inspection.conversation, sessionId);
			return {
				conversation: {
					...inspection.conversation,
					lastActiveSessionId: sessionId,
				},
				result: undefined,
			};
		});
	}

	async renameSession(
		notePath: string,
		sessionId: string,
		title: string,
		options?: { now?: number },
	): Promise<ChatSession> {
		const persistedTitle = normalizeManualTitle(title);
		const now = mutationTimestamp(options?.now);
		return this.queueMutation(notePath, (inspection) => {
			const index = exactSessionIndex(inspection.conversation, sessionId);
			const current = inspection.conversation.sessions[index];
			if (!current) {
				throw new Error(MISSING_SESSION_ERROR);
			}
			const renamed: ChatSession = {
				...current,
				title: persistedTitle,
				titleSource: 'manual',
				updatedAt: now,
			};
			return {
				conversation: {
					...inspection.conversation,
					sessions: inspection.conversation.sessions.map((session, itemIndex) =>
						itemIndex === index ? renamed : session
					),
				},
				result: renamed,
			};
		});
	}

	async deleteSession(
		notePath: string,
		sessionId: string,
	): Promise<{ activeSessionId: string | null }> {
		return this.queueMutation(notePath, (inspection) => {
			const deleted = deleteChatSession(inspection.conversation, sessionId);
			return {
				conversation: deleted.conversation,
				result: { activeSessionId: deleted.activeSessionId },
			};
		});
	}

	async reorderSessions(
		notePath: string,
		orderedIds: readonly string[],
	): Promise<void> {
		const persistedOrder = [...orderedIds];
		return this.queueMutation(notePath, (inspection) => ({
			conversation: reorderChatSessions(inspection.conversation, persistedOrder),
			result: undefined,
		}));
	}

	private queueMutation<T>(
		notePath: string,
		mutate: (inspection: MutationInspection) => {
			conversation: ChatConversation;
			result: T;
		},
		signal?: AbortSignal,
	): Promise<T> {
		const previous = this.writeQueues.get(notePath) ?? Promise.resolve();
		const queued = previous
			.catch(() => undefined)
			.then(async () => {
				const inspection = await this.inspectForMutation(notePath);
				const mutation = mutate(inspection);
				signal?.throwIfAborted();
				await this.writeConversation(
					inspection.path,
					mutation.conversation,
					inspection.malformedContents,
				);
				return mutation.result;
			});
		this.writeQueues.set(notePath, queued);
		return queued.finally(() => {
			if (this.writeQueues.get(notePath) === queued) {
				this.writeQueues.delete(notePath);
			}
		});
	}

	private async inspectForMutation(notePath: string): Promise<MutationInspection> {
		const path = await this.getThreadPath(notePath);
		if (!(await this.adapter.exists(path))) {
			return { path, kind: 'missing', conversation: emptyConversation() };
		}
		const contents = await this.adapter.read(path);
		const inspection = inspectThread(contents);
		if (inspection.kind === 'unsupported') {
			throw new Error(UNSUPPORTED_ERROR);
		}
		if (inspection.kind === 'malformed') {
			return {
				path,
				kind: 'malformed',
				conversation: emptyConversation(),
				malformedContents: contents,
			};
		}
		return { path, kind: inspection.kind, conversation: inspection.conversation };
	}

	private async writeConversation(
		path: string,
		conversation: ChatConversation,
		malformedContents?: string,
	) {
		await this.ensureDirectory(this.chatDirectory);
		if (malformedContents !== undefined) {
			await this.adapter.write(`${path}.corrupt`, malformedContents);
		}

		const tempPath = `${path}.${Date.now()}-${Math.random()
			.toString(36)
			.slice(2)}.tmp`;
		const serialized = `${JSON.stringify(conversation, null, 2)}\n`;
		try {
			await this.adapter.write(tempPath, serialized);
			try {
				await this.adapter.rename(tempPath, path);
			} catch (error) {
				if (!(await this.adapter.exists(path))) {
					throw error;
				}
				await this.adapter.process(path, () => serialized);
				if (await this.adapter.exists(tempPath)) {
					await this.adapter.remove(tempPath);
				}
			}
		} catch (error) {
			if (await this.adapter.exists(tempPath)) {
				await this.adapter.remove(tempPath).catch(() => undefined);
			}
			throw error;
		}
	}

	private async ensureDirectory(path: string) {
		const parts = path.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (await this.adapter.exists(current)) {
				continue;
			}
			try {
				await this.adapter.mkdir(current);
			} catch (error) {
				if (!(await this.adapter.exists(current))) {
					throw error;
				}
			}
		}
	}

	private async getThreadPath(notePath: string) {
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(notePath),
		);
		const hash = Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, '0'),
		).join('');
		const basename = notePath.split('/').pop() ?? 'note';
		const readable = basename
			.replace(/\.md$/i, '')
			.replace(/[^\p{L}\p{N}_-]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'note';
		return `${this.chatDirectory}/${readable}-${hash}.json`;
	}
}

function snapshotSession(session: ChatSession): ChatSession {
	const snapshot: ChatSession = {
		id: session.id,
		title: session.title,
		titleSource: session.titleSource,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messages: session.messages.filter(isReadyMessage).map(toPersistedMessage),
	};
	const [persisted] = validateChatConversation({
		version: 3,
		lastActiveSessionId: snapshot.id,
		sessions: [snapshot],
	}).sessions;
	if (!persisted) {
		throw new Error('Invalid chat session.');
	}
	return persisted;
}

function mutationTimestamp(now: number | undefined): number {
	const timestamp = now ?? Date.now();
	if (!Number.isFinite(timestamp)) {
		throw new Error('Chat session timestamp must be finite.');
	}
	return timestamp;
}

function exactSessionIndex(conversation: ChatConversation, sessionId: string): number {
	const index = conversation.sessions.findIndex((session) => session.id === sessionId);
	if (index < 0) {
		throw new Error(MISSING_SESSION_ERROR);
	}
	return index;
}

function inspectThread(contents: string): ThreadInspection {
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		return { kind: 'malformed' };
	}
	if (!isRecord(value) || typeof value.version !== 'number') {
		return { kind: 'malformed' };
	}
	if (value.version === CONVERSATION_SCHEMA_VERSION) {
		try {
			return { kind: 'schema3', conversation: validateChatConversation(value) };
		} catch {
			return { kind: 'malformed' };
		}
	}
	if (value.version === 1 || value.version === 2) {
		if (!Array.isArray(value.messages)) {
			return { kind: 'malformed' };
		}
		return {
			kind: 'legacy',
			conversation: legacyConversation(value.messages.filter(isReadyMessage)),
		};
	}
	return { kind: 'unsupported' };
}

function emptyConversation(): ChatConversation {
	return {
		version: CONVERSATION_SCHEMA_VERSION,
		lastActiveSessionId: null,
		sessions: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
