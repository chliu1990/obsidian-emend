import { readFileSync } from 'node:fs';
import { MarkdownRenderer, Notice, Scope, TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import type { ShortcutEvent } from '../src/chat-shortcuts';
import { EmendChatView, formatChatMessageForCopy, getUnreadPageCount } from '../src/chat-view';
import type { EditSummaryItem } from '../src/edit-strategy';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import {
	EditRequestCoordinator,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type {
	SelectionEditCallbacks,
	SelectionEditResult,
	SelectionEditorAdapter,
} from '../src/selection-editor';
import type {
	ChatMessage,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';
import type { WebActivityRecord } from '../src/web-search';

function getCssRule(selector: string): string {
	const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('EmendChatView mode button hover styles', () => {
	it('keeps text readable on distinct non-active and active hover backgrounds', () => {
		const nonActive = getCssRule('.emend-chat-mode-button:hover');
		const active = getCssRule('.emend-chat-mode-button.is-active:hover');

		expect(nonActive).toContain('background: var(--background-modifier-hover);');
		expect(nonActive).toContain('color: var(--text-normal);');
		expect(active).toContain('background: var(--interactive-accent-hover);');
		expect(active).toContain('color: var(--text-normal);');
	});
});

describe('EmendChatView header styles', () => {
	it('stacks shortcut groups below the wrapping title row', () => {
		expect(getCssRule('.emend-chat-title-row')).toContain('flex-wrap: wrap;');
		expect(getCssRule('.emend-chat-shortcuts')).toContain('flex-direction: column;');
	});

	it('wraps shortcut items within each group', () => {
		const group = getCssRule('.emend-chat-shortcut-group');
		expect(group).toContain('display: flex;');
		expect(group).toContain('flex-wrap: wrap;');
	});

	it('keeps each key badge paired with its action', () => {
		const shortcut = getCssRule('.emend-chat-shortcut');
		expect(shortcut).toContain('display: inline-flex;');
		expect(shortcut).toContain('align-items: center;');
	});

	it('distinguishes key badges from action text', () => {
		const badge = getCssRule('.emend-chat-shortcut kbd');
		expect(badge).toContain('border: 1px solid var(--background-modifier-border);');
		expect(badge).toContain('background: var(--background-secondary);');
		expect(badge).toContain('color: var(--text-normal);');
	});

	it('uses muted text for the build identity and shortcuts', () => {
		expect(getCssRule('.emend-chat-build')).toContain('color: var(--text-muted);');
		expect(getCssRule('.emend-chat-shortcuts')).toContain('color: var(--text-muted);');
	});

	it('retains context ellipsis', () => {
		expect(getCssRule('.emend-chat-context')).toContain('text-overflow: ellipsis;');
	});
});

const viewPrototype = EmendChatView.prototype as unknown as {
	refreshTargetNote(this: unknown): Promise<void>;
	submitPrompt(this: unknown): Promise<void>;
	handleComposerKeydown(
		this: unknown,
		event: ShortcutEvent & { preventDefault(): void },
	): void;
	setMode(this: unknown, mode: Mode): void;
	registerComposerScope(this: unknown): void;
	render(this: unknown): void;
	renderMessage(this: unknown, containerEl: HTMLElement, message: ChatMessage): void;
	renderMessageBody(this: unknown, message: ChatMessage): void;
	scrollMessagesToBottom(this: unknown): void;
	scrollMessagesToBottomIfFollowing(this: unknown): void;
	restoreMessageScroll(this: unknown, previousScrollTop: number, wasFollowing: boolean): void;
	settleMarkdownRender(this: unknown, generation: number): void;
	scheduleMessageRender(this: unknown, message: ChatMessage): void;
	getDisplayText(this: unknown): string;
	onClose(this: unknown): Promise<void>;
	toProviderHistory(this: unknown): ProviderHistoryMessage[];
};

function message(id: string, sourcePath: string): ChatMessage {
	return {
		id,
		role: 'assistant',
		content: id,
		reasoning: '',
		mode: 'ask',
		sourcePath,
		status: 'ready',
		timestamp: 1,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createEditTargetView(options: {
	activePath?: string;
	selectedText?: string;
} = {}) {
	let activePath = options.activePath ?? 'A.md';
	let selectedText = options.selectedText ?? '';
	const contentEl = new FakeElement();
	const additionalNotesStore = new AdditionalNotesStore();
	const read = vi.fn();
	const requestChatCompletion = vi.fn();
	const captureChatContext = vi.fn();
	const context = {
		app: { vault: { adapter: { read } } },
		contentEl,
		plugin: {
			getActiveNotePath: () => activePath,
			getActiveNoteLabel: () => activePath,
			hasUsableSelection: () => Boolean(selectedText.trim()),
			captureChatContext,
			conversationStore: { load: vi.fn(async () => []) },
			additionalNotesStore,
			requestChatCompletion,
			settings: {
				activeProvider: 'custom',
				providers: { custom: { name: 'Local', model: 'Test model' } },
			},
		},
		notePath: null as string | null,
		noteLoadGeneration: 0,
		messages: [] as ChatMessage[],
		selectedMode: 'ask' as Mode,
		webSearchMode: 'off' as const,
		isThreadLoading: false,
		isSending: false,
		activeController: null,
		closed: false,
		inputEl: null as FakeElement | null,
		drafts: new Map<string, string>(),
		additionalNotesControl: null,
		pendingMessages: new Set<ChatMessage>(),
		messageBodyEls: new Map<string, HTMLElement>(),
		activeModelEl: null,
		editTargetChoice: 'auto' as 'auto' | 'full-note' | 'selection',
		displayedEditTarget: 'full-note' as 'full-note' | 'selection',
		editTargetSelectEl: null as FakeElement | null,
		webReviewModal: null,
		pendingRenderFrame: null,
		pendingMarkdownRenders: 0,
		pendingScrollRestore: null,
		responseStartMessageId: null,
		followLatestMessages: true,
		renderGeneration: 0,
		cancelPendingRender: vi.fn(),
	};
	Object.setPrototypeOf(context, EmendChatView.prototype);
	const render = vi.fn(() => viewPrototype.render.call(context));
	Object.assign(context, { render });
	return {
		context,
		contentEl,
		render,
		read,
		requestChatCompletion,
		captureChatContext,
		setActivePath: (path: string) => {
			activePath = path;
		},
		setSelectedText: (text: string) => {
			selectedText = text;
		},
	};
}

function findEditTargetSelect(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) =>
			element.tagName === 'select' && element.attributes['aria-label'] === 'Edit target',
	)[0];
}

describe('EmendChatView edit target control', () => {
	it('initially displays Selection when automatic targeting has usable text', async () => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });

		await viewPrototype.refreshTargetNote.call(context);

		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.editTargetChoice).toBe('auto');
		expect(context.displayedEditTarget).toBe('selection');
	});

	it.each(['', ' \n\t'])(
		'initially displays Full note for an empty or whitespace selection: %j',
		async (selectedText) => {
			const { context, contentEl } = createEditTargetView({ selectedText });

			await viewPrototype.refreshTargetNote.call(context);

			expect(findEditTargetSelect(contentEl)?.value).toBe('full-note');
			expect(context.displayedEditTarget).toBe('full-note');
		},
	);

	it('exposes the two explicit targets and the quick-action tooltip', async () => {
		const { context, contentEl } = createEditTargetView();

		await viewPrototype.refreshTargetNote.call(context);

		const select = findEditTargetSelect(contentEl);
		expect(select?.title).toBe('Applies to Edit and quick actions.');
		expect(select?.children.map((option) => [option.value, option.textContent])).toEqual([
			['full-note', 'Full note'],
			['selection', 'Selection'],
		]);
	});

	it.each([
		{ choice: 'full-note', selectedText: 'usable selection' },
		{ choice: 'selection', selectedText: '' },
	] as const)(
		'preserves explicit $choice targeting across renders and Ask/Edit switches',
		async ({ choice, selectedText }) => {
			const { context, contentEl } = createEditTargetView({ selectedText });
			await viewPrototype.refreshTargetNote.call(context);
			const select = findEditTargetSelect(contentEl);
			if (context.inputEl) {
				context.inputEl.value = 'Keep this draft';
				context.drafts.set('A.md', context.inputEl.value);
			}

			if (select) {
				select.value = choice;
				select.dispatch('change');
			}
			viewPrototype.render.call(context);
			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			viewPrototype.setMode.call(context, 'edit');
			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			viewPrototype.setMode.call(context, 'ask');

			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			expect(context.editTargetChoice).toBe(choice);
			expect(context.displayedEditTarget).toBe(choice);
			expect(context.inputEl?.value).toBe('Keep this draft');
		},
	);

	it('resets to auto only for real note changes while preserving per-note drafts', async () => {
		const { context, contentEl, setActivePath, setSelectedText } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);
		if (context.inputEl) {
			context.inputEl.value = 'A draft';
		}
		setSelectedText('A selection');
		await viewPrototype.refreshTargetNote.call(context);
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		const select = findEditTargetSelect(contentEl);
		if (select) {
			select.value = 'full-note';
			select.dispatch('change');
		}

		setActivePath('B.md');
		setSelectedText('B selection');
		await viewPrototype.refreshTargetNote.call(context);

		expect(context.editTargetChoice).toBe('auto');
		expect(context.displayedEditTarget).toBe('selection');
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.inputEl?.value).toBe('');
		if (context.inputEl) {
			context.inputEl.value = 'B draft';
		}
		const bSelect = findEditTargetSelect(contentEl);
		if (bSelect) {
			bSelect.value = 'full-note';
			bSelect.dispatch('change');
		}

		setActivePath('A.md');
		setSelectedText('');
		await viewPrototype.refreshTargetNote.call(context);

		expect(context.editTargetChoice).toBe('auto');
		expect(findEditTargetSelect(contentEl)?.value).toBe('full-note');
		expect(context.inputEl?.value).toBe('A draft');
		setActivePath('B.md');
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('B draft');
	});

	it('refreshes a same-note selection without recreating the textarea or reloading chat', async () => {
		const { context, contentEl, render, setSelectedText } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);
		const composer = context.inputEl;
		if (composer) {
			composer.value = 'Unsubmitted draft';
		}
		render.mockClear();
		setSelectedText('new selection');

		await viewPrototype.refreshTargetNote.call(context);

		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.displayedEditTarget).toBe('selection');
		expect(context.inputEl).toBe(composer);
		expect(context.inputEl?.value).toBe('Unsubmitted draft');
		expect(render).not.toHaveBeenCalled();
		expect(context.plugin.conversationStore.load).toHaveBeenCalledOnce();
	});

	it('keeps the control and quick actions available outside Edit before submission', async () => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });

		await viewPrototype.refreshTargetNote.call(context);

		expect(context.selectedMode).toBe('ask');
		expect(findEditTargetSelect(contentEl)?.disabled).toBe(false);
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		const quickActions = findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions).toHaveLength(3);
		expect(quickActions.every((button) => !button.disabled)).toBe(true);
	});

	it.each([
		{ isSending: true, isThreadLoading: false },
		{ isSending: false, isThreadLoading: true },
	])('disables the control while pending or loading: %o', async (state) => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		context.isSending = state.isSending;
		context.isThreadLoading = state.isThreadLoading;

		viewPrototype.render.call(context);

		expect(findEditTargetSelect(contentEl)?.disabled).toBe(true);
	});

	it('changes target state without requests, content reads, or composer recreation', async () => {
		const {
			context,
			contentEl,
			read,
			requestChatCompletion,
			captureChatContext,
			setSelectedText,
		} = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		const composer = context.inputEl;
		const select = findEditTargetSelect(contentEl);
		if (select) {
			select.value = 'full-note';
			select.dispatch('change');
		}
		expect(context.inputEl).toBe(composer);
		setSelectedText('');
		await viewPrototype.refreshTargetNote.call(context);
		viewPrototype.setMode.call(context, 'edit');

		expect(context.editTargetChoice).toBe('full-note');
		expect(context.displayedEditTarget).toBe('full-note');
		expect(context.inputEl?.value).toBe('');
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(captureChatContext).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
	});

	it('synchronizes Edit controls after quick-action Selection capture fails and preserves the draft', async () => {
		const {
			context,
			contentEl,
			requestChatCompletion,
			captureChatContext,
		} = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		const file = new TFile();
		file.path = 'A.md';
		const snapshot = {
			file,
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const editor = {
			readCurrentText: () => snapshot.fullText,
			isTargetCurrent: () => true,
			replaceRange: vi.fn(),
		};
		const captureSelectionEditTarget = vi.fn(() => ({ snapshot, editor }));
		captureSelectionEditTarget.mockImplementationOnce(() => {
			throw new Error('Select non-whitespace text first.');
		});
		const requestSelectionEdit = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' as const },
		}));
		const persistMessages = vi.fn(async () => undefined);
		Object.assign(context.plugin, {
			captureSelectionEditTarget,
			requestSelectionEdit,
		});
		Object.assign(context, { persistMessages });
		captureChatContext.mockReturnValue({
			file,
			sourceText: snapshot.fullText,
			selection: { from: 0, to: 0 },
			noteLabel: file.path,
			markdown: snapshot.fullText,
		});
		const activeModeIndex = () => findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-mode-button'),
		).findIndex((element) => element.className.split(' ').includes('is-active'));
		const webSelect = () => findElements(
			contentEl,
			(element) =>
				element.tagName === 'select' &&
				element.attributes['aria-label'] === 'Web search mode',
		)[0];
		expect(context.selectedMode).toBe('ask');
		expect(activeModeIndex()).toBe(0);
		expect(context.displayedEditTarget).toBe('selection');
		expect(webSelect()?.disabled).toBe(false);
		if (context.inputEl) {
			context.inputEl.value = 'Preserve this draft';
		}

		const quickAction = findElements(
			contentEl,
			(element) => element.attributes['data-action-id'] === 'fix-grammar',
		)[0];
		quickAction?.dispatch('click');

		expect(context.selectedMode).toBe('edit');
		expect(activeModeIndex()).toBe(1);
		expect(webSelect()?.disabled).toBe(true);
		expect(context.inputEl?.value).toBe('Preserve this draft');
		expect(context.inputEl?.attributes.placeholder).toBe(
			'Edit the note or selection with CriticMarkup...',
		);
		expect(requestSelectionEdit).not.toHaveBeenCalled();
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(context.messages).toEqual([]);
		expect(persistMessages).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();

		if (context.inputEl) {
			context.inputEl.value = 'Send using the visible mode';
		}
		const send = findElements(
			contentEl,
			(element) => element.tagName === 'button' && element.textContent === 'Send',
		)[0];
		send?.dispatch('click');
		await vi.waitFor(() => expect(requestSelectionEdit).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(context.isSending).toBe(false));

		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(activeModeIndex()).toBe(1);
	});

	it('clears the selector element reference on close', async () => {
		const { context } = createEditTargetView();
		context.editTargetSelectEl = new FakeElement('select');

		await viewPrototype.onClose.call(context);

		expect(context.editTargetSelectEl).toBeNull();
	});
});

