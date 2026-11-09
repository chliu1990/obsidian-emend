import type {
	AiProviderRequest,
	ProviderToolCall,
	StreamEvent,
	StreamResult,
} from './provider-stream';
import type { ProviderId } from './types';

export type WebSearchMode = 'off' | 'review' | 'auto';
export type EnabledWebSearchMode = Exclude<WebSearchMode, 'off'>;

export interface WebSearchActivity {
	status: 'pending' | 'complete';
	label: string;
}

export interface WebSearchRunOptions {
	mode: EnabledWebSearchMode;
	maxToolCalls: number;
	reviewCalls(calls: readonly WebToolCall[]): Promise<readonly WebToolCall[]>;
	onActivity(activity: WebSearchActivity): void;
	callbacks: { onEvent(event: StreamEvent): void };
	signal: AbortSignal;
}

export interface WebActivityRecord {
	type: 'search' | 'fetch';
	target: string;
	status: 'completed' | 'failed' | 'skipped';
}

export interface WebToolLoopResult {
	content: string;
	reasoning: string;
	sources: WebSource[];
	activities: WebActivityRecord[];
	contentBudgetExhausted: boolean;
	rounds: Array<{ request: AiProviderRequest; result: StreamResult }>;
}

export type WebToolCall =
	| { id: string; name: 'web_search'; query: string }
	| { id: string; name: 'web_fetch'; url: string };

export interface WebSource {
	id: string;
	title: string;
	url: string;
	snippet?: string;
}

export function parseWebToolCall(raw: ProviderToolCall): WebToolCall {
	if (!raw.id.trim()) {
		throw new Error('The provider returned a web tool call without an ID.');
	}
	let args: unknown;
	try {
		args = JSON.parse(raw.arguments);
	} catch {
		throw new Error('The web tool arguments were not valid JSON.');
	}
	if (!isRecord(args)) {
		throw new Error('The web tool arguments must be an object.');
	}
	if (raw.name === 'web_search') {
		if (Object.keys(args).length !== 1 || typeof args.query !== 'string') {
			throw new Error('web_search requires only a query string.');
		}
		const query = args.query.trim();
		if (!query || /[\r\n]/.test(query) || Array.from(query).length > 128) {
			throw new Error('The search query must be a single line with 1 to 128 characters.');
		}
		return { id: raw.id, name: 'web_search', query };
	}
	if (raw.name === 'web_fetch') {
		if (Object.keys(args).length !== 1 || typeof args.url !== 'string') {
			throw new Error('web_fetch requires only a URL string.');
		}
		const url = normalizeWebUrl(args.url.trim());
		if (!url || url.length > 8192) {
			throw new Error('The fetch URL must be a credentialess HTTP(S) URL of at most 8192 characters.');
		}
		return { id: raw.id, name: 'web_fetch', url };
	}
	throw new Error(`Unsupported web tool: ${raw.name}.`);
}

export function normalizeWebUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (
			(url.protocol !== 'http:' && url.protocol !== 'https:') ||
			!url.hostname ||
			url.username ||
			url.password
		) {
			return undefined;
		}
		return url.href;
	} catch {
		return undefined;
	}
}

export function supportsDeepSeekWeb(providerId: ProviderId, model: string) {
	return providerId === 'deepseek' &&
		(model.trim() === 'deepseek-flash' || model.trim() === 'deepseek-v4-pro');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
