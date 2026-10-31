import { MarkdownView, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmendPlugin from '../src/main';
import { requestAiResponse } from '../src/provider-stream';
import type { StreamResult } from '../src/provider-stream';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { SelectionSnapshot } from '../src/types';

const modalState = vi.hoisted(() => ({
	instances: [] as Array<{
		completion: Promise<unknown> | null;
		signal: AbortSignal | null;
	}>,
}));

vi.mock('../src/selection-modal', () => ({
	SelectionModal: class {
		completion: Promise<unknown> | null = null;
		signal: AbortSignal | null = null;
		private controller: AbortController | null = null;

		constructor(
			_app: unknown,
			private readonly submit: (prompt: string, signal: AbortSignal) => Promise<unknown>,
		) {
			modalState.instances.push(this);
		}

		open() {
			this.controller = new AbortController();
			this.signal = this.controller.signal;
			this.completion = this.submit('Change selection.', this.signal);
			this.completion.catch(() => undefined);
		}

		close() {
			this.controller?.abort();
			this.controller = null;
		}
	},
}));

vi.mock('../src/provider-stream', () => ({ requestAiResponse: vi.fn() }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('selection request plugin unload', () => {
	beforeEach(() => {
		modalState.instances.length = 0;
		vi.mocked(requestAiResponse).mockReset();
	});

	it('aborts a deferred response, prevents replacement, and releases the pending note', async () => {
		const delayedResponse = deferred<StreamResult>();
		vi.mocked(requestAiResponse)
			.mockReturnValueOnce(delayedResponse.promise)
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'content', text: '[]' });
				return { content: '[]', reasoning: '' };
			});
		const file = new TFile();
		file.path = 'Selection.md';
		let currentText = 'Alpha beta gamma.';
		const replaceRange = vi.fn();
		const editor = {
			getSelection: () => 'beta',
			getValue: () => currentText,
			getCursor: (which: 'from' | 'to') => ({ offset: which === 'from' ? 6 : 10 }),
			posToOffset: (position: { offset: number }) => position.offset,
			offsetToPos: (offset: number) => ({ offset }),
			replaceRange,
		};
		const view = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file, editor },
		);
		const commands: Array<{ id: string; editorCheckCallback?: unknown }> = [];
		const unloadCallbacks: Array<() => void> = [];
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: {
					adapter: {},
					configDir: '.test-config',
					getAbstractFileByPath: () => null,
					getName: () => 'test-vault',
				},
				workspace: {
					on: () => ({}),
					getLeavesOfType: () => [],
					getActiveViewOfType: () => view,
					iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
						callback({ view });
					},
				},
			},
			settings: structuredClone(DEFAULT_SETTINGS),
			loadSettings: vi.fn().mockResolvedValue(undefined),
			register: vi.fn((callback: () => void) => unloadCallbacks.push(callback)),
			registerView: vi.fn(),
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn((command: { id: string; editorCheckCallback?: unknown }) => {
				commands.push(command);
			}),
			addSettingTab: vi.fn(),
		});
		await plugin.onload();
		const command = commands.find((candidate) =>
			candidate.id === 'emend:modify-selected-text'
		);
		const execute = command?.editorCheckCallback as (
			checking: boolean,
			commandEditor: typeof editor,
			commandView: MarkdownView,
		) => boolean;

		expect(execute(false, editor, view)).toBe(true);
		await vi.waitFor(() => expect(requestAiResponse).toHaveBeenCalledOnce());
		const modal = modalState.instances[0];
		expect(modal?.signal?.aborted).toBe(false);
		expect(unloadCallbacks).toHaveLength(1);

		for (const callback of unloadCallbacks) {
			callback();
		}
		expect(modal?.signal?.aborted).toBe(true);
		delayedResponse.resolve({
			content: JSON.stringify([
				{ type: 'replace', target: 'beta', replacement: 'changed' },
			]),
			reasoning: '',
		});
		await expect(modal?.completion).rejects.toMatchObject({ name: 'AbortError' });
		expect(replaceRange).not.toHaveBeenCalled();
		expect(currentText).toBe('Alpha beta gamma.');

		const snapshot: SelectionSnapshot = {
			file,
			fullText: currentText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		await expect(plugin.requestSelectionEdit(
			snapshot,
			'Retry after unload.',
			new AbortController().signal,
			{
				readCurrentText: () => currentText,
				isTargetCurrent: () => true,
				replaceRange,
			},
		)).resolves.toEqual({ applied: false, changeCount: 0 });
		expect(requestAiResponse).toHaveBeenCalledTimes(2);
		expect(replaceRange).not.toHaveBeenCalled();
	});
});
