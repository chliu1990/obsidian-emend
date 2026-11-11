import { readFileSync } from 'node:fs';
import { App, Notice, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import {
	buildDraftCapacityEstimate,
	CAPACITY_EXCLUSION_NOTE,
	formatDraftCapacityBlockMessage,
	formatDraftCapacitySummary,
	type DraftCapacityEstimate,
} from '../src/context-capacity-ui';
import type { EditResult } from '../src/note-writer';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { QUICK_ACTIONS } from '../src/quick-actions';
import {
	SelectionEditRequestCoordinator,
	type SelectionEditorAdapter,
} from '../src/selection-editor';
import { SelectionModal } from '../src/selection-modal';
import type { ProviderConfig, SelectionSnapshot } from '../src/types';

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<() => void>>();
	className = '';
	textContent = '';
	disabled = false;
	value = '';
	removed = false;
	focusCalls = 0;

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }) {
		return this.append('span', options);
	}

	createEl(
		tagName: string,
		options?: {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		return this.append(tagName, options);
	}

	addClass(className: string) {
		this.className = className;
	}

	addEventListener(event: string, listener: () => void) {
		const listeners = this.listeners.get(event) ?? [];
		listeners.push(listener);
		this.listeners.set(event, listeners);
	}

	click() {
		if (this.disabled) {
			return;
		}
		this.dispatch('click');
	}

	dispatch(type: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}

	empty() {
		this.children.length = 0;
	}

	focus() {
		this.focusCalls += 1;
	}

	remove() {
		this.removed = true;
	}

	private append(
		tagName: string,
		options?: string | {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function openModal(
	submitSelection: (
		prompt: string,
		signal: AbortSignal,
		additionalNotePaths: readonly string[],
	) => Promise<EditResult>,
	store = new AdditionalNotesStore(),
	targetPath = 'note.md',
	estimateDraft: (prompt: string) => DraftCapacityEstimate = defaultEstimateDraft,
) {
	const contentEl = new FakeElement();
	const targetFile = new TFile();
	targetFile.path = targetPath;
	const app = new App();
	Object.assign(app, {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) =>
				path === targetPath ? targetFile : null
			),
		},
	});
	const modal = new SelectionModal(
		app,
		submitSelection,
		store,
		targetPath,
		estimateDraft,
	);
	Object.assign(modal, {
		contentEl,
		setTitle: vi.fn(),
		close: vi.fn(),
	});
	modal.onOpen();
	return {
		modal,
		store,
		targetFile,
		contentEl,
		input: findElements(contentEl, (element) => element.tagName === 'textarea')[0],
		quickActions: findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-quick-action')
		),
		additionalButtons: findElements(contentEl, (element) =>
			element.className.split(' ').some((name) =>
				name.startsWith('emend-additional-notes-')
			) && element.tagName === 'button'
		),
	};
}

function findElements(
	root: FakeElement,
	predicate: (element: FakeElement) => boolean,
): FakeElement[] {
	return [
		...(predicate(root) ? [root] : []),
		...root.children.flatMap((child) => findElements(child, predicate)),
	];
}

function findAction(contentEl: FakeElement, actionId: string) {
	return findElements(
		contentEl,
		(element) => element.attributes['data-action-id'] === actionId,
	)[0];
}

const provider: ProviderConfig = {
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
};

function providerWith(
	fields: Partial<
		Pick<
			ProviderConfig,
			'contextWindowTokens' | 'outputReserveTokens' | 'contextCapacityInvalid'
		>
	>,
): ProviderConfig {
	return { ...provider, ...fields };
}

function estimateForPrompt(
	prompt: string,
	candidate: ProviderConfig = provider,
): DraftCapacityEstimate {
	return buildDraftCapacityEstimate({
		provider: candidate,
		request: { systemPrompt: 'sys', userPrompt: prompt, history: [] },
	});
}

function defaultEstimateDraft(prompt: string): DraftCapacityEstimate {
	return estimateForPrompt(prompt);
}

