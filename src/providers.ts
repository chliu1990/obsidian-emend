import { requestAiResponse } from './provider-stream';
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
	const controller = new AbortController();
	const result = await requestAiResponse(
		{
			provider: args.settings.providers[args.settings.activeProvider],
			systemPrompt: args.systemPrompt,
			userPrompt: args.userPrompt,
			history: args.history,
		},
		{ onEvent: () => undefined },
		controller.signal,
	);
	return result.content;
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
