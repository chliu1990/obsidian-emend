import type { DataAdapter } from 'obsidian';
import {
	isReadyMessage,
	legacyConversation,
	resolveActiveSession,
	toPersistedMessage,
	validateChatConversation,
	type ChatConversation,
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

const MALFORMED_WARNING =
	'Emend could not read a saved chat. The original file was preserved.';
const UNSUPPORTED_WARNING =
	'Emend found a chat with an unsupported schema version. It will not be overwritten.';
const UNSUPPORTED_ERROR =
	'Cannot save this chat because its stored schema version is unsupported.';

export class ConversationStore {
	private readonly writeQueues = new Map<string, Promise<void>>();
	private readonly chatDirectory: string;

	constructor(
		private readonly adapter: ConversationDataAdapter,
		configDir: string,
		private readonly warn: (message: string) => void,
	) {
		const root = configDir.replace(/\/+$/, '');
		this.chatDirectory = `${root}${root ? '/' : ''}emend/chats`;
	}

	async load(notePath: string): Promise<ChatMessage[]> {
		const loaded = await this.loadConversation(notePath);
		return resolveActiveSession(loaded.conversation)?.messages ?? [];
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

	save(notePath: string, messages: ChatMessage[]): Promise<void> {
		const persistedMessages = messages
			.filter((message) => message.status === 'ready')
			.map((message) => toPersistedMessage(message));
		const previous = this.writeQueues.get(notePath) ?? Promise.resolve();
		const queued = previous
			.catch(() => undefined)
			.then(() => this.writeThread(notePath, persistedMessages));
		this.writeQueues.set(notePath, queued);
		return queued.finally(() => {
			if (this.writeQueues.get(notePath) === queued) {
				this.writeQueues.delete(notePath);
			}
		});
	}

	private async writeThread(notePath: string, messages: ChatMessage[]) {
		const path = await this.getThreadPath(notePath);
		let malformedContents: string | undefined;
		let conversation: ChatConversation | undefined;
		if (await this.adapter.exists(path)) {
			const contents = await this.adapter.read(path);
			const inspection = inspectThread(contents);
			if (inspection.kind === 'unsupported') {
				throw new Error(UNSUPPORTED_ERROR);
			}
			if (inspection.kind === 'malformed') {
				malformedContents = contents;
			} else if (inspection.kind === 'schema3') {
				const activeSession = resolveActiveSession(inspection.conversation);
				conversation = activeSession
					? {
						...inspection.conversation,
						sessions: inspection.conversation.sessions.map((session) =>
							session.id === activeSession.id ? { ...session, messages } : session
						),
					}
					: legacyConversation(messages);
			}
		}
		conversation ??= legacyConversation(messages);

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