describe('EmendChatView edit target styles', () => {
	it('keeps the compact control readable and its disabled state native-looking', () => {
		const control = getCssRule('.emend-chat-edit-target');
		const select = getCssRule('.emend-chat-edit-target select');
		const disabled = getCssRule('.emend-chat-edit-target select:disabled');

		expect(control).toContain('min-width: 0;');
		expect(control).toContain('color: var(--text-muted);');
		expect(select).toContain('min-width: 0;');
		expect(disabled).toContain('color: var(--text-muted);');
		expect(disabled).toContain('cursor: not-allowed;');
	});

	it('allows the target selector to wrap within narrow sidebars', () => {
		expect(getCssRule('@media (max-width: 400px)')).not.toBe('');
		expect(getCssRule('.emend-chat-edit-target select')).toContain('max-width: 100%;');
	});
});

describe('EmendChatView provider history', () => {
	it('filters transient entries and preserves metadata in the last eight ready messages', () => {
		const context = {
			messages: [
				{ ...message('old-question', 'Note.md'), role: 'user' as const, content: 'Old question' },
				{ ...message('old-answer', 'Note.md'), content: 'Old answer' },
				{ ...message('ask-question', 'Note.md'), role: 'user' as const, content: 'Ask question' },
				{ ...message('loading', 'Note.md'), status: 'loading' as const, content: 'Partial answer' },
				{ ...message('edit-question', 'Note.md'), role: 'user' as const, mode: 'edit' as const, content: 'Edit question' },
				{ ...message('edit-status', 'Note.md'), mode: 'edit' as const, content: 'Edit applied — 2 changes tracked. Review in Track Changes.' },
				{ ...message('error', 'Note.md'), status: 'error' as const, content: 'Provider error' },
				{ ...message('ask-answer', 'Note.md'), content: 'Ask answer' },
				{ ...message('stopped', 'Note.md'), status: 'stopped' as const, content: 'Stopped answer' },
				{ ...message('discuss-answer', 'Note.md'), mode: 'discuss' as const, content: 'Discuss answer' },
				{ ...message('brainstorm-question', 'Note.md'), role: 'user' as const, mode: 'brainstorm' as const, content: 'Brainstorm question' },
				{ ...message('brainstorm-answer', 'Note.md'), mode: 'brainstorm' as const, content: 'Brainstorm answer' },
				{ ...message('follow-up-question', 'Note.md'), role: 'user' as const, content: 'Follow-up question' },
				{ ...message('follow-up-answer', 'Note.md'), content: 'Follow-up answer' },
			],
		};

		expect(viewPrototype.toProviderHistory.call(context)).toEqual([
			{ role: 'user', content: 'Edit question', mode: 'edit', origin: 'user' },
			{ role: 'assistant', content: 'Edit applied — 2 changes tracked. Review in Track Changes.', mode: 'edit', origin: 'local-edit-status' },
			{ role: 'assistant', content: 'Ask answer', mode: 'ask', origin: 'model' },
			{ role: 'assistant', content: 'Discuss answer', mode: 'discuss', origin: 'model' },
			{ role: 'user', content: 'Brainstorm question', mode: 'brainstorm', origin: 'user' },
			{ role: 'assistant', content: 'Brainstorm answer', mode: 'brainstorm', origin: 'model' },
			{ role: 'user', content: 'Follow-up question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'Follow-up answer', mode: 'ask', origin: 'model' },
		]);
	});

	it('keeps retrieved sources with their historical answer so source IDs remain unambiguous', () => {
		const context = {
			messages: [{
				...message('researched-answer', 'Note.md'),
				content: 'Historical answer [S1]',
				webSources: [{ id: 'S1', title: 'Original source', url: 'https://example.test/original' }],
			}],
		};

		expect(viewPrototype.toProviderHistory.call(context)[0]?.content).toBe(
			'Historical answer [S1]\n\n### Sources\n- [S1] [Original source](https://example.test/original)',
		);
	});
});

describe('EmendChatView conversation loading', () => {
	it('applies only the latest note load during rapid note switches', async () => {
		let activePath = 'First.md';
		const first = deferred<ChatMessage[]>();
		const second = deferred<ChatMessage[]>();
		const context = {
			plugin: {
				getActiveNotePath: () => activePath,
				conversationStore: {
					load: vi.fn((path: string) =>
						path === 'First.md' ? first.promise : second.promise,
					),
				},
			},
			notePath: null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'brainstorm',
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			render: vi.fn(),
		};

		const firstLoad = viewPrototype.refreshTargetNote.call(context);
		activePath = 'Second.md';
		const secondLoad = viewPrototype.refreshTargetNote.call(context);
		second.resolve([message('second', 'Second.md')]);
		await secondLoad;
		first.resolve([message('first', 'First.md')]);
		await firstLoad;

		expect(context.messages.map((item) => item.id)).toEqual(['second']);
		expect(context.notePath).toBe('Second.md');
		expect(context.selectedMode).toBe('brainstorm');
		expect(context.isThreadLoading).toBe(false);
	});

	it('does not apply a pending load after the view closes', async () => {
		const pending = deferred<ChatMessage[]>();
		const context = {
			plugin: {
				getActiveNotePath: () => 'Note.md',
				conversationStore: { load: vi.fn(() => pending.promise) },
			},
			notePath: null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			render: vi.fn(),
		};

		const loading = viewPrototype.refreshTargetNote.call(context);
		context.closed = true;
		context.noteLoadGeneration++;
		pending.resolve([message('stale', 'Note.md')]);
		await loading;

		expect(context.messages).toEqual([]);
	});

	it('clears the thread-loading state when the view closes', async () => {
		const context = {
			closed: false,
			isThreadLoading: true,
			noteLoadGeneration: 0,
			notePath: 'Note.md',
			activeController: null,
			cancelPendingRender: vi.fn(),
			pendingMessages: new Set(),
			messageBodyEls: new Map(),
			activeModelEl: null,
			inputEl: null,
			contentEl: { empty: vi.fn() },
		};

		await viewPrototype.onClose.call(context);

		expect(context.isThreadLoading).toBe(false);
	});
});

describe('EmendChatView conversation saving', () => {
	it('saves the ready user message and completed assistant message with usage', async () => {
		const savedSnapshots: Array<Array<{ role: string; status: string; content: string }>> = [];
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			selectedMode: 'ask' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(
					async ({ callbacks }: { callbacks: { onContent: (text: string) => void } }) => {
						callbacks.onContent('Answer');
						return {
							content: 'Answer',
							reasoning: '',
							usage: {
								promptTokens: 3,
								completionTokens: 1,
								totalTokens: 4,
								source: 'provider' as const,
							},
						};
					},
				),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(
					messages.map(({ role, status, content }) => ({ role, status, content })),
				);
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(savedSnapshots).toEqual([
			[{ role: 'user', status: 'ready', content: 'Question' }],
			[
				{ role: 'user', status: 'ready', content: 'Question' },
				{ role: 'assistant', status: 'ready', content: 'Answer' },
			],
		]);
		expect(context.messages[1]?.usage).toEqual({
			promptTokens: 3,
			completionTokens: 1,
			totalTokens: 4,
			source: 'provider',
		});
		expect(context.messages.every((item) => item.timestamp > 0)).toBe(true);
	});

	it('persists one concise corrected Edit summary with aggregate usage and clean later history', async () => {
		const file = new TFile();
		file.path = 'Note.md';
		const sourceText = 'Alpha beta.';
		const validResponse = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]);
		const invalidReasoning = 'INVALID_ROUND_REASONING';
		const validReasoning = 'VALID_ROUND_REASONING';
		const request = vi.fn(async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
		): Promise<StreamResult> => {
			callbacks.onEvent({ type: 'reasoning', text: invalidReasoning });
			return { content: 'private invalid response', reasoning: invalidReasoning };
		});
		request
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'reasoning', text: invalidReasoning });
				return {
					content: 'private invalid response',
					reasoning: invalidReasoning,
					usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
				};
			})
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'reasoning', text: validReasoning });
				return {
					content: validResponse,
					reasoning: validReasoning,
					usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
				};
			});
		const editProvider: ProviderConfig = {
			name: 'Local test provider',
			baseUrl: 'http://127.0.0.1:8787/v1',
			apiKey: 'dummy-test-key',
			model: 'dummy-model',
			reasoningEffort: 'low',
			requestUsage: true,
			discoveredModels: [],
		};
		const writer = {
			readCurrentText: vi.fn(async () => sourceText),
			write: vi.fn(async () => undefined),
			isTargetCurrent: vi.fn(() => true),
		};
		const editCoordinator = new EditRequestCoordinator({
			provider: editProvider,
			loadAdditionalNotes: async () => [],
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request,
			writer,
			editStrategy: operationEditStrategy,
		});
		const requestChatCompletion = vi.fn(async (
			submission: EditSubmission | ReadOnlySubmission,
		) => {
			if (submission.mode === 'edit') {
				return editCoordinator.submit(submission);
			}
			submission.callbacks.onContent('Answer');
			return {
				content: 'Answer',
				reasoning: '',
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider' as const,
				},
			};
		});
		const requestContext = {
			file,
			sourceText,
			selection: { from: 0, to: 0 },
			noteLabel: 'Note.md',
			markdown: sourceText,
		};
		const savedSnapshots: ChatMessage[][] = [];
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as Mode,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => requestContext,
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => viewPrototype.toProviderHistory.call(context),
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(messages.map((message) => ({ ...message })));
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};
		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.\n- Replaced line 1.';

		await viewPrototype.submitPrompt.call(context);

		expect(request).toHaveBeenCalledTimes(2);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			file,
			'Alpha {~~beta~>delta~~}.',
		);
		expect(context.messages).toHaveLength(2);
		expect(context.messages[1]).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: summary,
			reasoning: validReasoning,
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		});
		expect(savedSnapshots).toHaveLength(2);
		const savedUser = {
			id: context.messages[0]?.id ?? '',
			role: 'user',
			content: 'Edit note',
			reasoning: '',
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: context.messages[0]?.timestamp ?? -1,
		};
		const savedEdit = {
			id: context.messages[1]?.id ?? '',
			role: 'assistant',
			content: summary,
			reasoning: validReasoning,
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: context.messages[1]?.timestamp ?? -1,
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		};
		expect(savedSnapshots[0]).toEqual([savedUser]);
		expect(savedSnapshots[1]).toEqual([savedUser, savedEdit]);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			'private invalid response',
		);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			validResponse,
		);

		context.inputEl.value = 'Next question';
		context.selectedMode = 'ask';
		await viewPrototype.submitPrompt.call(context);

		const nextSubmission = requestChatCompletion.mock.calls[1]?.[0];
		expect(nextSubmission?.history.map((message) => message.content)).toEqual([
			'Edit note',
			summary,
		]);
		expect(nextSubmission?.history.map((message) => message.content).join('\n')).not.toContain(
			'invalid-json',
		);
		expect(context.messages.filter(
			(message) => message.role === 'assistant',
		).map((message) => message.content)).toEqual([summary, 'Answer']);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			'private invalid response',
		);
		expect(savedSnapshots.flat().map((message) => message.reasoning).join('\n')).not.toContain(
			invalidReasoning,
		);
	});
});

