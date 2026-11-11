import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import {
	accountRequestCharacters,
	type ContextRequestText,
} from '../src/context-accounting';
import {
	buildContextCapacityBarModel,
	buildDraftCapacityEstimate,
	buildFullNoteDraftEstimate,
	buildReadOnlyDraftEstimate,
	buildSelectionDraftEstimate,
	ContextCapacityDisplay,
	formatDraftCapacityBlockMessage,
	type DraftCapacityEstimate,
} from '../src/context-capacity-ui';
import type { RequestContext } from '../src/context';
import { formatVaultQualifiedPath } from '../src/context';
import { getEditStrategy } from '../src/edit-strategy';
import { getSystemPrompt } from '../src/mode';
import { buildUserPrompt } from '../src/request-coordinator';
import { buildSelectionUserPrompt } from '../src/selection-editor';
import type {
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';

type CapacityFields = Pick<
	ProviderConfig,
	'contextWindowTokens' | 'outputReserveTokens' | 'contextCapacityInvalid'
>;

function providerWith(fields: Partial<CapacityFields> = {}): ProviderConfig {
	return {
		name: 'Local test provider',
		baseUrl: 'http://127.0.0.1:8787/v1',
		apiKey: 'dummy-test-key',
		model: 'dummy-model',
		reasoningEffort: 'low',
		requestUsage: false,
		discoveredModels: [],
		contextWindowTokens: null,
		outputReserveTokens: null,
		contextCapacityInvalid: false,
		...fields,
	};
}

function requestWith(
	overrides: Partial<ContextRequestText> = {},
): ContextRequestText {
	return {
		systemPrompt: 'abc',
		userPrompt: 'draft text!',
		history: [],
		...overrides,
	};
}

interface FakeEvent {
	type: string;
	target: FakeElement;
	key?: string;
	preventDefault(): void;
	stopPropagation(): void;
}

class FakeDocument {
	private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

	addEventListener(type: string, listener: (event: FakeEvent) => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: FakeEvent) => void) {
		const listeners = this.listeners.get(type) ?? [];
		this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
	}

	dispatch(type: string, target: FakeElement, key?: string) {
		const event: FakeEvent = { type, target, key, preventDefault: () => undefined, stopPropagation: () => undefined };
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.length ?? 0;
	}
}

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly style: Record<string, string> = {};
	className = '';
	textContent = '';
	hidden = false;
	removed = false;
	parentElement: FakeElement | null = null;
	private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

	constructor(
		readonly tagName = 'div',
		readonly ownerDocument = new FakeDocument(),
	) {}

	createDiv(options?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
		return this.append('div', options);
	}

	createEl(
		tagName: string,
		options?: { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		return this.append(tagName, options);
	}

	addEventListener(type: string, listener: (event: FakeEvent) => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, key?: string) {
		const event: FakeEvent = { type, target: this, key, preventDefault: () => undefined, stopPropagation: () => undefined };
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	contains(candidate: FakeElement): boolean {
		return candidate === this || this.children.some((child) => child.contains(candidate));
	}

	empty() {
		this.children.length = 0;
		this.textContent = '';
	}

	remove() {
		this.removed = true;
	}

	private append(
		tagName: string,
		options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		const child = new FakeElement(tagName, this.ownerDocument);
		child.parentElement = this;
		if (typeof options === 'string') {
			child.className = options;
		} else {
			child.className = options?.cls ?? '';
			child.textContent = options?.text ?? '';
			Object.assign(child.attributes, options?.attr);
		}
		this.children.push(child);
		return child;
	}
}

function findAll(
	root: FakeElement,
	predicate: (element: FakeElement) => boolean,
): FakeElement[] {
	return [
		...(predicate(root) ? [root] : []),
		...root.children.flatMap((child) => findAll(child, predicate)),
	];
}

function findByClass(root: FakeElement, className: string): FakeElement | undefined {
	return findAll(root, (element) => element.className.split(' ').includes(className))[0];
}

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join('\n');
}

