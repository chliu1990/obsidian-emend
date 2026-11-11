import { describe, expect, it } from 'vitest';
import {
	accountRequestCharacters,
	type ContextRequestText,
} from '../src/context-accounting';
import {
	buildDraftCapacityEstimate,
	ContextCapacityDisplay,
	type DraftCapacityEstimate,
} from '../src/context-capacity-ui';
import type { ProviderConfig } from '../src/types';

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

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	className = '';
	textContent = '';
	open = false;
	removed = false;

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
		return this.append('div', options);
	}

	createEl(
		tagName: string,
		options?: { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		return this.append(tagName, options);
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
		const child = new FakeElement(tagName);
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
	it('exposes a polite live status labelled as a draft token estimate', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith(),
		}));

		expect(root.className).toContain('emend-context-capacity');
		expect(root.attributes.role).toBe('status');
		expect(root.attributes['aria-live']).toBe('polite');
		expect(root.attributes['aria-label']).toBe('Draft token estimate');
	});

	it('renders the unconfigured summary and exclusions', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith(),
		}));
		const summary = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-summary'),
		)[0];

		expect(summary?.textContent).toBe(
			'Estimated input: 4 tokens. Capacity checks are off.',
		);
		expect(root.className).toContain('is-unconfigured');
		expect(textOf(root)).toContain(
			'Not included: instructions and skills, additional-note contents, and later Web or correction rounds. The exact submission check remains authoritative.',
		);
		expect(textOf(root)).toContain('System: 1 tokens · Draft: 3 · History: 0 · Tools: 0');
		expect(textOf(root)).toContain('Total: 4 tokens');
		expect(textOf(root)).not.toContain('Context window:');
		expect(textOf(root)).not.toContain('Output reserve:');
		expect(textOf(root)).not.toContain('Effective input capacity:');
	});

	it('renders a valid below-capacity summary with folded capacity details', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 1000, outputReserveTokens: 100 }),
			request: requestWith(),
		}));
		const summary = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-summary'),
		)[0];
		const details = findAll(root, (element) => element.tagName === 'details')[0];

		expect(summary?.textContent).toBe(
			'Estimated input: 4 tokens of 900 effective capacity.',
		);
		expect(root.className).toContain('is-valid');
		expect(root.className).not.toContain('is-over-capacity');
		expect(details?.open).toBe(false);
		expect(textOf(root)).toContain('Estimate details');
		expect(textOf(root)).toContain('Context window: 1000 tokens');
		expect(textOf(root)).toContain('Output reserve: 100 tokens');
		expect(textOf(root)).toContain('Effective input capacity: 900 tokens');
	});

	it('renders the over-capacity summary and state', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 1000, outputReserveTokens: 996 }),
			request: requestWith(),
		}));
		const summary = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-summary'),
		)[0];

		expect(summary?.textContent).toBe(
			'Estimated input: 4 tokens of 4 effective capacity. This draft is over capacity.',
		);
		expect(root.className).toContain('is-over-capacity');
	});

	it('renders the invalid-settings summary and state', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith({ contextWindowTokens: 100, outputReserveTokens: 100 }),
			request: requestWith(),
		}));
		const summary = findAll(root, (element) =>
			element.className.split(' ').includes('emend-context-capacity-summary'),
		)[0];

		expect(summary?.textContent).toBe(
			'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.',
		);
		expect(root.className).toContain('is-invalid');
	});

	it('shows a nonzero continuation token estimate in the details', () => {
		const { root } = renderDisplay(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith({
				continuation: [{ role: 'tool', toolCallId: 'call-1', content: 'result' }],
			}),
		}));

		expect(textOf(root)).toContain(
			'System: 1 tokens · Draft: 3 · History: 0 · Tools: 0 · Continuation: 2',
		);
		expect(textOf(root)).toContain('Total: 6 tokens');
	});

	it('renders the unavailable state when no estimate is supplied', () => {
		const { root } = renderDisplay(undefined);

		expect(root.className).toContain('is-unavailable');
		expect(textOf(root)).toContain('Draft estimate unavailable.');
		expect(textOf(root)).toContain(
			'Not included: instructions and skills, additional-note contents, and later Web or correction rounds. The exact submission check remains authoritative.',
		);
		expect(textOf(root)).not.toContain('Estimate details');
	});

	it('removes its root on destroy and ignores later renders', () => {
		const { container, display, root } = renderDisplay(undefined);

		display.destroy();
		display.render(buildDraftCapacityEstimate({
			provider: providerWith(),
			request: requestWith(),
		}));

		expect(root.removed).toBe(true);
		expect(container.children).toHaveLength(1);
		expect(textOf(root)).toContain('Draft estimate unavailable.');
		expect(textOf(root)).not.toContain('Estimated input:');
	});
});