interface SelectionSubmissionOptions {
	fullText?: string;
	selectedText?: string;
	from?: number;
	to?: number;
	summaryItems?: readonly EditSummaryItem[];
}

function createSelectionEditSubmission(options: SelectionSubmissionOptions = {}) {
	const file = new TFile();
	file.path = 'Note.md';
	const snapshot: SelectionSnapshot = {
		file,
		fullText: options.fullText ?? 'Alpha beta.',
		selectedText: options.selectedText ?? 'beta',
		from: options.from ?? 6,
		to: options.to ?? 10,
	};
	const editor: SelectionEditorAdapter = {
		readCurrentText: vi.fn(() => snapshot.fullText),
		isTargetCurrent: vi.fn(() => true),
		replaceRange: vi.fn(),
	};
	const additionalNotesStore = new AdditionalNotesStore();
	const captureSelectionEditTarget = vi.fn(() => ({ snapshot, editor }));
	const captureChatContext = vi.fn(() => ({
		file,
		sourceText: snapshot.fullText,
		selection: { from: snapshot.from, to: snapshot.to },
		noteLabel: file.path,
		markdown: snapshot.fullText,
	}));
	const requestSelectionEdit = vi.fn(async (
		_snapshot: SelectionSnapshot,
		_prompt: string,
		_signal: AbortSignal,
		_editor: SelectionEditorAdapter,
		_additionalNotePaths: readonly string[],
		callbacks?: SelectionEditCallbacks,
	): Promise<SelectionEditResult> => {
		callbacks?.onReasoning?.('REJECTED raw JSON and diagnostics');
		callbacks?.onRetry?.();
		callbacks?.onReasoning?.('Successful reasoning');
		return {
			applied: true,
			changeCount: 2,
			summaryItems: options.summaryItems ?? [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		};
	});
	const requestChatCompletion = vi.fn(async (submission: {
		mode: Mode;
		prompt: string;
		history: ProviderHistoryMessage[];
		additionalNotePaths: readonly string[];
		callbacks: { onContent?: (text: string) => void };
	}) => {
		if (submission.mode === 'edit') {
			return {
				applied: false,
				changeCount: 0,
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider' as const,
				},
			};
		}
		submission.callbacks.onContent?.('Answer');
		return {
			content: 'Answer',
			reasoning: '',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider' as const,
			},
		};
	});
	const savedSnapshots: ChatMessage[][] = [];
	let activePath = file.path;
	const context = {
		inputEl: { value: 'Edit selection' },
		isSending: false,
		isThreadLoading: false,
		selectedMode: 'edit' as Mode,
		editTargetChoice: 'auto' as 'auto' | 'full-note' | 'selection',
		displayedEditTarget: 'selection' as 'full-note' | 'selection',
		webSearchMode: 'off' as const,
		notePath: file.path as string | null,
		noteLoadGeneration: 0,
		messages: [] as ChatMessage[],
		drafts: new Map<string, string>(),
		plugin: {
			getActiveNotePath: () => activePath,
			conversationStore: { load: vi.fn(async () => []) },
			captureChatContext,
			captureSelectionEditTarget,
			additionalNotesStore,
			requestChatCompletion,
			requestSelectionEdit,
			settings: { maxWebToolCalls: 8 },
		},
		toProviderHistory: () => viewPrototype.toProviderHistory.call(context),
		persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
			savedSnapshots.push(messages.map((message) => ({ ...message })));
		}),
		render: vi.fn(),
		scheduleMessageRender: vi.fn(),
		closed: false,
		activeController: null as AbortController | null,
	};
	return {
		context,
		snapshot,
		editor,
		additionalNotesStore,
		captureChatContext,
		captureSelectionEditTarget,
		requestChatCompletion,
		requestSelectionEdit,
		savedSnapshots,
		persistMessages: context.persistMessages,
		setActivePath: (path: string) => {
			activePath = path;
		},
	};
}

