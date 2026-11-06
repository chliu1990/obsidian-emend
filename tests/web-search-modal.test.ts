import { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { WebSearchModal } from '../src/web-search-modal';
import type { WebToolCall } from '../src/web-search';

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<() => void>>();
	className = '';
	textContent = '';
	value = '';
	disabled = false;

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }) {
		return this.append('span', options);
	}

	createEl(tagName: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
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
		for (const listener of this.listeners.get('click') ?? []) listener();
	}

	empty() {
		this.children.length = 0;
	}

	private append(tagName: string, options?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
		const child = new FakeElement(tagName);
		if (typeof options === 'string') child.className = options;
		else {
			child.className = options?.cls ?? '';
			child.textContent = options?.text ?? '';
			Object.assign(child.attributes, options?.attr);
		}
		this.children.push(child);
		return child;
	}
}

function findElements(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
	return [
		...(predicate(root) ? [root] : []),
		...root.children.flatMap((child) => findElements(child, predicate)),
	];
}

function openModal(calls: WebToolCall[] = [{ id: 'call-1', name: 'web_search', query: 'original' }]) {
	const resolve = vi.fn();
	const reject = vi.fn();
	const cancel = vi.fn();
	const contentEl = new FakeElement();
	const modal = new WebSearchModal(new App(), calls, resolve, reject, cancel);
	const close = vi.fn(() => modal.onClose());
	Object.assign(modal, {
		contentEl,
		setTitle: vi.fn(),
		close,
	});
	modal.onOpen();
	return { modal, resolve, reject, cancel, contentEl, close };
}

describe('WebSearchModal', () => {
	it('returns edited calls with their original IDs and tool names', () => {
		const { resolve, contentEl } = openModal();
		const input = findElements(contentEl, (element) => element.tagName === 'input')[0];
		if (!input) throw new Error('Review input missing');
		input.value = 'edited query';

		findElements(contentEl, (element) => element.textContent === 'Run web calls')[0]?.click();

		expect(resolve).toHaveBeenCalledWith([{ id: 'call-1', name: 'web_search', query: 'edited query' }]);
	});

	it('keeps the dialog open when an edited argument is invalid', () => {
		const { resolve, contentEl, close } = openModal();
		const input = findElements(contentEl, (element) => element.tagName === 'input')[0];
		if (!input) throw new Error('Review input missing');
		input.value = ' ';

		findElements(contentEl, (element) => element.textContent === 'Run web calls')[0]?.click();

		expect(resolve).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(findElements(contentEl, (element) => element.className === 'emend-web-review-error')[0]?.textContent).toContain('1 to 128');
	});

	it('cancels the active request when closed without approval', () => {
		const { resolve, reject, cancel, contentEl } = openModal();

		findElements(contentEl, (element) => element.textContent === 'Cancel')[0]?.click();

		expect(cancel).toHaveBeenCalledOnce();
		expect(reject).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
		expect(resolve).not.toHaveBeenCalled();
	});
});
