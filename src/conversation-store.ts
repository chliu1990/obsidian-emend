import type { DataAdapter } from 'obsidian';
import type { ChatMessage } from './types';
import { normalizeWebUrl, type WebActivityRecord, type WebSource } from './web-search';

export const CONVERSATION_SCHEMA_VERSION = 2;

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
			source: message.usage.source,
		};
	}
	if (
		message.role === 'user' &&
		(message.webSearchMode === 'review' || message.webSearchMode === 'auto')
	) {
		persisted.webSearchMode = message.webSearchMode;
	}
	const sources = message.role === 'assistant'
		? sanitizeWebSources(message.webSources)
		: undefined;
	if (sources?.length) {
		persisted.webSources = sources;
	}
	const activities = message.role === 'assistant'
		? sanitizeWebActivities(message.webActivities)
		: undefined;
	if (activities?.length) {
		persisted.webActivities = activities;
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
	if (value.version !== 1 && value.version !== CONVERSATION_SCHEMA_VERSION) {
		return { kind: 'unsupported' };
	}
	if (!Array.isArray(value.messages)) {
		return { kind: 'malformed' };
	}
	return {
		kind: 'valid',
		messages: value.messages.filter(isReadyMessage).map(normalizeLoadedMessage),
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
		Number.isInteger(value.promptTokens) &&
		value.promptTokens >= 0 &&
		typeof value.completionTokens === 'number' &&
		Number.isInteger(value.completionTokens) &&
		value.completionTokens >= 0 &&
		typeof value.totalTokens === 'number' &&
		Number.isInteger(value.totalTokens) &&
		value.totalTokens >= 0 &&
		(value.source === undefined ||
			value.source === 'provider' ||
			value.source === 'estimated')
	);
}

function normalizeLoadedMessage(message: ChatMessage): ChatMessage {
	const normalized = normalizeUsageSource(message);
	delete normalized.webActivity;
	if (normalized.role !== 'user' ||
		(normalized.webSearchMode !== 'review' && normalized.webSearchMode !== 'auto')) {
		delete normalized.webSearchMode;
	}
	if (normalized.role !== 'assistant') {
		delete normalized.webSources;
		delete normalized.webActivities;
	} else {
		const sources = sanitizeWebSources(normalized.webSources);
		if (sources.length) {
			normalized.webSources = sources;
		} else {
			delete normalized.webSources;
		}
		const activities = sanitizeWebActivities(normalized.webActivities);
		if (activities.length) {
			normalized.webActivities = activities;
		} else {
			delete normalized.webActivities;
		}
	}
	return normalized;
}

function sanitizeWebSources(value: unknown): WebSource[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const sources: WebSource[] = [];
	const ids = new Set<string>();
	const urls = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry) ||
			typeof entry.id !== 'string' || !entry.id.trim() ||
			typeof entry.title !== 'string' || !entry.title.trim() ||
			typeof entry.url !== 'string' ||
			(entry.snippet !== undefined && typeof entry.snippet !== 'string')) {
			continue;
		}
		const url = normalizeWebUrl(entry.url);
		if (!url || ids.has(entry.id) || urls.has(url)) {
			continue;
		}
		const source: WebSource = { id: entry.id, title: entry.title, url };
		if (typeof entry.snippet === 'string') {
			source.snippet = entry.snippet;
		}
		ids.add(entry.id);
		urls.add(url);
		sources.push(source);
	}
	return sources;
}

function sanitizeWebActivities(value: unknown): WebActivityRecord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const activities: WebActivityRecord[] = [];
	for (const entry of value) {
		if (!isRecord(entry) ||
			(entry.type !== 'search' && entry.type !== 'fetch') ||
			(entry.status !== 'completed' && entry.status !== 'failed' && entry.status !== 'skipped') ||
			typeof entry.target !== 'string') {
			continue;
		}
		if (entry.type === 'search') {
			const target = entry.target.trim();
			if (!target || /[\r\n]/.test(target) || Array.from(target).length > 128) {
				continue;
			}
			activities.push({ type: 'search', target, status: entry.status });
			continue;
		}
		const target = normalizeWebUrl(entry.target);
		if (target) {
			activities.push({ type: 'fetch', target, status: entry.status });
		}
	}
	return activities;
}

function normalizeUsageSource(message: ChatMessage): ChatMessage {
	if (!message.usage || message.usage.source) {
		return message;
	}
	return {
		...message,
		usage: { ...message.usage, source: 'provider' },
	};
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