describe('EmendChatView selection edit submission', () => {
	it('routes automatic displayed Selection through the exact native-editor request and normal saves', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.additionalNotesStore.add('Note.md', 'Reference.md');
		const summary = 'Edit applied — 2 changes tracked. Review in Track Changes.\n- Replaced line 1.';

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.captureSelectionEditTarget).toHaveBeenCalledOnce();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce();
		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(fixture.snapshot);
		expect(args?.[1]).toBe('Edit selection');
		expect(args?.[2]).toBeInstanceOf(AbortSignal);
		expect(args?.[2].aborted).toBe(false);
		expect(args?.[3]).toBe(fixture.editor);
		expect(args?.[4]).toEqual(['Reference.md']);
		expect(typeof args?.[5]?.onReasoning).toBe('function');
		expect(typeof args?.[5]?.onRetry).toBe('function');
		expect(fixture.context.messages[1]).toMatchObject({
			status: 'ready',
			content: summary,
			reasoning: 'Successful reasoning',
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		});
		expect(fixture.savedSnapshots).toHaveLength(2);
		const persisted = JSON.stringify(fixture.savedSnapshots);
		expect(persisted).not.toContain('REJECTED raw JSON');
		expect(persisted).not.toContain('Alpha beta.');
		expect(persisted).not.toContain('"from":6');
		expect(persisted).not.toContain('"to":10');

		fixture.context.inputEl.value = 'Next question';
		fixture.context.selectedMode = 'ask';
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].history.map(
			(message) => message.content,
		)).toEqual([
			'Edit selection',
			summary,
		]);
	});

	it('adds the Selection start offset once to note-absolute summary lines', async () => {
		const fixture = createSelectionEditSubmission({
			fullText: 'Intro line.\nFirst target.\nSecond target.\nOutro line.',
			selectedText: 'First target.\nSecond target.',
			from: 12,
			to: 40,
			summaryItems: [{ type: 'replace', start: 0, end: 28 }],
		});

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe(
			'Edit applied — 2 changes tracked. Review in Track Changes.\n- Replaced lines 2–3.',
		);
	});

	it('keeps the exact no-op text when a non-applied result carries summary items', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.requestSelectionEdit.mockResolvedValueOnce({
			applied: false,
			changeCount: 0,
			summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe('No changes were needed.');
		expect(fixture.context.messages[1]?.content).not.toContain('- ');
	});

	it('formats full-note summaries against the captured note source', async () => {
		const file = new TFile();
		file.path = 'Note.md';
		const sourceText = 'Intro line.\nTarget line.\nOutro line.';
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as Mode,
			displayedEditTarget: 'full-note' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({
					file,
					sourceText,
					selection: { from: 0, to: 0 },
					noteLabel: file.path,
					markdown: sourceText,
				}),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(async () => ({
					applied: true,
					changeCount: 1,
					summaryItems: [{ type: 'replace' as const, start: 12, end: 24 }],
					usage: {
						promptTokens: 3,
						completionTokens: 1,
						totalTokens: 4,
						source: 'provider' as const,
					},
				})),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe(
			'Edit applied — 1 changes tracked. Review in Track Changes.\n- Replaced line 2.',
		);
	});

	it('keeps explicit Full note on the ordinary request despite a usable selection', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.context.editTargetChoice = 'full-note';
		fixture.context.displayedEditTarget = 'full-note';

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.captureChatContext).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'never routes read-only %s to a selection writer',
		async (mode) => {
			const fixture = createSelectionEditSubmission();
			fixture.context.selectedMode = mode;

			await viewPrototype.submitPrompt.call(fixture.context);

			expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
			expect(fixture.requestChatCompletion.mock.calls[0]?.[0].mode).toBe(mode);
			expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		},
	);

	it.each(['auto', 'selection'] as const)(
		'fails closed without messages, saves, or fallback when %s Selection capture fails',
		async (choice) => {
			const fixture = createSelectionEditSubmission();
			fixture.context.editTargetChoice = choice;
			fixture.captureSelectionEditTarget.mockImplementation(() => {
				throw new Error('Select non-whitespace text first.');
			});
			const noticeMessages = (Notice as unknown as {
				readonly messages: string[];
			}).messages;
			const noticeCount = noticeMessages.length;

			await viewPrototype.submitPrompt.call(fixture.context);

			expect(noticeMessages.slice(noticeCount)).toEqual([
				'Emend: Select non-whitespace text first.',
			]);
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
			expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
			expect(fixture.captureChatContext).not.toHaveBeenCalled();
			expect(fixture.context.messages).toEqual([]);
			expect(fixture.savedSnapshots).toEqual([]);
			expect(fixture.context.isSending).toBe(false);
		},
	);

	it('captures the selection and additional-note paths before a deferred initial save', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.additionalNotesStore.add('Note.md', 'Selected.md');
		const firstSave = deferred<void>();
		const response = deferred<SelectionEditResult>();
		fixture.persistMessages.mockImplementationOnce(() => firstSave.promise);
		fixture.requestSelectionEdit.mockImplementationOnce(() => response.promise);

		const submission = viewPrototype.submitPrompt.call(fixture.context);
		expect(fixture.captureSelectionEditTarget).toHaveBeenCalledOnce();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		fixture.additionalNotesStore.clear('Note.md');
		fixture.additionalNotesStore.add('Note.md', 'Later.md');
		fixture.captureSelectionEditTarget.mockImplementation(() => {
			throw new Error('Selection changed after capture.');
		});
		firstSave.resolve();
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(fixture.snapshot);
		expect(args?.[3]).toBe(fixture.editor);
		expect(args?.[4]).toEqual(['Selected.md']);
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;
		expect(fixture.context.messages[1]?.content).toBe('No changes were needed.');
	});

	it.each([
		['provider', 'Provider unavailable'],
		['validation', 'Invalid operation array'],
		['stale', 'The note changed while Emend was responding. No edits were applied.'],
	])('settles a %s failure and permits a selection retry without fallback', async (_kind, errorMessage) => {
		const fixture = createSelectionEditSubmission();
		fixture.requestSelectionEdit.mockRejectedValueOnce(new Error(errorMessage));

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]).toMatchObject({
			status: 'error',
			content: errorMessage,
		});
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'error',
		)).toBe(false);

		fixture.context.inputEl.value = 'Retry selection';
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestSelectionEdit).toHaveBeenCalledTimes(2);
		expect(fixture.context.messages[3]?.status).toBe('ready');
	});

	it('uses the existing stopped lifecycle and excludes the partial response from saves', async () => {
		const fixture = createSelectionEditSubmission();
		const response = deferred<SelectionEditResult>();
		fixture.requestSelectionEdit.mockImplementationOnce(() => response.promise);
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		fixture.context.activeController?.abort();
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;

		expect(fixture.context.messages[1]?.status).toBe('stopped');
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'stopped',
		)).toBe(false);
	});

	it('aborts the captured selection request on a note switch without saving it to the new thread', async () => {
		const fixture = createSelectionEditSubmission();
		const response = deferred<SelectionEditResult>();
		let requestSignal: AbortSignal | undefined;
		fixture.requestSelectionEdit.mockImplementationOnce((
			_snapshot,
			_prompt,
			signal,
		) => {
			requestSignal = signal;
			return response.promise;
		});
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		fixture.setActivePath('Other.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
		expect(requestSignal?.aborted).toBe(true);
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;

		expect(fixture.context.notePath).toBe('Other.md');
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'stopped',
		)).toBe(false);
	});
});