function findCapacityRoot(contentEl: FakeElement) {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-context-capacity'),
	)[0];
}

function findCapacitySummary(contentEl: FakeElement) {
	return findElements(
		contentEl,
		(element) =>
			element.className.split(' ').includes('emend-context-capacity-summary'),
	)[0];
}

function findButtonByClass(contentEl: FakeElement, className: string) {
	return findElements(
		contentEl,
		(element) =>
			element.tagName === 'button' &&
			element.className.split(' ').includes(className),
	)[0];
}

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join('\n');
}

describe('SelectionModal quick actions', () => {
	it.each(QUICK_ACTIONS)(
		'$id submits its exact prompt once without typed input and settles after failure',
		async (action) => {
			const response = deferred<EditResult>();
			const submitSelection = vi.fn(() => response.promise);
			const store = new AdditionalNotesStore();
			store.add('note.md', 'Context.md');
			const { contentEl, input, quickActions, additionalButtons } = openModal(
				submitSelection,
				store,
			);
			const button = findAction(contentEl, action.id);
			expect(button).toBeDefined();
			expect(input?.value).toBe('');

			button?.click();

			expect(submitSelection).toHaveBeenCalledTimes(1);
			expect(submitSelection).toHaveBeenCalledWith(
				action.prompt,
				expect.any(AbortSignal),
				['Context.md'],
			);
			expect(quickActions).toHaveLength(QUICK_ACTIONS.length);
			expect(quickActions.every((item) => item.disabled)).toBe(true);
			expect(additionalButtons.length).toBeGreaterThanOrEqual(3);
			expect(additionalButtons.every((item) => item.disabled)).toBe(true);
			expect(input?.disabled).toBe(true);
			for (const item of quickActions) {
				item.click();
			}
			expect(submitSelection).toHaveBeenCalledTimes(1);

			response.reject(new Error('Provider unavailable'));
			await vi.waitFor(() => {
				expect(quickActions.every((item) => !item.disabled)).toBe(true);
				expect(additionalButtons.every((item) => !item.disabled)).toBe(true);
				expect(input?.disabled).toBe(false);
			});
		},
	);

	it('captures the target note paths exactly once for a typed submission', async () => {
		const response = deferred<EditResult>();
		const submitSelection = vi.fn(
			(
				_prompt: string,
				_signal: AbortSignal,
				_additionalNotePaths: readonly string[],
			) => response.promise,
		);
		const store = new AdditionalNotesStore();
		store.add('note.md', 'First.md');
		store.add('note.md', 'Second.md');
		store.add('other.md', 'Wrong target.md');
		const { contentEl, input } = openModal(submitSelection, store, 'note.md');
		if (!input) {
			throw new Error('Selection input missing.');
		}
		input.value = '  Clarify this selection.  ';
		const submitButton = findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-primary-button')
		)[0];

		submitButton?.click();

		expect(submitSelection).toHaveBeenCalledTimes(1);
		expect(submitSelection).toHaveBeenCalledWith(
			'Clarify this selection.',
			expect.any(AbortSignal),
			['First.md', 'Second.md'],
		);
		store.clear('note.md');
		expect(submitSelection.mock.calls[0]?.[2]).toEqual(['First.md', 'Second.md']);
		response.resolve({ applied: false, changeCount: 0, summaryItems: [] });
		await vi.waitFor(() => expect(input.disabled).toBe(false));
	});

	it.each([
		{
			label: 'applied',
			result: {
				applied: true,
				changeCount: 1,
				summaryItems: [],
				summary: 'MODEL SUMMARY MUST NOT APPEAR.',
			},
			expected: 'Selection updated — 1 changes tracked. Review in Track Changes.',
		},
		{
			label: 'no-op',
			result: {
				applied: false,
				changeCount: 0,
				summaryItems: [],
				summary: 'MODEL SUMMARY MUST NOT APPEAR.',
			},
			expected: 'No changes were needed.',
		},
	])('keeps the $label Notice free of the model summary', async ({ result, expected }) => {
		const response = deferred<EditResult>();
		const submitSelection = vi.fn(() => response.promise);
		const { contentEl, input } = openModal(submitSelection);
		if (!input) {
			throw new Error('Selection input missing.');
		}
		input.value = 'Clarify this selection.';
		const noticeMessages = (Notice as unknown as { readonly messages: string[] }).messages;
		const noticeCount = noticeMessages.length;
		findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-primary-button')
		)[0]?.click();

		response.resolve(result);

		await vi.waitFor(() => expect(noticeMessages.length).toBe(noticeCount + 1));
		expect(noticeMessages.slice(noticeCount)).toEqual([expected]);
	});

	it('submits the renamed target paths for typed input', async () => {
		const submitSelection = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		}));
		const store = new AdditionalNotesStore();
		store.add('note.md', 'Context.md');
		const { contentEl, input, targetFile } = openModal(submitSelection, store);
		if (!input) {
			throw new Error('Selection input missing.');
		}
		input.value = 'Clarify this selection.';
		targetFile.path = 'renamed.md';
		store.rename('note.md', targetFile.path);

		findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-primary-button')
		)[0]?.click();

		await vi.waitFor(() => expect(submitSelection).toHaveBeenCalledWith(
			'Clarify this selection.',
			expect.any(AbortSignal),
			['Context.md'],
		));
	});

	it.each(QUICK_ACTIONS)(
		'$id submits the renamed target paths after the modal opens',
		async (action) => {
			const submitSelection = vi.fn(async () => ({
				applied: false,
				changeCount: 0,
				summaryItems: [],
			}));
			const store = new AdditionalNotesStore();
			store.add('note.md', 'Context.md');
			const { contentEl, targetFile } = openModal(submitSelection, store);
			targetFile.path = 'renamed.md';
			store.rename('note.md', targetFile.path);

			findAction(contentEl, action.id)?.click();

			await vi.waitFor(() => expect(submitSelection).toHaveBeenCalledWith(
				action.prompt,
				expect.any(AbortSignal),
				['Context.md'],
			));
		},
	);

	it('restores Cancel after a stopped quick-action request settles', async () => {
		const response = deferred<EditResult>();
		const submitSelection = vi.fn((_prompt: string, _signal: AbortSignal) => response.promise);
		const { contentEl, input, quickActions } = openModal(submitSelection);
		const cancelButton = findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-secondary-button')
		)[0];
		expect(cancelButton).toBeDefined();

		findAction(contentEl, QUICK_ACTIONS[0].id)?.click();
		cancelButton?.click();

		expect(submitSelection.mock.calls[0]?.[1].aborted).toBe(true);
		expect(cancelButton?.disabled).toBe(true);
		expect(cancelButton?.textContent).toBe('Stopping...');

		response.resolve({ applied: false, changeCount: 0, summaryItems: [] });

		await vi.waitFor(() => {
			expect(cancelButton?.disabled).toBe(false);
			expect(quickActions.every((item) => !item.disabled)).toBe(true);
			expect(input?.disabled).toBe(false);
		});
		expect(cancelButton?.textContent).toBe('Cancel');
	});

	it.each(['provider', 'validation'] as const)(
		'does not replace the selection after a quick-action %s failure',
		async (failure) => {
			const file = new TFile();
			file.path = 'note.md';
			const fullText = 'Alpha beta gamma';
			const snapshot: SelectionSnapshot = {
				file,
				fullText,
				selectedText: 'beta',
				from: 6,
				to: 10,
			};
			const editor: SelectionEditorAdapter = {
				readCurrentText: vi.fn(() => fullText),
				isTargetCurrent: vi.fn(() => true),
				replaceRange: vi.fn(),
			};
			const request = failure === 'provider'
				? vi.fn(async () => {
					throw new Error('Provider unavailable');
				})
				: vi.fn(async () => ({ content: 'not json', reasoning: '' }));
			const coordinator = new SelectionEditRequestCoordinator({
				provider,
				loadAdditionalNotes: async () => [],
				loadInstructions: async () => ({ skillTexts: new Map() }),
				request,
				editor,
				editStrategy: operationEditStrategy,
			});
			const submitSelection = vi.fn((prompt: string, signal: AbortSignal) =>
				coordinator.submit({
					snapshot,
					prompt,
					maxContextCharacters: 1000,
					smartSelectionContext: true,
					additionalNotePaths: [],
					history: [],
					signal,
				})
			);
			const { contentEl, quickActions } = openModal(submitSelection);
			const button = findAction(contentEl, QUICK_ACTIONS[0].id);
			expect(button).toBeDefined();

			button?.click();

			await vi.waitFor(() => {
				expect(submitSelection).toHaveBeenCalledTimes(1);
				expect(quickActions.every((item) => !item.disabled)).toBe(true);
			});
			expect(editor.readCurrentText).not.toHaveBeenCalled();
			expect(editor.replaceRange).not.toHaveBeenCalled();
		},
	);

	it('keeps controls pending through the correction round and restores them after final validation fails', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const fullText = 'Alpha beta gamma';
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const editor: SelectionEditorAdapter = {
			readCurrentText: vi.fn(() => fullText),
			isTargetCurrent: vi.fn(() => true),
			replaceRange: vi.fn(),
		};
		const secondRound = deferred<{ content: string; reasoning: string }>();
		const request = vi.fn(
			async (
				_request: AiProviderRequest,
				_callbacks: { onEvent(event: StreamEvent): void },
			): Promise<StreamResult> => secondRound.promise,
		);
		request.mockImplementationOnce(async () => ({
			content: 'not json',
			reasoning: '',
		}));
		const coordinator = new SelectionEditRequestCoordinator({
			provider,
			loadAdditionalNotes: async () => [],
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request,
			editor,
			editStrategy: operationEditStrategy,
		});
		const submitSelection = vi.fn((prompt: string, signal: AbortSignal) =>
			coordinator.submit({
				snapshot,
				prompt,
				maxContextCharacters: 1000,
				smartSelectionContext: true,
				additionalNotePaths: [],
				history: [],
				signal,
			})
		);
		const { contentEl, input, quickActions, additionalButtons } = openModal(
			submitSelection,
		);

		findAction(contentEl, QUICK_ACTIONS[0].id)?.click();
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
		expect(input?.disabled).toBe(true);
		expect(quickActions.every((item) => item.disabled)).toBe(true);
		expect(additionalButtons.every((item) => item.disabled)).toBe(true);

		secondRound.resolve({ content: 'still not json', reasoning: '' });
		await vi.waitFor(() => {
			expect(input?.disabled).toBe(false);
			expect(quickActions.every((item) => !item.disabled)).toBe(true);
			expect(additionalButtons.every((item) => !item.disabled)).toBe(true);
		});
		expect(submitSelection).toHaveBeenCalledOnce();
		expect(request.mock.calls.map((call) => call[0].history)).toEqual([[], []]);
		expect(editor.readCurrentText).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});
});