function renderDisplay(estimate: DraftCapacityEstimate | undefined) {
	const container = new FakeElement();
	const display = new ContextCapacityDisplay(container as unknown as HTMLElement);
	display.render(estimate);
	const root = container.children[0];
	if (!root) {
		throw new Error('Capacity display root missing.');
	}
	return { container, display, root };
}

function estimateForBar(
	tokens: Record<'system' | 'user' | 'history' | 'tools' | 'continuation', number>,
	capacity: DraftCapacityEstimate['capacity'] = {
		kind: 'valid',
		contextWindowTokens: 100,
		outputReserveTokens: 20,
		effectiveInputTokens: 80,
	},
): DraftCapacityEstimate {
	const estimatedInputTokens = tokens.system + tokens.user + tokens.history +
		tokens.tools + tokens.continuation;
	return {
		capacity,
		categories: {
			system: tokens.system * 4,
			user: tokens.user * 4,
			history: tokens.history * 4,
			tools: tokens.tools * 4,
			continuation: tokens.continuation * 4,
			total: estimatedInputTokens * 4,
			estimatedInputTokens,
		},
		overCapacity: capacity.kind === 'valid' && estimatedInputTokens >= 80,
		blocked: capacity.kind === 'invalid' ||
			(capacity.kind === 'valid' && estimatedInputTokens >= 80),
	};
}

describe('buildContextCapacityBarModel', () => {
	it('uses known token fractions and exact remaining allowances at W=100 R=20 I=60', () => {
		const model = buildContextCapacityBarModel(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));

		expect(model).toEqual({
			estimatedInputTokens: 60,
			effectiveInputTokens: 80,
			remainingInputTokens: 20,
			remainingOutputTokens: 20,
			segments: [
				{ key: 'system', tokens: 10, fraction: 0.1 },
				{ key: 'user', tokens: 20, fraction: 0.2 },
				{ key: 'history', tokens: 15, fraction: 0.15 },
				{ key: 'tools', tokens: 10, fraction: 0.1 },
				{ key: 'continuation', tokens: 5, fraction: 0.05 },
				{ key: 'free', tokens: 20, fraction: 0.2 },
				{ key: 'output', tokens: 20, fraction: 0.2 },
			],
		});
	});

	it.each([
		{ user: 40, input: 80, remainingInput: 0, remainingOutput: 20 },
		{ user: 50, input: 90, remainingInput: 0, remainingOutput: 10 },
		{ user: 60, input: 100, remainingInput: 0, remainingOutput: 0 },
		{ user: 80, input: 120, remainingInput: 0, remainingOutput: 0 },
	])(
		'computes remaining allowances at input $input',
		({ user, input, remainingInput, remainingOutput }) => {
			const model = buildContextCapacityBarModel(estimateForBar({
				system: 10,
				user,
				history: 15,
				tools: 10,
				continuation: 5,
			}));

			expect(model.estimatedInputTokens).toBe(input);
			expect(model.remainingInputTokens).toBe(remainingInput);
			expect(model.remainingOutputTokens).toBe(remainingOutput);
			expect(model.segments.every((segment) => segment.fraction <= 1)).toBe(true);
			expect(model.segments.reduce((sum, segment) => sum + segment.fraction, 0))
				.toBeCloseTo(1);
		},
	);

	it('uses the overflow input as the fraction denominator', () => {
		const model = buildContextCapacityBarModel(estimateForBar({
			system: 10,
			user: 80,
			history: 15,
			tools: 10,
			continuation: 5,
		}));

		expect(model.segments.find((segment) => segment.key === 'user')?.fraction)
			.toBe(80 / 120);
		expect(model.segments.find((segment) => segment.key === 'free')?.tokens).toBe(0);
		expect(model.segments.find((segment) => segment.key === 'output')?.tokens).toBe(0);
	});

	it.each([
		{ kind: 'unconfigured' } as const,
		{ kind: 'invalid', reason: 'Invalid capacity.' } as const,
	])('omits proportional segments and capacity values for $kind capacity', (capacity) => {
		const model = buildContextCapacityBarModel(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}, capacity));

		expect(model).toEqual({ estimatedInputTokens: 60, segments: [] });
	});

	it('includes continuation only when its token estimate is nonzero', () => {
		const withoutContinuation = buildContextCapacityBarModel(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 0,
		}));
		const withContinuation = buildContextCapacityBarModel(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));

		expect(withoutContinuation.segments.some((segment) => segment.key === 'continuation'))
			.toBe(false);
		expect(withContinuation.segments.find((segment) => segment.key === 'continuation'))
			.toEqual({ key: 'continuation', tokens: 5, fraction: 0.05 });
	});
});