describe('EmendChatView additional notes', () => {
	it('freezes the selected paths before the first deferred save', async () => {
		const firstSave = deferred<void>();
		const response = deferred<{ content: string; reasoning: string }>();
		const additionalNotesStore = new AdditionalNotesStore();
		additionalNotesStore.add('Note.md', 'Selected.md');
		const requestChatCompletion = vi.fn(
			(_submission: { additionalNotePaths: readonly string[] }) => response.promise,
		);
		let saveCount = 0;
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore,
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(() => {
				saveCount++;
				return saveCount === 1 ? firstSave.promise : Promise.resolve();
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		const submission = viewPrototype.submitPrompt.call(context);
		expect(requestChatCompletion).not.toHaveBeenCalled();
		additionalNotesStore.clear('Note.md');
		additionalNotesStore.add('Note.md', 'Later.md');
		firstSave.resolve();
		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());

		expect(requestChatCompletion.mock.calls[0]?.[0].additionalNotePaths).toEqual([
			'Selected.md',
		]);
		response.resolve({ content: 'Answer', reasoning: '' });
		await submission;
	});

	it('keeps independent per-note drafts and selections and disables controls while pending', async () => {
		let activePath = 'A.md';
		const additionalNotesStore = new AdditionalNotesStore();
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => activePath,
				getActiveNoteLabel: () => activePath,
				hasUsableSelection: () => false,
				conversationStore: { load: vi.fn(async () => []) },
				additionalNotesStore,
				settings: {
					activeProvider: 'custom',
					providers: { custom: { name: 'Local', model: 'Test model' } },
				},
			},
			notePath: null as string | null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, string>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);
		Object.assign(context, {
			render: () => viewPrototype.render.call(context),
		});

		await viewPrototype.refreshTargetNote.call(context);
		const aComposer = context.inputEl;
		if (!aComposer) {
			throw new Error('A composer missing.');
		}
		aComposer.value = 'A draft';
		additionalNotesStore.add('A.md', 'For A.md');
		expect(context.inputEl).toBe(aComposer);
		expect(aComposer.value).toBe('A draft');
		expect(textOf(contentEl)).toContain('For A.md');

		activePath = 'B.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('');
		expect(textOf(contentEl)).not.toContain('For A.md');
		additionalNotesStore.add('B.md', 'For B.md');
		if (!context.inputEl) {
			throw new Error('B composer missing.');
		}
		context.inputEl.value = 'B draft';
		expect(textOf(contentEl)).toContain('For B.md');

		activePath = 'A.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('A draft');
		expect(textOf(contentEl)).toContain('For A.md');
		expect(textOf(contentEl)).not.toContain('For B.md');

		context.isSending = true;
		viewPrototype.render.call(context);
		const additionalButtons = findElements(
			contentEl,
			(element) =>
				element.tagName === 'button' &&
				element.className.includes('emend-additional-notes-'),
		);
		expect(additionalButtons.length).toBeGreaterThanOrEqual(3);
		expect(additionalButtons.every((button) => button.disabled)).toBe(true);
		expect(context.inputEl?.disabled).toBe(true);
		const quickActions = findElements(
			contentEl,
			(element) =>
				element.tagName === 'button' &&
				element.className.includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => button.disabled)).toBe(true);
	});

	it('clears an A → B → A restored draft during and after its submission', async () => {
		let activePath = 'A.md';
		const response = deferred<{ content: string; reasoning: string }>();
		const additionalNotesStore = new AdditionalNotesStore();
		const requestChatCompletion = vi.fn(
			(_submission: { additionalNotePaths: readonly string[] }) => response.promise,
		);
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => activePath,
				getActiveNoteLabel: () => activePath,
				hasUsableSelection: () => false,
				captureChatContext: () => ({ file: { path: activePath } }),
				conversationStore: { load: vi.fn(async () => []) },
				additionalNotesStore,
				requestChatCompletion,
				settings: {
					activeProvider: 'custom',
					providers: { custom: { name: 'Local', model: 'Test model' } },
				},
			},
			notePath: null as string | null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, string>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
			persistMessages: vi.fn(async () => undefined),
			scheduleMessageRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);
		Object.assign(context, {
			render: () => viewPrototype.render.call(context),
		});

		await viewPrototype.refreshTargetNote.call(context);
		if (!context.inputEl) {
			throw new Error('A composer missing.');
		}
		context.inputEl.value = 'Restore and send';
		activePath = 'B.md';
		await viewPrototype.refreshTargetNote.call(context);
		if (!context.inputEl) {
			throw new Error('B composer missing.');
		}
		context.inputEl.value = 'Keep B draft';
		activePath = 'A.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('Restore and send');

		const submission = viewPrototype.submitPrompt.call(context);

		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());
		expect(context.isSending).toBe(true);
		expect(context.inputEl?.disabled).toBe(true);
		expect(context.inputEl?.value).toBe('');
		expect(context.drafts.get('B.md')).toBe('Keep B draft');
		response.resolve({ content: 'Answer', reasoning: '' });
		await submission;
		expect(context.isSending).toBe(false);
		expect(context.inputEl?.disabled).toBe(false);
		expect(context.inputEl?.value).toBe('');
		expect(context.drafts.get('B.md')).toBe('Keep B draft');
	});
});

