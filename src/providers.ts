import { requestUrl, type RequestUrlParam } from 'obsidian';
import type { EmendSettings } from './types';

export interface AiSuggestionContext {
	markdown: string;
	notePath?: string;
	userMessage: string;
}

export interface AiMessage {
	role: 'user' | 'assistant';
	content: string;
}

export type AiChatResponse =
	| {
			type: 'answer';
			message: string;
	  }
	| {
			type: 'edit';
			updatedMarkdown: string;
			summary?: string;
	  };

interface OpenAiLikeResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
	error?: ProviderErrorPayload;
}

interface ProviderErrorPayload {
	message?: string;
	type?: string;
	code?: string | number | null;
	param?: string | null;
	status?: string;
}

export async function requestAiSuggestion(
	settings: EmendSettings,
	context: AiSuggestionContext,
	history: AiMessage[] = [],
) {
	return requestAiText({
		settings,
		systemPrompt: buildInlineSystemPrompt(),
		userPrompt: buildUserPrompt(context),
		history,
	});
}

export async function requestAiChatResponse(
	settings: EmendSettings,
	context: AiSuggestionContext,
	history: AiMessage[] = [],
): Promise<AiChatResponse> {
	const response = await requestAiText({
		settings,
		systemPrompt: buildChatSystemPrompt(),
		userPrompt: buildUserPrompt(context),
		history,
	});

	return parseChatResponse(response);
}

async function requestAiText(args: {
	settings: EmendSettings;
	systemPrompt: string;
	userPrompt: string;
	history: AiMessage[];
}) {
	const { settings, systemPrompt, userPrompt, history } = args;
	const provider = settings.providers[settings.activeProvider];
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

	return requestOpenAiLikeSuggestion({
		apiKey,
		model,
		url: `${baseUrl}/chat/completions`,
		systemPrompt,
		userPrompt,
		history,
	});
}

function buildInlineSystemPrompt() {
	return [
		'You are Emend, a context-aware writing assistant inside Obsidian.',
		'The user will send the active note as Markdown and a separate message describing what they want.',
		'Return only the Markdown text that should be applied to the note.',
		'Do not include explanations, prefaces, or code fences unless code fences are part of the requested note content.',
	].join('\n');
}

function buildChatSystemPrompt() {
	return [
		'You are Emend, a context-aware writing assistant inside Obsidian.',
		'The user will send the active note as Markdown and a separate message describing what they want.',
		'Classify the user message as either a question about the note or a request to edit the note.',
		'If it is a question, return JSON only: {"type":"answer","message":"your answer"}.',
		'If it asks to add, remove, rewrite, fix, translate, summarize into the note, or otherwise change the note, return JSON only: {"type":"edit","updatedMarkdown":"the complete updated Markdown document","summary":"short summary of the proposed change"}.',
		'For edit responses, updatedMarkdown must be the full active note after applying the requested change. Preserve unchanged Markdown exactly.',
		'Do not wrap the JSON in code fences or add any text outside the JSON object.',
	].join('\n');
}

function buildUserPrompt(context: AiSuggestionContext) {
	const prompt: string[] = [];
	const notePath = context.notePath?.trim();
	if (notePath) {
		prompt.push('Active note path:', notePath, '');
	}

	prompt.push(
		'Active note Markdown:',
		'```markdown',
		context.markdown,
		'```',
		'',
		'User message:',
		context.userMessage,
	);

	return prompt.join('\n');
}

function parseChatResponse(response: string): AiChatResponse {
	const rawJson = stripCodeFence(response.trim());
	const parsed = JSON.parse(rawJson) as Partial<AiChatResponse>;

	if (parsed.type === 'answer' && typeof parsed.message === 'string') {
		return {
			type: 'answer',
			message: parsed.message.trim(),
		};
	}

	if (
		parsed.type === 'edit' &&
		typeof parsed.updatedMarkdown === 'string'
	) {
		return {
			type: 'edit',
			updatedMarkdown: parsed.updatedMarkdown,
			summary:
				typeof parsed.summary === 'string'
					? parsed.summary.trim()
					: undefined,
		};
	}

	throw new Error('The AI returned an invalid chat response.');
}

function stripCodeFence(response: string) {
	const match = response.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	return match?.[1] ?? response;
}

async function requestOpenAiLikeSuggestion(args: {
	apiKey: string;
	model: string;
	url: string;
	systemPrompt: string;
	userPrompt: string;
	history: AiMessage[];
}) {
	const response = await requestProviderUrl({
		url: args.url,
		method: 'POST',
		throw: false,
		headers: {
			Authorization: `Bearer ${args.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: args.model,
			messages: [
				{
					role: 'system',
					content: args.systemPrompt,
				},
				...args.history,
				{
					role: 'user',
					content: args.userPrompt,
				},
			],
			temperature: 0.3,
		}),
	});
	const data = response.json as OpenAiLikeResponse;

	assertOkResponse(response.status, data.error, response.text);

	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('No text was found in the provider response.');
	}

	return content;
}

async function requestProviderUrl(request: RequestUrlParam) {
	return requestUrl({
		...request,
		throw: false,
	});
}

function assertOkResponse(
	status: number,
	error: ProviderErrorPayload | undefined,
	responseText: string,
) {
	if (status >= 200 && status < 300) {
		return;
	}

	throw new Error(formatProviderError(status, error, responseText));
}

function formatProviderError(
	status: number,
	error: ProviderErrorPayload | undefined,
	responseText: string,
) {
	const details = [`API request failed with HTTP ${status}.`];
	const message = error?.message?.trim();

	if (message) {
		details.push(message);
	}

	const metadata = [
		formatErrorField('type', error?.type),
		formatErrorField('code', error?.code),
		formatErrorField('param', error?.param),
		formatErrorField('status', error?.status),
	].filter((value): value is string => Boolean(value));

	if (metadata.length > 0) {
		details.push(`Details: ${metadata.join(', ')}.`);
	}

	const rawResponse = responseText.trim();
	if (!message && rawResponse) {
		details.push(`Response: ${rawResponse}`);
	}

	return details.join('\n');
}

function formatErrorField(label: string, value: unknown) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	return `${label}=${formatErrorValue(value)}`;
}

function formatErrorValue(value: unknown) {
	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}