describe('buildDraftCapacityEstimate', () => {
	it('classifies unconfigured capacity as unchecked and unblocked', () => {
		const request = requestWith();

		const estimate = buildDraftCapacityEstimate({
			provider: providerWith(),
			request,
		});

		expect(estimate.capacity).toEqual({ kind: 'unconfigured' });
		expect(estimate.categories).toEqual(accountRequestCharacters(request));
		expect(estimate.categories).toMatchObject({
			system: 3,
			user: 11,
			history: 0,
			total: 14,
			estimatedInputTokens: 4,
		});
		expect(estimate.overCapacity).toBe(false);
		expect(estimate.blocked).toBe(false);
	});

	it('reports a valid estimate below the effective input capacity as unblocked', () => {
		const request = requestWith();

		const estimate = buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 1000, outputReserveTokens: 995 }),
			request,
		});

		expect(estimate.capacity).toEqual({
			kind: 'valid',
			contextWindowTokens: 1000,
			outputReserveTokens: 995,
			effectiveInputTokens: 5,
		});
		expect(estimate.categories.estimatedInputTokens).toBe(4);
		expect(estimate.overCapacity).toBe(false);
		expect(estimate.blocked).toBe(false);
	});

	it('treats equality with the effective capacity as over and blocked', () => {
		const request = requestWith();
		const estimate = buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 1000, outputReserveTokens: 996 }),
			request,
		});

		expect(estimate.categories.estimatedInputTokens).toBe(4);
		expect(estimate.capacity).toMatchObject({ effectiveInputTokens: 4 });
		expect(estimate.overCapacity).toBe(true);
		expect(estimate.blocked).toBe(true);
	});

	it('never blocks unconfigured capacity even for a large draft', () => {
		const estimate = buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith({ userPrompt: 'x'.repeat(100000) }),
		});

		expect(estimate.overCapacity).toBe(false);
		expect(estimate.blocked).toBe(false);
	});

	it.each([
		{ contextWindowTokens: 100, outputReserveTokens: 100 },
		{ contextWindowTokens: 100, outputReserveTokens: null },
		{ contextWindowTokens: null, outputReserveTokens: 100 },
		{ contextWindowTokens: 0, outputReserveTokens: 10 },
	])('blocks invalid capacity settings: %o', (fields) => {
		const estimate = buildDraftCapacityEstimate({
			provider: providerWith(fields),
			request: requestWith(),
		});

		expect(estimate.capacity.kind).toBe('invalid');
		expect(estimate.overCapacity).toBe(false);
		expect(estimate.blocked).toBe(true);
	});

	it('uses the shared account totals for every request category', () => {
		const request = requestWith({
			history: [{
				role: 'assistant',
				content: 'Earlier answer',
				mode: 'ask',
				origin: 'model',
			}],
			tools: [{
				type: 'function',
				function: {
					name: 'web_search',
					description: 'Search the web.',
					parameters: { type: 'object' },
				},
			}],
			continuation: [{ role: 'tool', toolCallId: 'call-1', content: 'result' }],
		});

		const estimate = buildDraftCapacityEstimate({
			provider: providerWith(),
			request,
		});

		expect(estimate.categories).toEqual(accountRequestCharacters(request));
		expect(estimate.categories.history).toBeGreaterThan(0);
		expect(estimate.categories.tools).toBeGreaterThan(0);
		expect(estimate.categories.continuation).toBe(6);
	});
});