describe('EmendChatView keyboard shortcuts', () => {
	function keyboardEvent(overrides: Partial<ShortcutEvent> = {}) {
		return {
			key: 'Enter',
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			preventDefault: vi.fn(),
			...overrides,
		};
	}

	it.each([{}, { metaKey: true }, { ctrlKey: true }])(
		'submits and prevents the default for Enter and Mod+Enter: %o',
		(modifiers) => {
			const context = {
				isSending: false,
				isThreadLoading: false,
				submitPrompt: vi.fn().mockResolvedValue(undefined),
			};
			const event = keyboardEvent(modifiers);

			viewPrototype.handleComposerKeydown.call(context, event);

			expect(event.preventDefault).toHaveBeenCalledOnce();
			expect(context.submitPrompt).toHaveBeenCalledOnce();
		},
	);

	it('leaves Shift+Enter to the textarea for a newline', () => {
		const context = {
			isSending: false,
			isThreadLoading: false,
			submitPrompt: vi.fn(),
		};
		const event = keyboardEvent({ shiftKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it.each([
		{ isSending: true, isThreadLoading: false },
		{ isSending: false, isThreadLoading: true },
	])('does not submit through a shortcut while controls are unavailable: %o', (state) => {
		const context = { ...state, submitPrompt: vi.fn() };
		const event = keyboardEvent({ metaKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it('ignores modified-key conflicts in the real key handler', () => {
		const context = {
			isSending: false,
			isThreadLoading: false,
			submitPrompt: vi.fn(),
		};
		const event = keyboardEvent({ metaKey: true, shiftKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it('shows a newly selected mode immediately and preserves the draft without aborting', () => {
		const context = {
			selectedMode: 'ask' as Mode,
			inputEl: { value: 'Keep this draft' } as { value: string } | null,
			isSending: true,
			activeController: { abort: vi.fn() },
			render: vi.fn(() => {
				context.inputEl = { value: '' };
			}),
		};

		viewPrototype.setMode.call(context, 'edit');

		expect(context.selectedMode).toBe('edit');
		expect(context.inputEl?.value).toBe('Keep this draft');
		expect(context.render).toHaveBeenCalledOnce();
		expect(context.activeController.abort).not.toHaveBeenCalled();
	});

	it('changes only the next request mode while a submission is pending', async () => {
		const pending = deferred<{ content: string; reasoning: string }>();
		const requestChatCompletion = vi.fn((_submission: { mode: Mode }) => pending.promise);
		const context = {
			inputEl: { value: 'First prompt' } as { value: string } | null,
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as Mode,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn().mockResolvedValue(undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null as AbortController | null,
		};

		const submission = viewPrototype.submitPrompt.call(context);
		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());
		const controller = context.activeController;
		if (!controller) {
			throw new Error('Request controller missing.');
		}
		const abort = vi.spyOn(controller, 'abort');
		context.inputEl = { value: 'Next prompt' };

		viewPrototype.setMode.call(context, 'edit');

		expect(requestChatCompletion.mock.calls[0]?.[0].mode).toBe('ask');
		expect(context.selectedMode).toBe('edit');
		expect(context.inputEl.value).toBe('Next prompt');
		expect(abort).not.toHaveBeenCalled();
		pending.resolve({ content: 'Answer', reasoning: '' });
		await submission;
	});

	it('registers Mod+Enter on the Obsidian view scope only for the composer', () => {
		const parent = new Scope();
		const context = {
			app: { scope: parent },
			scope: null as Scope | null,
			inputEl: { value: 'Prompt' },
			handleComposerKeydown: vi.fn(),
		};

		viewPrototype.registerComposerScope.call(context);

		expect(context.scope).toBeInstanceOf(Scope);
		const scope = context.scope as unknown as {
			keys: Array<{
				modifiers: string[] | null;
				key: string | null;
				func(event: KeyboardEvent): unknown;
			}>;
		};
		const registration = scope.keys[0];
		expect(registration).toMatchObject({ modifiers: ['Mod'], key: 'Enter' });
		if (!registration) {
			throw new Error('Composer scope registration missing.');
		}
		const composerEvent = { target: context.inputEl } as unknown as KeyboardEvent;
		expect(registration.func(composerEvent)).toBe(false);
		expect(context.handleComposerKeydown).toHaveBeenCalledWith(composerEvent);
		expect(registration.func({ target: {} } as unknown as KeyboardEvent)).toBeUndefined();
		expect(context.handleComposerKeydown).toHaveBeenCalledOnce();
	});
});

describe('EmendChatView presentation', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the Emend display name', () => {
		expect(viewPrototype.getDisplayText.call({})).toBe('Emend');
	});

	it('shows loading content immediately without waiting for Markdown rendering', () => {
		const pendingRender = deferred<void>();
		const render = vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(pendingRender.promise);
		const body = new FakeElement();
		Object.assign(body, {
			empty: vi.fn(() => {
				body.children.length = 0;
				body.textContent = '';
			}),
			ownerDocument: {
				createElement: () => new FakeElement(),
			},
		});
		const context = {
			closed: false,
			messageBodyEls: new Map<string, HTMLElement>([
				['streaming', body as unknown as HTMLElement],
			]),
		};

		viewPrototype.renderMessageBody.call(context, {
			...message('streaming', 'Note.md'),
			content: 'First streamed chunk',
			status: 'loading',
		});

		expect(
			body.children.map((child) => child.textContent).join(''),
		).toContain('First streamed chunk');
		expect(render).not.toHaveBeenCalled();
	});
});

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly ownerDocument = { createElement: () => new FakeElement() };
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	value = '';
	open = false;
	scrollTop = 0;
	scrollHeight = 0;
	clientHeight = 0;
	isConnected = true;

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
		this.className = `${this.className} ${className}`.trim();
	}

	querySelector() {
		return this.children[0] ?? null;
	}

	getBoundingClientRect() {
		return { top: 0 };
	}

	replaceWith(replacement: FakeElement) {
		this.replacement = replacement;
	}

	replacement?: FakeElement;

	private readonly listeners = new Map<string, Array<() => void>>();

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}

	empty() {
		this.children.length = 0;
		this.textContent = '';
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
			if (tagName === 'option') {
				child.value = options?.attr?.value ?? child.textContent;
			}
		}
		this.children.push(child);
		return child;
	}
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

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

function findUsageFooter(container: FakeElement): FakeElement | undefined {
	if (container.className.includes('emend-chat-message-usage')) {
		return container;
	}
	for (const child of container.children) {
		const match = findUsageFooter(child);
		if (match) {
			return match;
		}
	}
	return undefined;
}

function renderForFooter(message: ChatMessage) {
	const container = new FakeElement();
	const context = {
		messageBodyEls: new Map<string, HTMLElement>(),
		renderMessageBody: vi.fn(),
		closed: false,
	};
	viewPrototype.renderMessage.call(
		context,
		container as unknown as HTMLElement,
		message,
	);
	return container;
}

describe('EmendChatView token usage footer', () => {
	it('shows provider total, prompt, and completion usage on completed answers', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			usage: {
				promptTokens: 12,
				completionTokens: 5,
				totalTokens: 17,
				source: 'provider',
			},
		});

		expect(findUsageFooter(container)?.textContent).toBe(
			'Provider usage · 17 total · 12 prompt · 5 completion',
		);
	});

	it('clearly labels estimated usage on concise Edit confirmations', () => {
		const container = renderForFooter({
			...message('Edit applied — 1 changes tracked. Review in Track Changes.', 'Note.md'),
			mode: 'edit',
			usage: {
				promptTokens: 20,
				completionTokens: 8,
				totalTokens: 28,
				source: 'estimated',
			},
		});

		expect(findUsageFooter(container)?.textContent).toBe(
			'Estimated usage · 28 total · 20 prompt · 8 completion',
		);
	});

	it.each(['loading', 'error', 'stopped'] as const)(
		'does not show usage for %s messages',
		(status) => {
			const container = renderForFooter({
				...message(status, 'Note.md'),
				status,
				usage: {
					promptTokens: 1,
					completionTokens: 1,
					totalTokens: 2,
					source: 'estimated',
				},
			});

			expect(findUsageFooter(container)).toBeUndefined();
		},
	);

	it('does not show usage on user messages', () => {
		const container = renderForFooter({
			...message('question', 'Note.md'),
			role: 'user',
			usage: {
				promptTokens: 1,
				completionTokens: 1,
				totalTokens: 2,
				source: 'estimated',
			},
		});

		expect(findUsageFooter(container)).toBeUndefined();
	});
});


describe('EmendChatView web research', () => {
	it('captures Auto options, activity, user badge metadata, and returned sources', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			webSearch?: { onActivity(activity: { status: string; label: string }): void };
			callbacks: { onContent(text: string): void };
		}) => {
			submission.webSearch?.onActivity({ status: 'pending', label: 'Searching: Emend' });
			submission.callbacks.onContent('Answer [S1]');
			return {
				content: 'Answer [S1]',
				reasoning: '',
				sources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' }],
				activities: [
					{ type: 'search' as const, target: 'Emend', status: 'completed' as const },
					{ type: 'fetch' as const, target: 'https://example.test/unreadable', status: 'failed' as const },
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 6, maxWebContentCharactersPerCall: 12345 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const submission = requestChatCompletion.mock.calls[0]?.[0];
		expect(submission).toMatchObject({
			webSearch: { mode: 'auto', maxToolCalls: 6, maxContentCharactersPerCall: 12345 },
		});
		expect(context.messages[0]?.webSearchMode).toBe('auto');
		expect(context.messages[1]?.webSources).toEqual([
			{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' },
		]);
		expect(context.messages[1]?.webActivity).toBe('Searching: Emend');
		expect(context.messages[1]?.webActivities).toEqual([
			{ type: 'search', target: 'Emend', status: 'completed' },
			{ type: 'fetch', target: 'https://example.test/unreadable', status: 'failed' },
		]);
		expect(context.messages[1]?.content).toContain(
			'Emend could not read 1 requested page. The answer may be incomplete.',
		);
		expect(context.messages[1]?.content).not.toContain('Emend could not extract information');
	});

	it.each([
		{
			failedExtractions: 1,
			activities: [{
				type: 'fetch' as const,
				target: 'https://example.test/extraction-failed',
				status: 'failed' as const,
				failureKind: 'extraction' as const,
			}],
			unreadWarning: '',
		},
		{
			failedExtractions: 2,
			activities: [
				{ type: 'fetch' as const, target: 'https://example.test/unread', status: 'failed' as const },
				{
					type: 'fetch' as const,
					target: 'https://example.test/extraction-failed',
					status: 'failed' as const,
					failureKind: 'extraction' as const,
				},
			],
			unreadWarning: 'Emend could not read 1 requested page. The answer may be incomplete.\n\n',
		},
	])('appends and persists one exact extraction warning for $failedExtractions failures', async ({ failedExtractions, activities, unreadWarning }) => {
		const warning = `Emend could not extract information from ${failedExtractions} web ${failedExtractions === 1 ? 'query' : 'queries'}. The answer may be incomplete.`;
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from extracted evidence');
			return {
				content: 'Answer from extracted evidence',
				reasoning: '',
				failedExtractions,
				activities,
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = `Answer from extracted evidence\n\n${unreadWarning}${warning}`;
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(warning)).toHaveLength(2);
		expect(context.messages[1]?.content).not.toContain('40,000-character content budget');
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(warning)).toHaveLength(2);
	});

	it.each([1, 2])('appends and persists one exact skipped-call warning alongside other warnings for %s skips', async (skippedWebCalls) => {
		const skippedWarning = skippedWebCalls === 1
			? 'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.'
			: 'Web retrieval reached the 20-call limit. 2 proposed calls were skipped; the answer may be incomplete.';
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 1,
				skippedWebCalls,
				activities: [
					{ type: 'fetch' as const, target: 'https://example.test/unread', status: 'failed' as const },
					{
						type: 'fetch' as const,
						target: 'https://example.test/extraction-failed',
						status: 'failed' as const,
						failureKind: 'extraction' as const,
					},
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from available evidence',
			'Emend could not read 1 requested page. The answer may be incomplete.',
			'Emend could not extract information from 1 web query. The answer may be incomplete.',
			skippedWarning,
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(skippedWarning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(skippedWarning)).toHaveLength(2);
	});

	it.each([1, 2])('appends and persists one exact search warning for %s failed searches', async (failedSearches) => {
		const warning = `Emend could not complete ${failedSearches} web ${failedSearches === 1 ? 'search' : 'searches'}. The answer may be incomplete.`;
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 0,
				failedSearches,
				skippedWebCalls: 0,
				activities: [{
					type: 'search' as const,
					target: 'failed query',
					status: 'failed' as const,
					failureReason: 'network' as const,
				}],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = `Answer from available evidence\n\n${warning}`;
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(warning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(warning)).toHaveLength(2);
	});

	it('appends and persists one exact omission warning between the search and skipped-call warnings', async () => {
		const omissionWarning = 'Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.';
		const searchWarning = 'Emend could not complete 1 web search. The answer may be incomplete.';
		const skippedWarning = 'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.';
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from capped evidence');
			return {
				content: 'Answer from capped evidence',
				reasoning: '',
				failedExtractions: 0,
				failedSearches: 1,
				skippedWebCalls: 1,
				omittedEvidence: true,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from capped evidence',
			searchWarning,
			omissionWarning,
			skippedWarning,
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(omissionWarning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(omissionWarning)).toHaveLength(2);
	});

	it.each([
		{ omittedEvidence: false, webSearchMode: 'auto' as const },
		{ omittedEvidence: undefined, webSearchMode: 'auto' as const },
		{ omittedEvidence: false, webSearchMode: 'off' as const },
	])('does not warn about omitted evidence when nothing was omitted ($omittedEvidence, $webSearchMode)', async ({ omittedEvidence, webSearchMode }) => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer within the cap');
			return {
				content: 'Answer within the cap',
				reasoning: '',
				failedExtractions: 0,
				failedSearches: 0,
				skippedWebCalls: 0,
				omittedEvidence,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe('Answer within the cap');
		expect(context.messages[1]?.content).not.toContain('Emend omitted some extracted evidence');
	});

	it('orders unread-page, extraction, search, omission, and skipped-call warnings', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 1,
				failedSearches: 2,
				skippedWebCalls: 1,
				omittedEvidence: true,
				activities: [
					{
						type: 'fetch' as const,
						target: 'https://example.test/unread',
						status: 'failed' as const,
						failureReason: 'network' as const,
					},
					{
						type: 'fetch' as const,
						target: 'https://example.test/extraction-failed',
						status: 'failed' as const,
						failureKind: 'extraction' as const,
						failureReason: 'reader' as const,
					},
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from available evidence',
			'Emend could not read 1 requested page. The answer may be incomplete.',
			'Emend could not extract information from 1 web query. The answer may be incomplete.',
			'Emend could not complete 2 web searches. The answer may be incomplete.',
			'Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.',
			'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.',
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
	});

	it.each([
		{ failedSearches: 0, webSearchMode: 'auto' as const },
		{ failedSearches: undefined, webSearchMode: 'auto' as const },
		{ failedSearches: 0, webSearchMode: 'off' as const },
	])('does not warn without failed searches ($failedSearches, $webSearchMode)', async ({ failedSearches, webSearchMode }) => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer without failed searches');
			return {
				content: 'Answer without failed searches',
				reasoning: '',
				failedExtractions: 0,
				failedSearches,
				skippedWebCalls: 0,
				activities: [{ type: 'search' as const, target: 'completed query', status: 'completed' as const }],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe('Answer without failed searches');
		expect(context.messages[1]?.content).not.toContain('Emend could not complete');
	});

	it('does not add a skipped-call warning at the exact limit', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer at the exact limit');
			return {
				content: 'Answer at the exact limit',
				reasoning: '',
				failedExtractions: 0,
				skippedWebCalls: 0,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe('Answer at the exact limit');
		expect(context.messages[1]?.content).not.toContain('Web retrieval reached');
	});

	it('does not submit web options in Edit even when Auto is selected', async () => {
		const requestChatCompletion = vi.fn(async (_submission: unknown) => ({
			applied: false,
			usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
		}));
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 6 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(requestChatCompletion.mock.calls[0]?.[0]).not.toHaveProperty('webSearch');
		expect(context.messages[0]?.webSearchMode).toBeUndefined();
	});

	it('renders only retrieved source links and the Review/Auto badge', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webSources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' }],
		});
		const user = renderForFooter({
			...message('question', 'Note.md'),
			role: 'user',
			webSearchMode: 'review',
		});

		const anchors = findElements(container, (element) => element.tagName === 'a');
		expect(anchors).toHaveLength(1);
		expect(anchors[0]?.attributes.href).toBe('https://example.test/source');
		expect(textOf(container)).toContain('Evidence');
		expect(textOf(user)).toContain('Web: Review');
	});

	it('copies actual citations without treating model-written links as retrieved sources', () => {
		const copied = formatChatMessageForCopy({
			...message('answer', 'Note.md'),
			content: 'Answer [S1] with [unverified](https://unverified.test)',
			webSources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source' }],
		});

		expect(copied).toContain('https://example.test/source');
		expect(copied).toContain('https://unverified.test');
		expect(copied.match(/### Sources/g)).toHaveLength(1);
	});
});


describe('EmendChatView web activity review', () => {
	it('renders a closed folded activity list with completed, failed, and skipped outcomes', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [
				{ type: 'search', target: 'activity query', status: 'completed' },
				{ type: 'fetch', target: 'https://example.test/failed', status: 'failed' },
				{ type: 'fetch', target: 'https://example.test/skipped', status: 'skipped' },
			],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		expect(details?.open).toBe(false);
		expect(textOf(details as FakeElement)).toContain('Web activity (3)');
		expect(textOf(details as FakeElement)).toContain('Search · Completed · activity query');
		expect(textOf(details as FakeElement)).toContain('Fetch · Failed · https://example.test/failed');
		expect(textOf(details as FakeElement)).toContain('Fetch · Skipped · https://example.test/skipped');
	});

	it.each([
		[
			'network',
			{ type: 'fetch' as const, target: 'https://example.test/page', status: 'failed' as const, failureReason: 'network' as const },
			'Fetch · Failed (network) · https://example.test/page',
		],
		[
			'http',
			{ type: 'search' as const, target: 'example query', status: 'failed' as const, failureReason: 'http' as const },
			'Search · Failed (HTTP) · example query',
		],
		[
			'empty',
			{ type: 'fetch' as const, target: 'https://example.test/blank', status: 'failed' as const, failureReason: 'empty' as const },
			'Fetch · Failed (empty page) · https://example.test/blank',
		],
		[
			'reader',
			{ type: 'fetch' as const, target: 'https://example.test/page', status: 'failed' as const, failureReason: 'reader' as const },
			'Fetch · Failed (reader) · https://example.test/page',
		],
		[
			'http with status',
			{
				type: 'fetch' as const,
				target: 'https://example.test/forbidden',
				status: 'failed' as const,
				failureReason: 'http' as const,
				failureStatus: 403,
			},
			'Fetch · Failed (HTTP 403) · https://example.test/forbidden',
		],
		[
			'reader format',
			{
				type: 'fetch' as const,
				target: 'https://example.test/format',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'format' as const,
			},
			'Fetch · Failed (reader format) · https://example.test/format',
		],
		[
			'reader provider',
			{
				type: 'search' as const,
				target: 'service query',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'provider' as const,
			},
			'Search · Failed (reader service) · service query',
		],
		[
			'reader limit',
			{
				type: 'fetch' as const,
				target: 'https://example.test/limit',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'limit' as const,
			},
			'Fetch · Failed (reader limit) · https://example.test/limit',
		],
		[
			'http after retry',
			{
				type: 'fetch' as const,
				target: 'https://example.test/forbidden',
				status: 'failed' as const,
				failureReason: 'http' as const,
				failureStatus: 403,
				attempts: 2,
			},
			'Fetch · Failed (HTTP 403, 2 attempts) · https://example.test/forbidden',
		],
		[
			'network with one attempt',
			{
				type: 'fetch' as const,
				target: 'https://example.test/blocked',
				status: 'failed' as const,
				failureReason: 'network' as const,
				attempts: 1,
			},
			'Fetch · Failed (network) · https://example.test/blocked',
		],
		[
			'empty page after retry',
			{
				type: 'fetch' as const,
				target: 'https://example.test/blank',
				status: 'failed' as const,
				failureReason: 'empty' as const,
				attempts: 2,
			},
			'Fetch · Failed (empty page, 2 attempts) · https://example.test/blank',
		],
	])('labels failed %s activities with their failure reason', (_reason, activity, expected) => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [activity],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		expect(textOf(details as FakeElement)).toContain(expected);
	});

	it('leaves completed and skipped rows unchanged and ignores unknown reasons', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [
				{
					type: 'search',
					target: 'done query',
					status: 'completed',
					failureReason: 'network',
				},
				{
					type: 'fetch',
					target: 'https://example.test/skipped',
					status: 'skipped',
					failureReason: 'reader',
				},
				{
					type: 'fetch',
					target: 'https://example.test/unknown',
					status: 'failed',
					failureReason: 'mystery' as unknown as WebActivityRecord['failureReason'],
				},
				{
					type: 'fetch',
					target: 'https://example.test/completed-reader',
					status: 'completed',
					readerFailureKind: 'limit',
				},
			],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		const rendered = textOf(details as FakeElement);
		expect(rendered).toContain('Search · Completed · done query');
		expect(rendered).toContain('Fetch · Skipped · https://example.test/skipped');
		expect(rendered).toContain('Fetch · Failed · https://example.test/unknown');
		expect(rendered).toContain('Fetch · Completed · https://example.test/completed-reader');
		expect(rendered).not.toContain('mystery');
		expect(rendered).not.toContain('(undefined)');
		expect(rendered).not.toContain('reader limit');
		expect(rendered).not.toContain('HTTP undefined');
	});
});


describe('EmendChatView latest-message scrolling', () => {
	it('aligns the scroller to its full height when following the latest response', () => {
		const messagesEl = { scrollHeight: 1200, scrollTop: 0 };
		viewPrototype.scrollMessagesToBottom.call({ closed: false, messagesEl });
		expect(messagesEl.scrollTop).toBe(1200);
	});

	it('restores the previous position when the reader was not following latest', () => {
		const messagesEl = { scrollHeight: 1200, scrollTop: 0 };
		viewPrototype.restoreMessageScroll.call({ messagesEl }, 275, false);
		expect(messagesEl.scrollTop).toBe(275);

		const scrollMessagesToBottom = vi.fn();
		viewPrototype.restoreMessageScroll.call({ messagesEl, scrollMessagesToBottom }, 275, true);
		expect(scrollMessagesToBottom).toHaveBeenCalledOnce();
	});

	it('scrolls after streamed message bodies only while following latest', () => {
		const pendingMessage = { ...message('streaming', 'Note.md'), status: 'loading' as const };
		const scrollMessagesToBottomIfFollowing = vi.fn();
		const context = {
			closed: false,
			pendingMessages: new Set([pendingMessage]),
			pendingRenderFrame: null,
			contentEl: {
				ownerDocument: {
					defaultView: {
						requestAnimationFrame: (callback: () => void) => {
							callback();
							return 1;
						},
					},
				},
			},
			renderMessageBody: vi.fn(),
			scrollMessagesToBottomIfFollowing,
		};

		viewPrototype.scheduleMessageRender.call(context, pendingMessage);

		expect(context.renderMessageBody).toHaveBeenCalledWith(pendingMessage);
		expect(scrollMessagesToBottomIfFollowing).toHaveBeenCalledOnce();
	});

	it('reapplies bottom alignment after asynchronous Markdown layout', async () => {
		vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue(undefined);
		const body = new FakeElement();
		Object.assign(body, {
			ownerDocument: { createElement: () => new FakeElement() },
		});
		const scrollMessagesToBottomIfFollowing = vi.fn();
		const context = {
			closed: false,
			messageBodyEls: new Map<string, HTMLElement>([['answer', body as unknown as HTMLElement]]),
			scrollMessagesToBottomIfFollowing,
			settleMarkdownRender: (generation: number) =>
				viewPrototype.settleMarkdownRender.call(context, generation),
		};

		viewPrototype.renderMessageBody.call(context, message('answer', 'Note.md'));
		await vi.waitFor(() => expect(scrollMessagesToBottomIfFollowing).toHaveBeenCalledOnce());
	});

	it('sets the completed response target after following the loading render at bottom', async () => {
		const followStates: boolean[] = [];
		const renderTargetStates: Array<string | null> = [];
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'off' as const,
			messages: [] as ChatMessage[],
			followLatestMessages: false,
			responseStartMessageId: 'previous-response' as string | null,
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(async ({ callbacks }: {
					callbacks: { onContent(text: string): void };
				}) => {
					callbacks.onContent('Answer');
					return { content: 'Answer', reasoning: '' };
				}),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(() => {
				saveCount++;
				return saveCount === 1 ? Promise.resolve() : persistence.promise;
			}),
			render: vi.fn(() => {
				followStates.push(context.followLatestMessages);
				renderTargetStates.push(context.responseStartMessageId);
			}),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};
		const persistence = deferred<void>();
		let saveCount = 0;

		const submission = viewPrototype.submitPrompt.call(context);
		await vi.waitFor(() => expect(saveCount).toBe(2));
		expect(context.responseStartMessageId).toBeNull();
		expect(context.followLatestMessages).toBe(true);
		persistence.resolve();
		await submission;

		expect(context.responseStartMessageId).toBe(context.messages[1]?.id);
		expect(followStates).toEqual([true, false]);
		expect(renderTargetStates).toEqual([null, context.messages[1]?.id]);
	});

	it('aligns the targeted response after Markdown layouts and clears the target', () => {
		const messagesEl = renderForFooter(message('answer', 'Note.md'));
		const responseEl = messagesEl.children[0];
		if (!responseEl) {
			throw new Error('Response element missing.');
		}
		Object.assign(messagesEl, {
			scrollTop: 40,
			getBoundingClientRect: () => ({ top: 100 }),
			querySelector: () => findElements(
				messagesEl,
				(element) => element.attributes['data-message-id'] === 'answer',
			)[0] ?? null,
		});
		Object.assign(responseEl, {
			getBoundingClientRect: () => ({ top: 260 }),
		});
		const context = {
			closed: false,
			renderGeneration: 4,
			pendingMarkdownRenders: 0,
			pendingScrollRestore: { previousScrollTop: 275, wasFollowing: false },
			responseStartMessageId: 'answer' as string | null,
			followLatestMessages: false,
			messagesEl,
			restoreMessageScroll: (previousScrollTop: number, wasFollowing: boolean) =>
				viewPrototype.restoreMessageScroll.call(context, previousScrollTop, wasFollowing),
		};

		viewPrototype.settleMarkdownRender.call(context, 4);

		expect(messagesEl.scrollTop).toBe(200);
		expect(context.responseStartMessageId).toBeNull();
	});
});


