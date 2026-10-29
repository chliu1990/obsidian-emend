import { TFile } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import {
	ReadOnlyRequestCoordinator,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type { RequestContext } from '../src/context';
import type {
	InstructionPromptParts,
	ProviderConfig,
	ProviderHistoryMessage,
} from '../src/types';

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
};

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
	const file = new TFile();
	file.path = 'folder/note.md';
	return {
		file,
		sourceText: '# Note\nOriginal text',
		selection: { from: 0, to: 0 },
		noteLabel: 'folder/note.md',
		markdown: '# Note\nOriginal text',
		...overrides,
	};
}

function successfulRequest(
	events: StreamEvent[] = [
		{ type: 'content', text: 'Streamed answer' },
		{ type: 'reasoning', text: 'Folded reasoning' },
	],
) {
	return vi.fn(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
			_signal: AbortSignal,
		): Promise<StreamResult> => {
			for (const event of events) {
				callbacks.onEvent(event);
			}
			return { content: 'Streamed answer', reasoning: 'Folded reasoning' };
		},
	);
}

function makeCoordinator(
	request = successfulRequest(),
	instructions: InstructionPromptParts = { skillTexts: new Map() },
) {
	const loadInstructions = vi.fn(async () => instructions);
	const coordinator = new ReadOnlyRequestCoordinator({
		provider,
		loadInstructions,
		request,
	});
	return { coordinator, loadInstructions, request };
}

function makeSubmission(
	overrides: Partial<ReadOnlySubmission> = {},
): ReadOnlySubmission {
	return {
		context: makeContext(),
		mode: 'ask',
		prompt: 'What does this note say?',
		history: [],
		callbacks: { onContent: vi.fn(), onReasoning: vi.fn() },
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('ReadOnlyRequestCoordinator', () => {
	it('has no writer dependency and accepts only read-only submission modes', () => {
		type Dependencies = ConstructorParameters<
			typeof ReadOnlyRequestCoordinator
		>[0];
		type Mode = ReadOnlySubmission['mode'];

		expectTypeOf<Dependencies>().not.toHaveProperty('writer');
		expectTypeOf<Dependencies>().not.toHaveProperty('noteWriter');
		expectTypeOf<Mode>().toEqualTypeOf<'ask' | 'discuss' | 'brainstorm'>();
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'streams %s responses only through content and reasoning callbacks',
		async (mode) => {
			const { coordinator, request } = makeCoordinator();
			const submission = makeSubmission({ mode });
			const originalSource = submission.context.sourceText;

			const result = await coordinator.submit(submission);

			expect(result.content).toBe('Streamed answer');
			expect(submission.callbacks.onContent).toHaveBeenCalledExactlyOnceWith(
				'Streamed answer',
			);
			expect(submission.callbacks.onReasoning).toHaveBeenCalledExactlyOnceWith(
				'Folded reasoning',
			);
			expect(submission.context.sourceText).toBe(originalSource);
			const requestArg = request.mock.calls[0]?.[0];
			expect(requestArg?.systemPrompt).toContain('Respond only in chat.');
			expect(requestArg?.systemPrompt).not.toContain('CriticMarkup');
		},
	);

	it('loads current instructions for every request and places skills before AGENTS', async () => {
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([['skills/review/SKILL.md', 'Review skill']]),
		};
		const { coordinator, loadInstructions, request } = makeCoordinator(
			successfulRequest(),
			instructions,
		);

		await coordinator.submit(makeSubmission());
		await coordinator.submit(makeSubmission());

		expect(loadInstructions).toHaveBeenCalledTimes(2);
		for (const call of request.mock.calls) {
			const systemPrompt = call[0].systemPrompt;
			expect(systemPrompt.indexOf('Review skill')).toBeLessThan(
				systemPrompt.indexOf('Agent instructions'),
			);
		}
	});

	it('caps provider history at the last eight ready messages', async () => {
		const { coordinator, request } = makeCoordinator();
		const history: ProviderHistoryMessage[] = Array.from(
			{ length: 12 },
			(_, index) => ({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `ready ${index}`,
			}),
		);

		await coordinator.submit(makeSubmission({ history }));

		expect(request.mock.calls[0]?.[0].history).toEqual(history.slice(-8));
	});

	it('builds prompts from captured context without an opt-in path', async () => {
		const { coordinator, request } = makeCoordinator();

		await coordinator.submit(makeSubmission());

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain('# Note\nOriginal text');
		expect(userPrompt).toContain('What does this note say?');
		expect(userPrompt).not.toContain('folder/note.md');
	});

	it('includes only the explicitly captured opt-in note path', async () => {
		const { coordinator, request } = makeCoordinator();
		const context = makeContext({ notePath: 'Vault/folder/note.md' });

		await coordinator.submit(makeSubmission({ context }));

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain('Vault/folder/note.md');
	});

	it('passes the caller AbortSignal to the provider', async () => {
		const { coordinator, request } = makeCoordinator();
		const controller = new AbortController();

		await coordinator.submit(makeSubmission({ signal: controller.signal }));

		expect(request.mock.calls[0]?.[2]).toBe(controller.signal);
	});

	it.each(['provider error', 'abort'])(
		'does not mutate note text after a %s',
		async (failure) => {
			const error =
				failure === 'abort'
					? new DOMException('Stopped', 'AbortError')
					: new Error('Provider unavailable');
			const request = vi.fn(async () => {
				throw error;
			});
			const { coordinator } = makeCoordinator(request);
			const submission = makeSubmission();
			const originalSource = submission.context.sourceText;

			await expect(coordinator.submit(submission)).rejects.toBe(error);

			expect(submission.context.sourceText).toBe(originalSource);
			expect(submission.callbacks.onContent).not.toHaveBeenCalled();
			expect(submission.callbacks.onReasoning).not.toHaveBeenCalled();
		},
	);
});
