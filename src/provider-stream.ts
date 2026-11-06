import { formatProviderHistory } from './provider-history';
import type { ProviderConfig, ProviderHistoryMessage } from './types';

const MAX_PROVIDER_ERROR_CHARACTERS = 2000;

export interface ProviderTokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export type StreamEvent =
	| { type: 'content' | 'reasoning'; text: string }
	| { type: 'usage'; usage: ProviderTokenUsage }
	| { type: 'done' };

export interface ProviderToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ProviderToolCall {
	id: string;
	name: string;
	arguments: string;
}

export type ProviderContinuationMessage =
	| { role: 'assistant'; content: string; toolCalls: ProviderToolCall[] }
	| { role: 'tool'; toolCallId: string; content: string };

export interface AiProviderRequest {
	provider: ProviderConfig;
	systemPrompt: string;
	userPrompt: string;
	history: ProviderHistoryMessage[];
	tools?: ProviderToolDefinition[];
	continuation?: ProviderContinuationMessage[];
}

export interface StreamResult {
	content: string;
	reasoning: string;
	usage?: ProviderTokenUsage;
	finishReason?: string;
	toolCalls?: ProviderToolCall[];
}

interface ProviderRoundState {
	finishReason?: string;
	toolCalls: ProviderToolCall[];
}

export async function requestAiResponse(
	request: AiProviderRequest,
	callbacks: { onEvent(event: StreamEvent): void },
	signal: AbortSignal,
): Promise<StreamResult> {
	const provider = request.provider;
	const apiKey = provider.apiKey.trim();
	const model = provider.model.trim();
	const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
	if (!apiKey) {
		throw new Error(`${provider.name} API key is missing.`);
	}
	if (!model) {
		throw new Error(`${provider.name} model name is missing.`);
	}
	if (!baseUrl) {
		throw new Error(`${provider.name} base URL is missing.`);
	}

	let parsedBaseUrl: URL;
	try {
		parsedBaseUrl = new URL(baseUrl);
	} catch {
		throw new Error(`${provider.name} base URL must be a valid HTTP(S) URL.`);
	}
	if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
		throw new Error(`${provider.name} base URL must use HTTP or HTTPS.`);
	}

	try {
		// eslint-disable-next-line no-restricted-globals -- requestUrl does not expose streaming response bodies.
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: 'system', content: request.systemPrompt },
					...formatProviderHistory(request.history.slice(-8)),
					{ role: 'user', content: request.userPrompt },
					...formatContinuationMessages(request.continuation ?? []),
				],
				temperature: 0.3,
				reasoning_effort: provider.reasoningEffort,
				stream: true,
				...(request.tools?.length
					? { tools: request.tools, tool_choice: 'auto' }
					: {}),
				...(provider.requestUsage
					? { stream_options: { include_usage: true } }
					: {}),
			}),
			signal,
		});

		if (!response.ok) {
			const responseText = await response.text();
			throw new Error(formatHttpProviderError(response.status, responseText));
		}
		if (!response.body) {
			throw new Error('The provider response did not contain a stream.');
		}

		const parser = createSseParser();
		const reader = response.body.getReader();
		let content = '';
		let reasoning = '';
		let usage: ProviderTokenUsage | undefined;

		const emit = (events: StreamEvent[]) => {
			for (const event of events) {
				callbacks.onEvent(event);
				if (event.type === 'content') {
					content += event.text;
				} else if (event.type === 'reasoning') {
					reasoning += event.text;
				} else if (event.type === 'usage') {
					usage = event.usage;
				}
			}
		};

		let receivedDone = false;
		try {
			while (!receivedDone) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				const events = parser.push(value);
				receivedDone = events.some((event) => event.type === 'done');
				emit(events);
			}
			if (!receivedDone) {
				emit(parser.finish());
			}

			const round = parser.getRoundState();
			if (
				!content &&
				!reasoning &&
				(round.toolCalls.length === 0 || !request.tools?.length)
			) {
				throw new Error('No text was found in the provider response.');
			}

			const result: StreamResult = { content, reasoning };
			if (usage) {
				result.usage = usage;
			}
			if (round.finishReason) {
				result.finishReason = round.finishReason;
			}
			if (round.toolCalls.length > 0) {
				result.toolCalls = round.toolCalls;
			}
			return result;
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	} catch (error) {
		if (signal.aborted || (isRecord(error) && error.name === 'AbortError')) {
			throw error;
		}
		throw new Error(sanitizeProviderError(error, apiKey));
	}
}

