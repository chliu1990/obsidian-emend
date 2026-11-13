import { Menu, MenuItem } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ChatComposerControls,
	type ComposerPermissionCallbacks,
	type ComposerPermissionState,
} from '../src/chat-composer-controls';

const DISCLOSURE = 'DeepSeek may generate search queries and fetch URLs from note context. Review asks before each batch; Auto runs directly. Successful search/fetch calls may be billed separately. Queries, URLs, and outcomes are stored locally with ready chats. Each web call uses an AI extraction reader that receives your current question and extraction goal, may use up to 6 extractor rounds, a verifier, and up to 2 refine rounds, and may incur separate charges. A transient Search or Fetch failure may be retried once. Failed calls also count toward the configured call limit.';

type TestMenuItem = MenuItem & {
	title: string;
	checked: boolean | null;
	disabled: boolean;
	clickHandler: (event: MouseEvent | KeyboardEvent) => unknown;
};

type TestMenu = Menu & {
	items: Array<TestMenuItem | 'separator'>;
	position: { x: number; y: number } | null;
	shownDocument: Document | undefined;
	hideCalls: number;
};

const TestMenu = Menu as unknown as { instances: TestMenu[] };

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<() => void>>();
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	focused = false;
	removed = false;

	constructor(
		readonly tagName = 'div',
		readonly ownerDocument: Document = {} as Document,
	) {}

	get lastElementChild(): FakeElement | null {
		return this.children.at(-1) ?? null;
	}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createEl(
		tagName: string,
		options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		return this.append(tagName, options);
	}

	insertBefore(child: FakeElement, reference: FakeElement | null) {
		const existingIndex = this.children.indexOf(child);
		if (existingIndex >= 0) {
			this.children.splice(existingIndex, 1);
		}
		const referenceIndex = reference ? this.children.indexOf(reference) : -1;
		if (referenceIndex >= 0) {
			this.children.splice(referenceIndex, 0, child);
		} else {
			this.children.push(child);
		}
		return child;
	}

	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	click() {
		if (this.disabled) {
			return;
		}
		for (const listener of this.listeners.get('click') ?? []) {
			listener();
		}
	}

	focus() {
		this.focused = true;
	}

	getBoundingClientRect() {
		return {
			x: 12,
			y: 34,
			left: 12,
			top: 34,
			right: 112,
			bottom: 64,
			width: 100,
			height: 30,
			toJSON: () => ({}),
		} as DOMRect;
	}

	remove() {
		this.removed = true;
	}

	empty() {
		this.children.length = 0;
		this.textContent = '';
	}

	private append(
		tagName: string,
		options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		const child = new FakeElement(tagName, this.ownerDocument);
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

function composerState(
	overrides: Partial<ComposerPermissionState> = {},
): ComposerPermissionState {
	return {
		mode: 'ask',
		editTarget: 'full-note',
		webSearchMode: 'off',
		disabled: false,
		sendDisabled: false,
		isSending: false,
		isStopping: false,
		...overrides,
	};
}

function composerCallbacks() {
	return {
		onWritingChoice: vi.fn(),
		onWebSearchMode: vi.fn(),
		onSend: vi.fn(),
		onStop: vi.fn(),
	} satisfies ComposerPermissionCallbacks;
}

function renderControls(overrides: Partial<ComposerPermissionState> = {}) {
	const ownerDocument = { name: 'popout-document' } as unknown as Document;
	const container = new FakeElement('div', ownerDocument);
	const modelLabel = container.createDiv({
		cls: 'emend-chat-active-model',
		text: 'DeepSeek / deepseek-flash',
	});
	const callbacks = composerCallbacks();
	const controls = new ChatComposerControls(callbacks);
	controls.render(container as unknown as HTMLElement, composerState(overrides));
	const trigger = container.children[0];
	const submission = container.children[2];
	if (!trigger || !submission) {
		throw new Error('Composer controls were not rendered around the model label.');
	}
	return { container, modelLabel, trigger, submission, callbacks, controls, ownerDocument };
}

function openMenu(trigger: FakeElement): TestMenu {
	trigger.click();
	const menu = TestMenu.instances.at(-1);
	if (!menu) {
		throw new Error('The writing trigger did not open a menu.');
	}
	return menu;
}

function menuItems(menu: TestMenu): TestMenuItem[] {
	return menu.items.filter((item): item is TestMenuItem => item instanceof MenuItem);
}

function menuItem(menu: TestMenu, title: string): TestMenuItem {
	const item = menuItems(menu).find((candidate) => candidate.title === title);
	if (!item) {
		throw new Error(`Missing menu item: ${title}`);
	}
	return item;
}

function choose(item: TestMenuItem) {
	item.clickHandler({} as MouseEvent);
}

beforeEach(() => {
	TestMenu.instances.length = 0;
});

describe('ChatComposerControls', () => {
	it.each([
		[{ mode: 'ask', webSearchMode: 'off' }, 'Chat'],
		[{ mode: 'ask', webSearchMode: 'review' }, 'Chat · Review search'],
		[{ mode: 'ask', webSearchMode: 'auto' }, 'Chat · Auto search'],
		[{ mode: 'edit', editTarget: 'selection' }, 'Edit · Selection'],
		[{ mode: 'edit', editTarget: 'full-note' }, 'Edit · Full note'],
	] as const)('shows the exact writing summary for %o', (overrides, summary) => {
		const { container, modelLabel, trigger, submission } = renderControls(overrides);

		expect(trigger.textContent).toBe(summary);
		expect(trigger.title).toBe(DISCLOSURE);
		expect(trigger.attributes.type).toBe('button');
		expect(trigger.attributes['aria-label']).toContain(summary);
		expect(container.children).toEqual([trigger, modelLabel, submission]);
		expect(modelLabel.textContent).toBe('DeepSeek / deepseek-flash');
		expect(submission.textContent).toBe('');
	});

	it.each([
		['Chat', { mode: 'ask' }],
		['Edit · Selection', { mode: 'edit', editTarget: 'selection' }],
		['Edit · Full note', { mode: 'edit', editTarget: 'full-note' }],
	] as const)('emits one writing choice from %s', (title, choice) => {
		const { trigger, callbacks } = renderControls();
		const menu = openMenu(trigger);

		choose(menuItem(menu, title));

		expect(callbacks.onWritingChoice).toHaveBeenCalledExactlyOnceWith(choice);
		expect(callbacks.onWebSearchMode).not.toHaveBeenCalled();
	});

	it.each([
		['off', 'Web Off'],
		['review', 'Web Review'],
		['auto', 'Web Auto'],
	] as const)('checks and emits Web %s', (webSearchMode, selectedTitle) => {
		const { trigger, callbacks } = renderControls({ webSearchMode });
		const menu = openMenu(trigger);

		expect(menu.items.filter((item) => item === 'separator')).toHaveLength(1);
		expect(menuItems(menu).map((item) => [item.title, item.checked])).toEqual([
			['Chat', true],
			['Edit · Selection', false],
			['Edit · Full note', false],
			['Web Off', webSearchMode === 'off'],
			['Web Review', webSearchMode === 'review'],
			['Web Auto', webSearchMode === 'auto'],
		]);
		choose(menuItem(menu, selectedTitle));
		expect(callbacks.onWebSearchMode).toHaveBeenCalledExactlyOnceWith(webSearchMode);
	});

	it('displays checked disabled Web Off in Edit without erasing the maintained choice', () => {
		const { trigger, callbacks } = renderControls({
			mode: 'edit',
			editTarget: 'selection',
			webSearchMode: 'review',
		});
		const menu = openMenu(trigger);

		for (const title of ['Web Off', 'Web Review', 'Web Auto']) {
			const item = menuItem(menu, title);
			expect(item.checked).toBe(title === 'Web Off');
			expect(item.disabled).toBe(true);
			choose(item);
		}
		expect(callbacks.onWebSearchMode).not.toHaveBeenCalled();
	});

	it('updates an open menu and preserves control and model DOM identity', () => {
		const rendered = renderControls({ webSearchMode: 'review' });
		const { container, modelLabel, trigger, submission, controls } = rendered;
		const menu = openMenu(trigger);
		const originalItems = menuItems(menu);

		controls.update(composerState({
			mode: 'edit',
			editTarget: 'selection',
			webSearchMode: 'review',
			disabled: true,
			isSending: true,
		}));

		expect(container.children).toEqual([trigger, modelLabel, submission]);
		expect(TestMenu.instances).toHaveLength(1);
		expect(menuItems(menu)).toEqual(originalItems);
		expect(trigger.textContent).toBe('Edit · Selection');
		expect(trigger.disabled).toBe(true);
		expect(menuItem(menu, 'Edit · Selection').checked).toBe(true);
		expect(menuItem(menu, 'Web Off').checked).toBe(true);
		expect(menuItems(menu).every((item) => item.disabled)).toBe(true);
		expect(submission.attributes['aria-label']).toBe('Stop');
		expect(submission.disabled).toBe(false);
		expect(modelLabel.textContent).toBe('DeepSeek / deepseek-flash');

		controls.update(composerState({ webSearchMode: 'auto' }));
		expect(menuItem(menu, 'Web Auto').checked).toBe(true);
		expect(menuItem(menu, 'Web Review').checked).toBe(false);
		expect(menuItems(menu).every((item) => !item.disabled)).toBe(true);
		expect(container.children).toEqual([trigger, modelLabel, submission]);
	});

	it('disables writing and Web while pending but keeps Stop available until Stopping', () => {
		const { trigger, submission, callbacks, controls } = renderControls({
			disabled: true,
		});

		expect(trigger.disabled).toBe(true);
		expect(submission.disabled).toBe(true);
		trigger.click();
		expect(TestMenu.instances).toHaveLength(0);

		controls.update(composerState({ disabled: true, isSending: true }));
		expect(trigger.disabled).toBe(true);
		expect(submission.disabled).toBe(false);
		expect(submission.attributes['aria-label']).toBe('Stop');
		expect(submission.title).toBe('Stop');
		submission.click();
		expect(callbacks.onStop).toHaveBeenCalledOnce();

		controls.update(composerState({
			disabled: true,
			isSending: true,
			isStopping: true,
		}));
		expect(submission.disabled).toBe(true);
		expect(submission.attributes['aria-label']).toBe('Stopping');
		expect(submission.title).toBe('Stopping');
		submission.click();
		expect(callbacks.onStop).toHaveBeenCalledOnce();
	});

	it('emits Send once and respects sendDisabled', () => {
		const { submission, callbacks, controls } = renderControls();

		expect(submission.attributes.type).toBe('button');
		expect(submission.attributes['aria-label']).toBe('Send');
		expect(submission.title).toBe('Send');
		submission.click();
		expect(callbacks.onSend).toHaveBeenCalledOnce();
		expect(callbacks.onStop).not.toHaveBeenCalled();

		controls.update(composerState({ sendDisabled: true }));
		expect(submission.disabled).toBe(true);
		submission.click();
		expect(callbacks.onSend).toHaveBeenCalledOnce();
	});

	it('positions the menu from the trigger rectangle in its owner document', () => {
		const { trigger, ownerDocument } = renderControls();

		const menu = openMenu(trigger);

		expect(menu.position).toEqual({ x: 12, y: 64 });
		expect(menu.shownDocument).toBe(ownerDocument);
	});

	it('ignores stale menu items and stale onHide callbacks', () => {
		const { trigger, callbacks } = renderControls();
		const staleMenu = openMenu(trigger);
		const currentMenu = openMenu(trigger);

		staleMenu.hide();
		choose(menuItem(staleMenu, 'Chat'));
		expect(callbacks.onWritingChoice).not.toHaveBeenCalled();

		choose(menuItem(currentMenu, 'Web Review'));
		expect(callbacks.onWebSearchMode).toHaveBeenCalledExactlyOnceWith('review');
	});

	it('destroys idempotently and rejects callbacks from its destroyed controls and menu', () => {
		const { trigger, submission, callbacks, controls } = renderControls();
		const menu = openMenu(trigger);
		const chatItem = menuItem(menu, 'Chat');

		controls.destroy();
		controls.destroy();

		expect(menu.hideCalls).toBe(1);
		choose(chatItem);
		trigger.click();
		submission.click();
		expect(callbacks.onWritingChoice).not.toHaveBeenCalled();
		expect(callbacks.onWebSearchMode).not.toHaveBeenCalled();
		expect(callbacks.onSend).not.toHaveBeenCalled();
		expect(callbacks.onStop).not.toHaveBeenCalled();
		expect(TestMenu.instances).toHaveLength(1);
	});
});