describe('ContextCapacityDisplay', () => {
	it('renders a focusable segmented meter with capped ARIA values and floating details', () => {
		const { root } = renderDisplay(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));
		const summary = findByClass(root, 'emend-context-capacity-summary');
		const meter = findByClass(root, 'emend-context-capacity-bar');
		const tooltip = findByClass(root, 'emend-context-capacity-details');
		const segments = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-segment'),
		);

		expect(root.attributes.tabindex).toBe('0');
		expect(root.attributes.role).toBeUndefined();
		expect(root.attributes['aria-live']).toBeUndefined();
		expect(summary?.attributes).toMatchObject({
			role: 'status',
			'aria-live': 'polite',
			'aria-label': 'Draft token estimate',
		});
		expect(findAll(root, (element) => element.attributes.role === 'status'))
			.toHaveLength(1);
		expect(meter?.attributes).toMatchObject({
			role: 'meter',
			'aria-valuemin': '0',
			'aria-valuemax': '100',
			'aria-valuenow': '60',
			'aria-valuetext': 'Estimated input: 60 tokens of 80 effective capacity.',
		});
		expect(segments.map((segment) => segment.style.width)).toEqual([
			'10%', '20%', '15%', '10%', '5%', '20%', '20%',
		]);
		expect(segments.map((segment) => segment.className)).toEqual([
			'emend-context-capacity-segment is-system',
			'emend-context-capacity-segment is-user',
			'emend-context-capacity-segment is-history',
			'emend-context-capacity-segment is-tools',
			'emend-context-capacity-segment is-continuation',
			'emend-context-capacity-segment is-free',
			'emend-context-capacity-segment is-output',
		]);
		expect(tooltip?.attributes.role).toBe('tooltip');
		expect(tooltip?.hidden).toBe(true);
		expect(findAll(root, (element) => element.tagName === 'details')).toHaveLength(0);
		expect(textOf(tooltip as FakeElement)).toContain('Estimated input: 60 tokens');
		expect(textOf(tooltip as FakeElement)).toContain('Remaining input: 20 tokens');
		expect(textOf(tooltip as FakeElement)).toContain('Remaining output: 20 tokens');
		expect(textOf(tooltip as FakeElement)).toContain('Effective input capacity: 80 tokens');
		expect(textOf(tooltip as FakeElement)).toContain('Context window: 100 tokens');
		expect(textOf(tooltip as FakeElement)).toContain('Output reserve: 20 tokens');
		expect(textOf(tooltip as FakeElement)).toContain(
			'System: 10 tokens · Draft: 20 tokens · History: 15 tokens · Tools: 10 tokens · Continuation: 5 tokens',
		);
		expect(textOf(tooltip as FakeElement)).toContain('lower-bound');
		expect(textOf(tooltip as FakeElement)).toContain('Excluded from this estimate:');
	});

	it('caps overflow at the window and keeps the segments within the bar', () => {
		const { root } = renderDisplay(estimateForBar({
			system: 10,
			user: 80,
			history: 15,
			tools: 10,
			continuation: 5,
		}));
		const meter = findByClass(root, 'emend-context-capacity-bar');
		const segments = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-segment'),
		);

		expect(meter?.attributes['aria-valuenow']).toBe('100');
		expect(meter?.attributes['aria-valuetext']).toBe(
			'Estimated input: 120 tokens of 80 effective capacity. This draft is over capacity.',
		);
		expect(segments.reduce((sum, segment) => sum + Number.parseFloat(segment.style.width ?? '0'), 0))
			.toBeCloseTo(100);
		expect(root.className).toContain('is-over-capacity');
	});

	it.each([
		{
			name: 'unconfigured',
			estimate: buildDraftCapacityEstimate({ provider: providerWith(), request: requestWith() }),
			state: 'is-unconfigured',
			summary: 'Estimated input: 4 tokens. Capacity checks are off.',
		},
		{
			name: 'invalid',
			estimate: buildDraftCapacityEstimate({
				provider: providerWith({ contextWindowTokens: 100, outputReserveTokens: 100 }),
				request: requestWith(),
			}),
			state: 'is-invalid',
			summary: 'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.',
		},
		{
			name: 'unavailable',
			estimate: undefined,
			state: 'is-unavailable',
			summary: 'Draft estimate unavailable.',
		},
	])('shows the $name summary without a proportional bar', ({ estimate, state, summary }) => {
		const { root } = renderDisplay(estimate);

		expect(findByClass(root, 'emend-context-capacity-summary')?.textContent).toBe(summary);
		expect(findByClass(root, 'emend-context-capacity-bar')).toBeUndefined();
		expect(root.className).toContain(state);
	});

	it('shows on pointer entry and focus, and hides an unpinned panel on exit', () => {
		const { root } = renderDisplay(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));
		const tooltip = findByClass(root, 'emend-context-capacity-details') as FakeElement;

		root.dispatch('pointerenter');
		expect(tooltip.hidden).toBe(false);
		root.dispatch('pointerleave');
		expect(tooltip.hidden).toBe(true);
		root.dispatch('focusin');
		expect(tooltip.hidden).toBe(false);
		root.dispatch('focusout');
		expect(tooltip.hidden).toBe(true);
	});

	it('pins on click until a second click and survives pointer and focus exit', () => {
		const { root } = renderDisplay(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));
		const tooltip = findByClass(root, 'emend-context-capacity-details') as FakeElement;

		root.dispatch('click');
		root.dispatch('pointerleave');
		root.dispatch('focusout');
		expect(tooltip.hidden).toBe(false);
		root.dispatch('click');
		expect(tooltip.hidden).toBe(true);
	});

	it('refreshes an open tooltip without closing it or replacing the live summary', () => {
		const initial = estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		});
		const { display, root } = renderDisplay(initial);
		const summary = findByClass(root, 'emend-context-capacity-summary');
		const tooltip = findByClass(root, 'emend-context-capacity-details') as FakeElement;
		root.dispatch('click');

		display.render(estimateForBar({
			system: 10,
			user: 50,
			history: 15,
			tools: 10,
			continuation: 5,
		}));

		expect(findByClass(root, 'emend-context-capacity-details')).toBe(tooltip);
		expect(tooltip.hidden).toBe(false);
		expect(textOf(tooltip)).toContain('Estimated input: 90 tokens');
		expect(textOf(tooltip)).toContain('Remaining output: 10 tokens');
		expect(findByClass(root, 'emend-context-capacity-summary')).toBe(summary);
		expect(tooltip.attributes['aria-live']).toBeUndefined();
	});

	it('dismisses a pinned tooltip with Escape or an outside pointer press', () => {
		const { root } = renderDisplay(estimateForBar({
			system: 10,
			user: 20,
			history: 15,
			tools: 10,
			continuation: 5,
		}));
		const tooltip = findByClass(root, 'emend-context-capacity-details') as FakeElement;

		root.dispatch('click');
		root.dispatch('keydown', 'Escape');
		expect(tooltip.hidden).toBe(true);
		root.dispatch('click');
		root.ownerDocument.dispatch('pointerdown', root);
		expect(tooltip.hidden).toBe(false);
		root.ownerDocument.dispatch('pointerdown', new FakeElement('div', root.ownerDocument));
		expect(tooltip.hidden).toBe(true);
	});

	it('exposes the authoritative invalid message for blocked submissions', () => {
		const estimate = buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 100, outputReserveTokens: 100 }),
			request: requestWith(),
		});

		expect(formatDraftCapacityBlockMessage(estimate)).toBe(
			'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.',
		);
		expect(formatDraftCapacityBlockMessage(undefined)).toBeUndefined();
		expect(formatDraftCapacityBlockMessage(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith(),
		}))).toBeUndefined();
	});

	it('removes its root and document listener on destroy and ignores later renders', () => {
		const { container, display, root } = renderDisplay(undefined);

		display.destroy();
		display.render(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith(),
		}));

		expect(root.removed).toBe(true);
		expect(root.ownerDocument.listenerCount('pointerdown')).toBe(0);
		expect(container.children).toHaveLength(1);
		expect(textOf(root)).toContain('Draft estimate unavailable.');
		expect(textOf(root)).not.toContain('Estimated input:');
	});
});