function formatContinuationMessages(messages: ProviderContinuationMessage[]) {
	return messages.map((message) => {
		if (message.role === 'tool') {
			return {
				role: 'tool',
				tool_call_id: message.toolCallId,
				content: message.content,
			};
		}
		return {
			role: 'assistant',
			content: message.content,
			tool_calls: message.toolCalls.map((call) => ({
				id: call.id,
				type: 'function',
				function: { name: call.name, arguments: call.arguments },
			})),
		};
	});
}

export function formatHttpProviderError(status: number, responseText: string) {
	const details = [`API request failed with HTTP ${status}.`];
	let payload: unknown;
	try {
		payload = JSON.parse(responseText);
	} catch {
		payload = undefined;
	}
	const providerError = isRecord(payload) ? payload.error : undefined;
	if (isRecord(providerError)) {
		details.push(formatStreamProviderError(providerError));
	} else if (responseText.trim()) {
		details.push(`Response: ${responseText.trim()}`);
	}
	return details.join('\n');
}

export function sanitizeProviderError(error: unknown, apiKey: string) {
	let message = error instanceof Error ? error.message : String(error);
	message = message.split(apiKey).join('[redacted]');
	message = message.replace(
		/authorization\s*:\s*bearer\s+\S+/gi,
		'[credential redacted]',
	);
	message = message.replace(/bearer\s+\S+/gi, '[credential redacted]');
	if (message.length > MAX_PROVIDER_ERROR_CHARACTERS) {
		message = `${message.slice(0, MAX_PROVIDER_ERROR_CHARACTERS - 12)}…[truncated]`;
	}
	return message || 'The provider request failed.';
}