describe('SelectionModal draft capacity estimate', () => {
	it('shows the shared estimate below the input and refreshes on input without re-rendering', () => {
		const estimateDraft = vi.fn(defaultEstimateDraft);
		const { contentEl, input } = openModal(
			vi.fn(async () => ({ applied: false, changeCount: 0, summaryItems: [] })),
			new AdditionalNotesStore(),
			'note.md',
			estimateDraft,
		);
		if (!input) {
			throw new Error('Selection input missing.');
		}
		const root = findCapacityRoot(contentEl);
		const summary = findCapacitySummary(contentEl);
		expect(estimateDraft).toHaveBeenCalledWith('');
		expect(summary?.textContent).toBe(
			formatDraftCapacitySummary(defaultEstimateDraft('')),
		);
		expect(root?.attributes.role).toBe('status');
		expect(textOf(contentEl)).toContain(CAPACITY_EXCLUSION_NOTE);

		const childCount = contentEl.children.length;
		const focusCalls = input.focusCalls;
		input.value = 'A longer typed draft';
		input.dispatch('input');

		expect(estimateDraft).toHaveBeenCalledWith('A longer typed draft');
		expect(findCapacitySummary(contentEl)?.textContent).toBe(
			formatDraftCapacitySummary(defaultEstimateDraft('A longer typed draft')),
		);
		expect(contentEl.children.length).toBe(childCount);
		expect(input.focusCalls).toBe(focusCalls);
		expect(findCapacityRoot(contentEl)).toBe(root);
	});

	it('places the meter between the instruction textarea and the actions row', () => {
		const { contentEl, input } = openModal(vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		})));
		const textareaIndex = contentEl.children.indexOf(input as FakeElement);
		const meterIndex = contentEl.children.indexOf(
			findCapacityRoot(contentEl) as FakeElement,
		);
		const actionsIndex = contentEl.children.findIndex((element) =>
			element.className.split(' ').includes('emend-chat-composer-actions'),
		);

		expect(textareaIndex).toBeGreaterThanOrEqual(0);
		expect(meterIndex).toBeGreaterThan(textareaIndex);
		expect(actionsIndex).toBeGreaterThan(meterIndex);
		expect(contentEl.className.split(' ')).toContain('emend-selection-modal');
	});

	it('uses the shared narrow-layout capacity styles in the modal', () => {
		const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
		const { contentEl } = openModal(vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		})));

		expect(contentEl.className.split(' ')).toContain('emend-selection-modal');
		expect(findCapacityRoot(contentEl)?.className.split(' ')).toContain(
			'emend-context-capacity',
		);
		expect(css).toMatch(
			/@media \(max-width: 400px\) \{[\s\S]*?\.emend-context-capacity-detail \{[\s\S]*?padding-left: 0;/,
		);
	});

	it('shows the invalid text and disables modify and every action while keeping Cancel usable', () => {
		const invalidProvider = providerWith({
			contextWindowTokens: 100,
			outputReserveTokens: 100,
		});
		const { contentEl, quickActions, input } = openModal(
			vi.fn(async () => ({ applied: false, changeCount: 0, summaryItems: [] })),
			new AdditionalNotesStore(),
			'note.md',
			(prompt) => estimateForPrompt(prompt, invalidProvider),
		);
		const submitButton = findButtonByClass(contentEl, 'emend-chat-primary-button');
		const cancelButton = findButtonByClass(contentEl, 'emend-chat-secondary-button');

		expect(findCapacitySummary(contentEl)?.textContent).toBe(
			formatDraftCapacitySummary(estimateForPrompt('', invalidProvider)),
		);
		expect(findCapacityRoot(contentEl)?.className).toContain('is-invalid');
		expect(submitButton?.disabled).toBe(true);
		expect(quickActions.every((button) => button.disabled)).toBe(true);
		expect(cancelButton?.disabled).toBe(false);
		expect(input?.disabled).toBe(false);
	});

	it('disables only quick actions whose own prompt is blocked', async () => {
		const fixTokens = estimateForPrompt(QUICK_ACTIONS[0].prompt).categories
			.estimatedInputTokens;
		const conciseTokens = estimateForPrompt(QUICK_ACTIONS[1].prompt).categories
			.estimatedInputTokens;
		const examplesTokens = estimateForPrompt(QUICK_ACTIONS[2].prompt).categories
			.estimatedInputTokens;
		expect(conciseTokens).toBeLessThan(fixTokens);
		expect(examplesTokens).toBeGreaterThan(fixTokens);
		const boundaryProvider = providerWith({
			contextWindowTokens: fixTokens + 1,
			outputReserveTokens: 1,
		});
		const estimateDraft = vi.fn(
			(prompt: string) => estimateForPrompt(prompt, boundaryProvider),
		);
		const submitSelection = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		}));
		const { contentEl } = openModal(
			submitSelection,
			new AdditionalNotesStore(),
			'note.md',
			estimateDraft,
		);

		expect(estimateDraft).toHaveBeenCalledWith(QUICK_ACTIONS[0].prompt);
		expect(estimateDraft).toHaveBeenCalledWith(QUICK_ACTIONS[1].prompt);
		expect(estimateDraft).toHaveBeenCalledWith(QUICK_ACTIONS[2].prompt);
		expect(findAction(contentEl, 'fix-grammar')?.disabled).toBe(true);
		expect(findAction(contentEl, 'add-examples')?.disabled).toBe(true);
		expect(findAction(contentEl, 'make-concise')?.disabled).toBe(false);
		expect(findButtonByClass(contentEl, 'emend-chat-primary-button')?.disabled).toBe(
			false,
		);

		findAction(contentEl, 'fix-grammar')?.click();
		expect(submitSelection).not.toHaveBeenCalled();

		findAction(contentEl, 'make-concise')?.click();
		await vi.waitFor(() =>
			expect(submitSelection).toHaveBeenCalledWith(
				QUICK_ACTIONS[1].prompt,
				expect.any(AbortSignal),
				[],
			)
		);
	});

	it('blocks a stale-enabled submit with a fresh estimate and no request', () => {
		const candidate = providerWith({
			contextWindowTokens: 1000,
			outputReserveTokens: 100,
		});
		const submitSelection = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		}));
		const { modal, contentEl, input } = openModal(
			submitSelection,
			new AdditionalNotesStore(),
			'note.md',
			(prompt) => estimateForPrompt(prompt, candidate),
		);
		if (!input) {
			throw new Error('Selection input missing.');
		}
		const draft = 'x'.repeat(400);
		input.value = draft;
		input.dispatch('input');
		const submitButton = findButtonByClass(contentEl, 'emend-chat-primary-button');
		expect(submitButton?.disabled).toBe(false);

		candidate.contextWindowTokens = 100;
		candidate.outputReserveTokens = 96;
		const blocked = estimateForPrompt(draft, candidate);
		const noticeMessages = (Notice as unknown as { readonly messages: string[] })
			.messages;
		const noticeCount = noticeMessages.length;

		submitButton?.click();

		expect(blocked.blocked).toBe(true);
		expect(noticeMessages.length).toBe(noticeCount + 1);
		expect(noticeMessages[noticeMessages.length - 1]).toBe(
			`Emend: ${formatDraftCapacityBlockMessage(blocked)}`,
		);
		expect(submitSelection).not.toHaveBeenCalled();
		expect(input.value).toBe(draft);
		expect(
			(modal as unknown as { close: ReturnType<typeof vi.fn> }).close,
		).not.toHaveBeenCalled();
	});

	it('keeps a passing submit history-free and free of additional-note contents', async () => {
		const estimateDraft = vi.fn(defaultEstimateDraft);
		const store = new AdditionalNotesStore();
		store.add('note.md', 'Context.md');
		const submitSelection = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		}));
		const { contentEl, input } = openModal(
			submitSelection,
			store,
			'note.md',
			estimateDraft,
		);
		if (!input) {
			throw new Error('Selection input missing.');
		}
		input.value = 'Clarify this selection.';
		input.dispatch('input');

		findButtonByClass(contentEl, 'emend-chat-primary-button')?.click();

		await vi.waitFor(() =>
			expect(submitSelection).toHaveBeenCalledWith(
				'Clarify this selection.',
				expect.any(AbortSignal),
				['Context.md'],
			)
		);
		expect(estimateDraft).toHaveBeenCalledWith('Clarify this selection.');
		expect(submitSelection.mock.calls[0]).toHaveLength(3);
		expect(textOf(contentEl)).toContain(CAPACITY_EXCLUSION_NOTE);
	});

	it('destroys the meter on close', () => {
		const { modal, contentEl } = openModal(vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
		})));
		const root = findCapacityRoot(contentEl);
		if (!root) {
			throw new Error('Capacity root missing.');
		}

		modal.onClose();

		expect(root.removed).toBe(true);
	});
});