describe('EmendChatView completion relayout and unread pages', () => {
	it('restores upward-reading position only after all current Markdown layouts settle', async () => {
		const firstRender = deferred<void>();
		const secondRender = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render')
			.mockImplementationOnce(() => firstRender.promise)
			.mockImplementationOnce(() => secondRender.promise);
		const messagesEl = new FakeElement();
		messagesEl.scrollHeight = 1200;
		const context = {
			closed: false,
			renderGeneration: 1,
			pendingMarkdownRenders: 0,
			pendingScrollRestore: { previousScrollTop: 275, wasFollowing: false },
			messagesEl,
			messageBodyEls: new Map<string, HTMLElement>(),
			scrollMessagesToBottomIfFollowing: vi.fn(),
			settleMarkdownRender: (generation: number) =>
				viewPrototype.settleMarkdownRender.call(context, generation),
			restoreMessageScroll: (previousScrollTop: number, wasFollowing: boolean) =>
				viewPrototype.restoreMessageScroll.call(context, previousScrollTop, wasFollowing),
		};
		for (const id of ['first', 'second']) {
			const body = new FakeElement();
			Object.assign(body, {
				ownerDocument: { createElement: () => new FakeElement() },
			});
			context.messageBodyEls.set(id, body as unknown as HTMLElement);
		}

		viewPrototype.renderMessageBody.call(context, message('first', 'Note.md'));
		viewPrototype.renderMessageBody.call(context, message('second', 'Note.md'));
		expect(context.pendingMarkdownRenders).toBe(2);

		firstRender.resolve();
		await vi.waitFor(() => expect(context.pendingMarkdownRenders).toBe(1));
		expect(messagesEl.scrollTop).toBe(0);
		secondRender.resolve();
		await vi.waitFor(() => expect(messagesEl.scrollTop).toBe(275));
	});

	it('does not warn about a page that later fetched successfully', () => {
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/page', status: 'failed' },
			{ type: 'fetch', target: 'https://example.test/page', status: 'completed' },
		])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/other', status: 'failed' },
		])).toBe(1);
	});

	it('excludes extraction failures from lone and mixed unread-page counts', () => {
		const extractionFailure = {
			type: 'fetch' as const,
			target: 'https://example.test/extraction-failed',
			status: 'failed' as const,
			failureKind: 'extraction' as const,
		};
		expect(getUnreadPageCount([extractionFailure])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/unread', status: 'failed' },
			extractionFailure,
		])).toBe(1);
	});

	it('excludes extraction failures that carry a reader reason from unread-page counts', () => {
		expect(getUnreadPageCount([{
			type: 'fetch',
			target: 'https://example.test/extraction-failed',
			status: 'failed',
			failureKind: 'extraction',
			failureReason: 'reader',
		}])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/unread', status: 'failed', failureReason: 'network' },
			{
				type: 'fetch',
				target: 'https://example.test/extraction-failed',
				status: 'failed',
				failureKind: 'extraction',
				failureReason: 'reader',
			},
		])).toBe(1);
	});
});