function draftContext(overrides: Partial<RequestContext> = {}): RequestContext {
	const file = new TFile();
	file.path = 'Note.md';
	return {
		file,
		sourceText: `Alpha beta gamma. ${'Context sentence. '.repeat(80)}`,
		selection: { from: 6, to: 10 },
		noteLabel: file.path,
		markdown: 'Alpha beta gamma.',
		...overrides,
	};
}

function draftSnapshot(
	context: RequestContext,
	overrides: Partial<SelectionSnapshot> = {},
): SelectionSnapshot {
	return {
		file: context.file,
		fullText: context.sourceText,
		selectedText: 'beta',
		from: 6,
		to: 10,
		...overrides,
	};
}

function draftHistory(): ProviderHistoryMessage[] {
	return [
		{ role: 'user', content: 'Earlier question', mode: 'ask', origin: 'user' },
		{ role: 'assistant', content: 'Earlier answer', mode: 'ask', origin: 'model' },
	];
}

describe('shared draft estimate builders', () => {
	const provider = providerWith({
		contextWindowTokens: 1000,
		outputReserveTokens: 100,
	});

	it.each([
		'ask',
		'discuss',
		'brainstorm',
	] as const)('matches the direct %s read-only assembly', (mode: Exclude<Mode, 'edit'>) => {
		const context = draftContext({ notePath: 'Vault/Note.md' });
		const history = draftHistory();

		const estimate = buildReadOnlyDraftEstimate({
			provider,
			context,
			mode,
			prompt: 'Question about the note.',
			history,
		});
		const expected = buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getSystemPrompt(mode, undefined),
				userPrompt: buildUserPrompt(context, 'Question about the note.', []),
				history,
			},
		});

		expect(estimate).toEqual(expected);
		expect(estimate.categories.history).toBeGreaterThan(0);
	});

	it('uses the bounded read-only Markdown instead of the complete source', () => {
		const context = draftContext({ markdown: 'Window only.' });

		const readOnly = buildReadOnlyDraftEstimate({
			provider,
			context,
			mode: 'ask',
			prompt: 'Question',
			history: [],
		});
		const fullNote = buildFullNoteDraftEstimate({
			provider,
			context,
			prompt: 'Question',
			history: [],
		});

		expect(readOnly.categories.user).toBeLessThan(fullNote.categories.user);
		expect(readOnly).toEqual(buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getSystemPrompt('ask', undefined),
				userPrompt: buildUserPrompt(context, 'Question', []),
				history: [],
			},
		}));
	});

	it('matches the direct full-note assembly with the complete source', () => {
		const context = draftContext({
			sourceText: `Intro.\n${'Long paragraph. '.repeat(300)}`,
			markdown: 'Window only.',
			notePath: 'Vault/Note.md',
		});
		const history = draftHistory();

		const estimate = buildFullNoteDraftEstimate({
			provider,
			context,
			prompt: 'Fix the wording.',
			history,
		});
		const expected = buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getEditStrategy().getFullNotePrompt(undefined),
				userPrompt: buildUserPrompt(
					context,
					'Fix the wording.',
					[],
					context.sourceText,
				),
				history,
			},
		});

		expect(estimate).toEqual(expected);
		expect(estimate).toEqual(buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getEditStrategy().getFullNotePrompt(undefined),
				userPrompt: buildUserPrompt(context, 'Fix the wording.', [], context.sourceText),
				history,
			},
		}));
	});

	it.each([
		{ smartSelectionContext: true, includePath: true },
		{ smartSelectionContext: true, includePath: false },
		{ smartSelectionContext: false, includePath: true },
		{ smartSelectionContext: false, includePath: false },
	])(
		'matches the direct Selection assembly (smart=$smartSelectionContext, path=$includePath)',
		({ smartSelectionContext, includePath }) => {
			const context = draftContext({
				sourceText: `Alpha ${'word '.repeat(400)}beta ${'tail '.repeat(200)}`,
				notePath: includePath ? 'Vault/Note.md' : undefined,
			});
			const snapshot = draftSnapshot(context);
			const history = draftHistory();
			const notePath = includePath
				? formatVaultQualifiedPath('Vault', snapshot.file.path)
				: undefined;

			const estimate = buildSelectionDraftEstimate({
				provider,
				snapshot,
				prompt: 'Tighten this selection.',
				maxContextCharacters: 1000,
				smartSelectionContext,
				notePath,
				history,
			});
			const expected = buildDraftCapacityEstimate({
				provider,
				request: {
					systemPrompt: getEditStrategy().getSelectionPrompt(undefined),
					userPrompt: buildSelectionUserPrompt({
						snapshot,
						prompt: 'Tighten this selection.',
						maxContextCharacters: 1000,
						smartSelectionContext,
						additionalNotes: [],
						notePath,
					}),
					history,
				},
			});

			expect(estimate).toEqual(expected);
		},
	);

	it('lets an explicit note path override the captured context path', () => {
		const context = draftContext({ notePath: 'Vault/Captured.md' });

		const overridden = buildReadOnlyDraftEstimate({
			provider,
			context,
			mode: 'ask',
			prompt: 'Question',
			history: [],
			notePath: 'Vault/Override-with-a-longer-path.md',
		});
		const captured = buildReadOnlyDraftEstimate({
			provider,
			context,
			mode: 'ask',
			prompt: 'Question',
			history: [],
			notePath: undefined,
		});

		expect(overridden).toEqual(buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getSystemPrompt('ask', undefined),
				userPrompt: buildUserPrompt(
					{ ...context, notePath: 'Vault/Override-with-a-longer-path.md' },
					'Question',
					[],
				),
				history: [],
			},
		}));
		expect(captured).toEqual(buildDraftCapacityEstimate({
			provider,
			request: {
				systemPrompt: getSystemPrompt('ask', undefined),
				userPrompt: buildUserPrompt(context, 'Question', []),
				history: [],
			},
		}));
		expect(overridden.categories).not.toEqual(captured.categories);
	});

	it('shares the equality boundary and blocking state with submission accounting', () => {
		const context = draftContext({ markdown: 'Alpha beta gamma.' });
		const tokens = buildReadOnlyDraftEstimate({
			provider: providerWith(),
			context,
			mode: 'ask',
			prompt: '',
			history: [],
		}).categories.estimatedInputTokens;
		const boundaryProvider = providerWith({
			contextWindowTokens: tokens + 1,
			outputReserveTokens: 1,
		});

		const estimate = buildReadOnlyDraftEstimate({
			provider: boundaryProvider,
			context,
			mode: 'ask',
			prompt: '',
			history: [],
		});

		expect(estimate.categories.estimatedInputTokens).toBe(tokens);
		expect(estimate.capacity).toMatchObject({ effectiveInputTokens: tokens });
		expect(estimate.overCapacity).toBe(true);
		expect(estimate.blocked).toBe(true);
	});
});
