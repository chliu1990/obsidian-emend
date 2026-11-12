import { Modal } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionControls } from '../src/chat-session-controls';
import type { ChatSession } from '../src/chat-sessions';

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<(event?: unknown) => void>>();
	className = '';
	textContent = '';
	title = '';
	value = '';
	disabled = false;
	removed = false;

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }) {
		return this.append('span', options);
	}

	createEl(
		tagName: string,
		options?: { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		return this.append(tagName, options);
	}

	addClass(className: string) {
		this.className = `${this.className} ${className}`.trim();
	}

	addEventListener(type: string, listener: (event?: unknown) => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, event?: unknown) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	click() {
		this.dispatch('click');
	}

	press(key: 'Enter' | ' ') {
		if (this.tagName !== 'button') {
			throw new Error('Only native buttons provide this keyboard activation.');
		}
		if (key === 'Enter' || key === ' ') {
			this.click();
		}
	}

	focus() {}

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
			if (tagName === 'option') {
				child.value = options?.attr?.value ?? child.textContent;
			}
		}
		this.children.push(child);
		return child;
	}
}

function session(id: string, title = id): ChatSession {
	return {
		id,
		title,
		titleSource: 'auto',
		createdAt: 1,
		updatedAt: 1,
		messages: [],
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

function findButton(root: FakeElement, label: string) {
	const button = findElements(
		root,
		(element) => element.tagName === 'button' && element.attributes['aria-label'] === label,
	)[0];
	if (!button) {
		throw new Error(`Missing button: ${label}`);
	}
	return button;
}

function findModalButton(root: FakeElement, text: string) {
	const button = findElements(
		root,
		(element) => element.tagName === 'button' && element.textContent === text,
	)[0];
	if (!button) {
		throw new Error(`Missing modal button: ${text}`);
	}
	return button;
}

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

interface OpenModal {
	contentEl: FakeElement;
	title: string;
	wasClosed: boolean;
	closeCalls: number;
	onOpen(): void;
	onClose(): void;
}

const openedModals: OpenModal[] = [];

function callbacks() {
	return {
		onNew: vi.fn<() => void>(),
		onSwitch: vi.fn<(sessionId: string) => void>(),
		onRename: vi.fn<(title: string) => void>(),
		onDelete: vi.fn<() => void>(),
	};
}

function renderControls(
	sessions: ChatSession[] = [session('a', 'Alpha'), session('b', 'Beta'), session('c', 'Gamma')],
	activeSessionId: string | null = 'b',
	disabled = false,
) {
	const container = new FakeElement();
	const spies = callbacks();
	const controls = new ChatSessionControls(
		container as unknown as HTMLElement,
		spies,
	);
	controls.render({ sessions, activeSessionId, disabled });
	return { container, controls, spies };
}

function openLatestModal() {
	const modal = openedModals.at(-1);
	if (!modal) {
		throw new Error('No modal opened.');
	}
	return modal;
}

beforeEach(() => {
	openedModals.length = 0;
	vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
		const modal = this as unknown as OpenModal;
		modal.contentEl = new FakeElement();
		modal.title = '';
		modal.wasClosed = false;
		modal.closeCalls = 0;
		Object.assign(modal, {
			setTitle: (title: string) => {
				modal.title = title;
			},
		});
		openedModals.push(modal);
		modal.onOpen();
	});
	vi.spyOn(Modal.prototype, 'close').mockImplementation(function (this: Modal) {
		const modal = this as unknown as OpenModal;
		modal.wasClosed = true;
		modal.closeCalls++;
		modal.onClose();
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ChatSessionControls', () => {
	it('shows manual order and only New, Rename, and Delete actions in the native controls', () => {
		const { container } = renderControls();
		const select = findElements(
			container,
			(element) => element.tagName === 'select' && element.attributes['aria-label'] === 'Chat session',
		)[0];

		expect(select?.children.map((option) => [option.value, option.textContent])).toEqual([
			['a', 'Alpha'],
			['b', 'Beta'],
			['c', 'Gamma'],
		]);
		expect(select?.value).toBe('b');
		const actionLabels = findElements(
			container,
			(element) => element.tagName === 'button',
		).map((button) => button.attributes['aria-label']);
		expect(actionLabels).toEqual([
			'New chat session',
			'Rename chat session',
			'Delete chat session',
		]);
		for (const label of actionLabels) {
			if (!label) {
				throw new Error('Session action has no accessible label.');
			}
			expect(findButton(container, label).attributes.type).toBe('button');
		}
		expect(actionLabels).not.toContain('Move chat session up');
		expect(actionLabels).not.toContain('Move chat session down');
	});

	it('emits exact switch IDs and New', () => {
		const { container, spies } = renderControls();
		const select = findElements(container, (element) => element.tagName === 'select')[0];
		if (!select) {
			throw new Error('Session select missing.');
		}
		select.value = 'c';
		select.dispatch('change');
		findButton(container, 'New chat session').click();

		expect(spies.onSwitch).toHaveBeenCalledExactlyOnceWith('c');
		expect(spies.onNew).toHaveBeenCalledOnce();
	});

	it('supports native keyboard activation for New', () => {
		const { container, spies } = renderControls();

		findButton(container, 'New chat session').press('Enter');

		expect(spies.onNew).toHaveBeenCalledOnce();
	});

	it('disables every remaining control globally', () => {
		const { container, controls } = renderControls();

		controls.render({ sessions: [session('a')], activeSessionId: 'a', disabled: true });
		for (const element of findElements(
			container,
			(candidate) => candidate.tagName === 'button' || candidate.tagName === 'select',
		)) {
			expect(element.disabled).toBe(true);
		}
	});

	it('normalizes a valid manual rename and rejects empty or over-length titles without emitting', () => {
		const { container, spies } = renderControls([session('a', 'Original')], 'a');
		findButton(container, 'Rename chat session').click();
		const modal = openLatestModal();
		const input = findElements(modal.contentEl, (element) => element.tagName === 'input')[0];
		if (!input) {
			throw new Error('Rename input missing.');
		}
		expect(input.value).toBe('Original');

		input.value = ' \n\t ';
		findModalButton(modal.contentEl, 'Rename').click();
		expect(spies.onRename).not.toHaveBeenCalled();
		expect(modal.wasClosed).toBe(false);
		expect(textOf(modal.contentEl)).toContain('must not be empty');

		input.value = '😀'.repeat(81);
		findModalButton(modal.contentEl, 'Rename').click();
		expect(spies.onRename).not.toHaveBeenCalled();
		expect(modal.wasClosed).toBe(false);
		expect(textOf(modal.contentEl)).toContain('at most 80');

		input.value = '  Manual\n   title  ';
		findModalButton(modal.contentEl, 'Rename').click();
		expect(spies.onRename).toHaveBeenCalledExactlyOnceWith('Manual title');
		expect(modal.wasClosed).toBe(true);
	});

	it('keeps rename cancellation local and emits no title', () => {
		const { container, spies } = renderControls([session('a')], 'a');
		findButton(container, 'Rename chat session').click();
		const modal = openLatestModal();

		findModalButton(modal.contentEl, 'Cancel').click();

		expect(modal.wasClosed).toBe(true);
		expect(spies.onRename).not.toHaveBeenCalled();
	});

	it('requires delete confirmation, names the session as plain text, and honors cancel', () => {
		const { container, spies } = renderControls([session('a', '<b>Manual title</b>')], 'a');
		findButton(container, 'Delete chat session').click();
		const cancelled = openLatestModal();
		expect(textOf(cancelled.contentEl)).toContain('<b>Manual title</b>');
		findModalButton(cancelled.contentEl, 'Cancel').click();
		expect(spies.onDelete).not.toHaveBeenCalled();

		findButton(container, 'Delete chat session').click();
		const confirmed = openLatestModal();
		findModalButton(confirmed.contentEl, 'Delete').click();
		expect(spies.onDelete).toHaveBeenCalledOnce();
		expect(confirmed.wasClosed).toBe(true);
	});

	it('closes confirmation once before a callback destroys the controls', () => {
		const { container, controls, spies } = renderControls([session('a')], 'a');
		spies.onDelete.mockImplementation(() => controls.destroy());
		findButton(container, 'Delete chat session').click();
		const modal = openLatestModal();

		findModalButton(modal.contentEl, 'Delete').click();

		expect(spies.onDelete).toHaveBeenCalledOnce();
		expect(modal.closeCalls).toBe(1);
	});

	it('cleans up its row and closes an owned modal on destroy', () => {
		const { container, controls } = renderControls([session('a')], 'a');
		findButton(container, 'Delete chat session').click();
		const modal = openLatestModal();

		const row = container.children[0];
		controls.destroy();

		expect(row?.removed).toBe(true);
		expect(row?.children).toEqual([]);
		expect(modal.wasClosed).toBe(true);
	});
});