describe('EmendChatView compact Web disclosure', () => {
	it('keeps the shared disclosure on the Web selector tooltip without requests or a large bottom block', async () => {
		const contentEl = new FakeElement();
		const requestChatCompletion = vi.fn();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => 'Note.md',
				getActiveNoteLabel: () => 'Note.md',
				hasUsableSelection: () => false,
				conversationStore: { load: vi.fn(async () => []) },
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
				settings: {
					activeProvider: 'deepseek',
					providers: { deepseek: { name: 'DeepSeek', model: 'deepseek-flash' } },
				},
			},
			notePath: null as string | null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			webSearchMode: 'auto' as const,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, string>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);

		await viewPrototype.refreshTargetNote.call(context);

		const disclosure = findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-web-disclosure')
		);
		const webSelect = findElements(contentEl, (element) =>
			element.tagName === 'select' && element.attributes['aria-label'] === 'Web search mode'
		)[0];
		expect(disclosure).toHaveLength(0);
		expect(webSelect?.title).toContain('note context');
		expect(webSelect?.title).toContain('stored locally with ready chats');
		expect(webSelect?.title).toContain('Each web call uses an AI extraction reader that receives your current question and extraction goal, may use up to 6 extractor rounds, a verifier, and up to 2 refine rounds, and may incur separate charges. A transient Search or Fetch failure may be retried once. Failed calls also count toward the configured call limit.');
		if (webSelect) {
			webSelect.value = 'review';
			webSelect.dispatch('change');
			webSelect.value = 'auto';
			webSelect.dispatch('change');
		}
		expect(requestChatCompletion).not.toHaveBeenCalled();
	});
});


describe('Emend Web review modal styles', () => {
	it('styles the extraction disclosure as muted smaller text with a modest top margin', () => {
		const rule = getCssRule('.emend-web-review-disclosure');

		expect(rule).toContain('color: var(--text-muted);');
		expect(rule).toContain('font-size: var(--font-ui-smaller);');
		expect(rule).toContain('margin-top: 4px;');
	});
});


describe('EmendChatView render-end response alignment', () => {
	it('keeps the response target until actual Markdown settlement expands the scroller', async () => {
		const markdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(markdown.promise);
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => 'Note.md',
				getActiveNoteLabel: () => 'Note.md',
				hasUsableSelection: () => false,
				conversationStore: {
					load: vi.fn(async () => {
						context.responseStartMessageId = 'answer';
						context.followLatestMessages = false;
						return [message('answer', 'Note.md')];
					}),
				},
				additionalNotesStore: new AdditionalNotesStore(),
				settings: {
					activeProvider: 'deepseek',
					providers: { deepseek: { name: 'DeepSeek', model: 'deepseek-flash' } },
				},
			},
			notePath: null as string | null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			webSearchMode: 'off' as const,
			responseStartMessageId: null as string | null,
			followLatestMessages: true,
			pendingMarkdownRenders: 0,
			renderGeneration: 0,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, string>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);

		await viewPrototype.refreshTargetNote.call(context);

		expect(context.pendingMarkdownRenders).toBe(1);
		expect(context.responseStartMessageId).toBe('answer');
		const messagesEl = (context as unknown as { messagesEl: FakeElement }).messagesEl;
		const responseEl = messagesEl.children[0];
		if (!responseEl) throw new Error('Response element missing');
		Object.assign(messagesEl, {
			scrollTop: 40,
			scrollHeight: 4856,
			clientHeight: 197,
			getBoundingClientRect: () => ({ top: 100 }),
			querySelector: () => responseEl,
		});
		Object.assign(responseEl, {
			getBoundingClientRect: () => ({ top: 260 }),
		});

		markdown.resolve();
		await vi.waitFor(() => expect(context.pendingMarkdownRenders).toBe(0));

		expect(messagesEl.scrollTop).toBe(200);
		expect(context.responseStartMessageId).toBeNull();
	});
});
