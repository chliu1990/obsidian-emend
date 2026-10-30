import { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { EditResult } from '../src/note-writer';
import { operationEditStrategy } from '../src/operation-edit-strategy';
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

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
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
		for (const listener of this.listeners.get('click') ?? []) {
			listener();
		}
	}

	empty() {
		this.children.length = 0;
	}

	focus() {}

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
	) => Promise<EditResult>,
) {
	const contentEl = new FakeElement();
	const modal = new SelectionModal(new App(), submitSelection);
	Object.assign(modal, {
		contentEl,
		setTitle: vi.fn(),
		close: vi.fn(),
	});
	modal.onOpen();
	return {
		modal,
		contentEl,
		input: findElements(contentEl, (element) => element.tagName === 'textarea')[0],
		quickActions: findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-quick-action')
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
};

describe('SelectionModal quick actions', () => {
	it.each(QUICK_ACTIONS)(
		'$id submits its exact prompt once without typed input and settles after failure',
		async (action) => {
			const response = deferred<EditResult>();
			const submitSelection = vi.fn(() => response.promise);
			const { contentEl, input, quickActions } = openModal(submitSelection);
			const button = findAction(contentEl, action.id);
			expect(button).toBeDefined();
			expect(input?.value).toBe('');

			button?.click();

			expect(submitSelection).toHaveBeenCalledTimes(1);
			expect(submitSelection).toHaveBeenCalledWith(
				action.prompt,
				expect.any(AbortSignal),
			);
			expect(quickActions).toHaveLength(QUICK_ACTIONS.length);
			expect(quickActions.every((item) => item.disabled)).toBe(true);
			expect(input?.disabled).toBe(true);
			for (const item of quickActions) {
				item.click();
			}
			expect(submitSelection).toHaveBeenCalledTimes(1);

			response.reject(new Error('Provider unavailable'));
			await vi.waitFor(() => {
				expect(quickActions.every((item) => !item.disabled)).toBe(true);
				expect(input?.disabled).toBe(false);
			});
		},
	);

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
});