export function createSseParser(): {
	push(chunk: Uint8Array): StreamEvent[];
	finish(): StreamEvent[];
	getRoundState(): ProviderRoundState;
} {
	const decoder = new TextDecoder();
	const toolCallParts = new Map<number, ProviderToolCall>();
	let finishReason: string | undefined;
	let buffer = '';
	let dataLines: string[] = [];
	let done = false;
	let finished = false;

	function dispatchData(events: StreamEvent[]) {
		if (dataLines.length === 0) {
			return;
		}

		const data = dataLines.join('\n');
		dataLines = [];
		if (data.trim() === '[DONE]') {
			done = true;
			events.push({ type: 'done' });
			return;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(data);
		} catch {
			throw new Error('The provider returned malformed streaming data.');
		}

		if (!isRecord(payload)) {
			throw new Error('The provider returned malformed streaming data.');
		}
		if (payload.error !== undefined) {
			throw new Error(formatStreamProviderError(payload.error));
		}

		const firstChoice: unknown = Array.isArray(payload.choices)
			? (payload.choices as unknown[])[0]
			: undefined;
		const delta = isRecord(firstChoice) && isRecord(firstChoice.delta)
			? firstChoice.delta
			: undefined;
		if (isRecord(firstChoice) && typeof firstChoice.finish_reason === 'string') {
			finishReason = firstChoice.finish_reason;
		}
		if (typeof delta?.content === 'string' && delta.content.length > 0) {
			events.push({ type: 'content', text: delta.content });
		}
		if (
			typeof delta?.reasoning_content === 'string' &&
			delta.reasoning_content.length > 0
		) {
			events.push({ type: 'reasoning', text: delta.reasoning_content });
		}
		if (Array.isArray(delta?.tool_calls)) {
			for (const value of delta.tool_calls) {
				captureToolCallPart(toolCallParts, value);
			}
		}

		const usage = parseTokenUsage(payload.usage);
		if (usage) {
			events.push({ type: 'usage', usage });
		}
	}

	function processLine(line: string, events: StreamEvent[]) {
		if (line === '') {
			dispatchData(events);
			return;
		}
		if (line.startsWith(':')) {
			return;
		}

		const colonIndex = line.indexOf(':');
		const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
		if (field !== 'data') {
			return;
		}

		let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
		if (value.startsWith(' ')) {
			value = value.slice(1);
		}
		dataLines.push(value);
	}

	return {
		push(chunk: Uint8Array): StreamEvent[] {
			if (done || finished) {
				return [];
			}

			const events: StreamEvent[] = [];
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf('\n');
			while (newlineIndex !== -1 && !done) {
				let line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.endsWith('\r')) {
					line = line.slice(0, -1);
				}
				processLine(line, events);
				newlineIndex = buffer.indexOf('\n');
			}
			return events;
		},
		finish(): StreamEvent[] {
			if (done || finished) {
				return [];
			}

			finished = true;
			const events: StreamEvent[] = [];
			buffer += decoder.decode();
			if (buffer.length > 0) {
				let line = buffer;
				buffer = '';
				if (line.endsWith('\r')) {
					line = line.slice(0, -1);
				}
				processLine(line, events);
			}
			if (!done) {
				dispatchData(events);
			}
			return events;
		},
		getRoundState(): ProviderRoundState {
			const toolCalls = Array.from(toolCallParts.entries())
				.sort(([left], [right]) => left - right)
				.map(([, call]) => call);
			for (const call of toolCalls) {
				if (!call.id.trim() || !call.name.trim()) {
					throw new Error('The provider returned a malformed tool call.');
				}
				try {
					JSON.parse(call.arguments);
				} catch {
					throw new Error('The provider returned a malformed tool call.');
				}
			}
			return { finishReason, toolCalls };
		},
	};
}

function captureToolCallPart(
	parts: Map<number, ProviderToolCall>,
	value: unknown,
) {
	if (!isRecord(value) || !Number.isInteger(value.index) || (value.index as number) < 0) {
		throw new Error('The provider returned a malformed tool call.');
	}
	const index = value.index as number;
	const part = parts.get(index) ?? { id: '', name: '', arguments: '' };
	if (typeof value.id === 'string' && value.id && part.id !== value.id) {
		part.id += value.id;
	}
	const fn = isRecord(value.function) ? value.function : undefined;
	if (typeof fn?.name === 'string' && fn.name && part.name !== fn.name) {
		part.name += fn.name;
	}
	if (typeof fn?.arguments === 'string') {
		part.arguments += fn.arguments;
	}
	parts.set(index, part);
}

function parseTokenUsage(value: unknown): ProviderTokenUsage | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: totalTokens,
	} = value;
	if (
		!isTokenCount(promptTokens) ||
		!isTokenCount(completionTokens) ||
		!isTokenCount(totalTokens)
	) {
		return undefined;
	}

	return { promptTokens, completionTokens, totalTokens };
}

function isTokenCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function formatStreamProviderError(value: unknown) {
	if (!isRecord(value)) {
		return 'The provider returned a streaming error.';
	}

	const details = [
		typeof value.message === 'string' && value.message.trim()
			? value.message.trim()
			: 'The provider returned a streaming error.',
	];
	const metadata = [
		formatErrorField('type', value.type),
		formatErrorField('code', value.code),
		formatErrorField('param', value.param),
		formatErrorField('status', value.status),
	].filter((item): item is string => item !== undefined);
	if (metadata.length > 0) {
		details.push(`Details: ${metadata.join(', ')}.`);
	}
	return details.join('\n');
}

function formatErrorField(label: string, value: unknown) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return `${label}=${String(value)}`;
	}
	return `${label}=${JSON.stringify(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
