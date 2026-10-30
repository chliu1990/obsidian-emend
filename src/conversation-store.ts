import type { DataAdapter } from 'obsidian';
import type { ChatMessage } from './types';

export const CONVERSATION_SCHEMA_VERSION = 1;

export type ConversationDataAdapter = Pick<
	DataAdapter,
	'exists' | 'read' | 'write' | 'mkdir' | 'remove' | 'rename' | 'copy' | 'process'
>;

interface PersistedThread {
	version: typeof CONVERSATION_SCHEMA_VERSION;
	messages: ChatMessage[];
}

type ThreadInspection =
	| { kind: 'valid'; messages: ChatMessage[] }
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
		const pendingWrite = this.writeQueues.get(notePath);
		if (pendingWrite) {
			await pendingWrite.catch(() => undefined);
		}
		const path = await this.getThreadPath(notePath);
		if (!(await this.adapter.exists(path))) {
			return [];
		}

		const inspection = inspectThread(await this.adapter.read(path));
		if (inspection.kind === 'valid') {
			return inspection.messages;
		}
		this.warn(
			inspection.kind === 'unsupported'
				? UNSUPPORTED_WARNING
				: MALFORMED_WARNING,
		);
		return [];
	}

	save(notePath: string, messages: ChatMessage[]): Promise<void> {
		const thread: PersistedThread = {
			version: CONVERSATION_SCHEMA_VERSION,
			messages: messages
				.filter((message) => message.status === 'ready')
				.map((message) => toPersistedMessage(message)),
		};
		const previous = this.writeQueues.get(notePath) ?? Promise.resolve();
		const queued = previous
			.catch(() => undefined)
			.then(() => this.writeThread(notePath, thread));
		this.writeQueues.set(notePath, queued);
		return queued.finally(() => {
			if (this.writeQueues.get(notePath) === queued) {
				this.writeQueues.delete(notePath);
			}
		});
	}

	private async writeThread(notePath: string, thread: PersistedThread) {
		const path = await this.getThreadPath(notePath);
		let malformedContents: string | undefined;
		if (await this.adapter.exists(path)) {
			const contents = await this.adapter.read(path);
			const inspection = inspectThread(contents);
			if (inspection.kind === 'unsupported') {
				throw new Error(UNSUPPORTED_ERROR);
			}
			if (inspection.kind === 'malformed') {
				malformedContents = contents;
			}
		}

		await this.ensureDirectory(this.chatDirectory);
		if (malformedContents !== undefined) {
			await this.adapter.write(`${path}.corrupt`, malformedContents);
		}

		const tempPath = `${path}.${Date.now()}-${Math.random()
			.toString(36)
			.slice(2)}.tmp`;
		const serialized = `${JSON.stringify(thread, null, 2)}\n`;
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

function toPersistedMessage(message: ChatMessage): ChatMessage {
	const persisted: ChatMessage = {
		id: message.id,
		role: message.role,
		content: message.content,
		reasoning: message.reasoning,
		mode: message.mode,
		sourcePath: message.sourcePath,
		status: 'ready',
		timestamp: message.timestamp,
	};
	if (message.usage) {
		persisted.usage = {
			promptTokens: message.usage.promptTokens,
			completionTokens: message.usage.completionTokens,
			totalTokens: message.usage.totalTokens,
		};
	}
	return persisted;
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
	if (value.version !== CONVERSATION_SCHEMA_VERSION) {
		return { kind: 'unsupported' };
	}
	if (!Array.isArray(value.messages)) {
		return { kind: 'malformed' };
	}
	return {
		kind: 'valid',
		messages: value.messages.filter(isReadyMessage),
	};
}

function isReadyMessage(value: unknown): value is ChatMessage {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		(value.role === 'user' || value.role === 'assistant') &&
		typeof value.content === 'string' &&
		typeof value.reasoning === 'string' &&
		isMode(value.mode) &&
		typeof value.sourcePath === 'string' &&
		value.status === 'ready' &&
		typeof value.timestamp === 'number' &&
		Number.isFinite(value.timestamp) &&
		(value.usage === undefined || isTokenUsage(value.usage))
	);
}

function isTokenUsage(value: unknown) {
	return (
		isRecord(value) &&
		typeof value.promptTokens === 'number' &&
		Number.isFinite(value.promptTokens) &&
		typeof value.completionTokens === 'number' &&
		Number.isFinite(value.completionTokens) &&
		typeof value.totalTokens === 'number' &&
		Number.isFinite(value.totalTokens)
	);
}

function isMode(value: unknown) {
	return (
		value === 'ask' ||
		value === 'edit' ||
		value === 'discuss' ||
		value === 'brainstorm'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
