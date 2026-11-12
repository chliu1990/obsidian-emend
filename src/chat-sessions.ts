import type { ChatMessage } from './types';
import { normalizeWebUrl, type WebActivityRecord, type WebSource } from './web-search';

export const CHAT_SESSION_TITLE_MAX_CODE_POINTS = 80;
export const NEW_CHAT_TITLE = 'New chat';

export type ChatSessionTitleSource = 'auto' | 'manual';

export interface ChatSession {
	id: string;
	title: string;
	titleSource: ChatSessionTitleSource;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

export interface ChatConversation {
	version: 3;
	lastActiveSessionId: string | null;
	sessions: ChatSession[];
}

export function createChatSessionId(): string {
	return crypto.randomUUID();
}

export function createChatSession(input: {
	id: string;
	now: number;
	title?: string;
	titleSource?: ChatSessionTitleSource;
	messages?: ChatMessage[];
}): ChatSession {
	const titleSource = input.titleSource ?? 'auto';
	return {
		id: input.id,
		title: input.title === undefined
			? NEW_CHAT_TITLE
			: titleSource === 'manual'
				? normalizeManualTitle(input.title)
				: deriveAutomaticTitle(input.title),
		titleSource,
		createdAt: input.now,
		updatedAt: input.now,
		messages: (input.messages ?? []).filter(isReadyMessage).map(toPersistedMessage),
	};
}

export function deriveAutomaticTitle(prompt: string): string {
	const normalized = normalizeTitleWhitespace(prompt);
	const codePoints = Array.from(normalized);
	if (!codePoints.length) {
		return NEW_CHAT_TITLE;
	}
	if (codePoints.length > CHAT_SESSION_TITLE_MAX_CODE_POINTS) {
		return `${codePoints.slice(0, CHAT_SESSION_TITLE_MAX_CODE_POINTS - 1).join('')}…`;
	}
	return normalized;
}

export function normalizeManualTitle(title: string): string {
	const normalized = normalizeTitleWhitespace(title);
	const length = Array.from(normalized).length;
	if (!length) {
		throw new Error('Chat session title must not be empty.');
	}
	if (length > CHAT_SESSION_TITLE_MAX_CODE_POINTS) {
		throw new Error('Chat session title must be at most 80 Unicode code points.');
	}
	return normalized;
}

export function resolveActiveSession(conversation: ChatConversation): ChatSession | null {
	return conversation.sessions.find(
		(session) => session.id === conversation.lastActiveSessionId,
	) ?? conversation.sessions[0] ?? null;
}

export function reorderChatSessions(
	conversation: ChatConversation,
	orderedIds: readonly string[],
): ChatConversation {
	if (
		orderedIds.length !== conversation.sessions.length ||
		new Set(orderedIds).size !== orderedIds.length
	) {
		throw new Error('Chat session order must contain each session ID exactly once.');
	}
	const sessionsById = new Map(
		conversation.sessions.map((session) => [session.id, session]),
	);
	const sessions = orderedIds.map((id) => {
		const session = sessionsById.get(id);
		if (!session) {
			throw new Error('Chat session order must contain each session ID exactly once.');
		}
		return { ...session };
	});
	return { ...conversation, sessions };
}

export function deleteChatSession(
	conversation: ChatConversation,
	sessionId: string,
): { conversation: ChatConversation; activeSessionId: string | null } {
	const deletedIndex = conversation.sessions.findIndex((session) => session.id === sessionId);
	if (deletedIndex < 0) {
		throw new Error('Chat session does not exist.');
	}
	const sessions = conversation.sessions
		.filter((session) => session.id !== sessionId)
		.map((session) => ({ ...session }));
	let activeSessionId = conversation.lastActiveSessionId;
	if (activeSessionId === sessionId) {
		activeSessionId = sessions[deletedIndex]?.id ?? sessions[deletedIndex - 1]?.id ?? null;
	}
	return {
		conversation: { ...conversation, lastActiveSessionId: activeSessionId, sessions },
		activeSessionId,
	};
}

export function legacyConversation(messages: ChatMessage[]): ChatConversation {
	const readyMessages = messages
		.filter(isReadyMessage)
		.map((message) => normalizeLoadedMessage({ ...message }));
	const firstUser = readyMessages.find((message) => message.role === 'user');
	let createdAt = 0;
	let updatedAt = 0;
	if (readyMessages.length) {
		createdAt = readyMessages[0]?.timestamp ?? 0;
		updatedAt = createdAt;
		for (const message of readyMessages.slice(1)) {
			createdAt = Math.min(createdAt, message.timestamp);
			updatedAt = Math.max(updatedAt, message.timestamp);
		}
	}
	return {
		version: 3,
		lastActiveSessionId: 'legacy',
		sessions: [{
			id: 'legacy',
			title: deriveAutomaticTitle(firstUser?.content ?? ''),
			titleSource: 'auto',
			createdAt,
			updatedAt,
			messages: readyMessages,
		}],
	};
}

export function validateChatConversation(value: unknown): ChatConversation {
	if (!isRecord(value) || value.version !== 3 || !Array.isArray(value.sessions)) {
		throw new Error('Invalid chat conversation.');
	}
	const lastActiveSessionId = value.lastActiveSessionId;
	if (lastActiveSessionId !== null && typeof lastActiveSessionId !== 'string') {
		throw new Error('Invalid chat conversation.');
	}
	const ids = new Set<string>();
	const sessions = value.sessions.map((entry): ChatSession => {
		if (
			!isRecord(entry) ||
			typeof entry.id !== 'string' ||
			!entry.id.length ||
			ids.has(entry.id) ||
			!isPersistedTitle(entry.title) ||
			(entry.titleSource !== 'auto' && entry.titleSource !== 'manual') ||
			typeof entry.createdAt !== 'number' ||
			!Number.isFinite(entry.createdAt) ||
			typeof entry.updatedAt !== 'number' ||
			!Number.isFinite(entry.updatedAt) ||
			!Array.isArray(entry.messages)
		) {
			throw new Error('Invalid chat conversation.');
		}
		ids.add(entry.id);
		return {
			id: entry.id,
			title: entry.title,
			titleSource: entry.titleSource,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			messages: entry.messages
				.filter(isReadyMessage)
				.map((message) => normalizeLoadedMessage({ ...message })),
		};
	});
	if (
		(sessions.length === 0 && lastActiveSessionId !== null) ||
		(sessions.length > 0 &&
			(typeof lastActiveSessionId !== 'string' || !ids.has(lastActiveSessionId)))
	) {
		throw new Error('Invalid chat conversation.');
	}
	return { version: 3, lastActiveSessionId, sessions };
}

export function toPersistedMessage(message: ChatMessage): ChatMessage {
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

export function isReadyMessage(value: unknown): value is ChatMessage {
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

export function normalizeLoadedMessage(message: ChatMessage): ChatMessage {
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

function normalizeTitleWhitespace(title: string): string {
	return title.replace(/\s+/gu, ' ').trim();
}

function isPersistedTitle(value: unknown): value is string {
	return typeof value === 'string' &&
		value === normalizeTitleWhitespace(value) &&
		Array.from(value).length > 0 &&
		Array.from(value).length <= CHAT_SESSION_TITLE_MAX_CODE_POINTS;
}
