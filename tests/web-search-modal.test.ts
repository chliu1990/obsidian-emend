import { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { WebSearchModal } from '../src/web-search-modal';
import type { WebToolCall } from '../src/web-search';

const EXTRACTION_DISCLOSURE = 'Each web call uses an AI extraction reader that receives your current question and extraction goal, may use up to 6 extractor rounds, a verifier, and up to 2 refine rounds, and may incur separate charges. A transient Search or Fetch failure may be retried once.';

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

function findInput(contentEl: FakeElement, callId: string, field: 'target' | 'extractionGoal') {
	const input = findElements(contentEl, (element) =>
		element.tagName === 'input' &&
		element.attributes['data-call-id'] === callId &&
		element.attributes['data-field'] === field
	)[0];
	if (!input) throw new Error(`Review ${field} input missing for ${callId}`);
	return input;
}

function openModal(calls: WebToolCall[] = [{
	id: 'call-1',
	name: 'web_search',
	query: 'original',
	extractionGoal: 'Find the original evidence.',
}]) {
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
	it('returns independently edited targets and goals with original IDs and tool names', () => {
		const { resolve, contentEl } = openModal([
			{ id: 'call-1', name: 'web_search', query: 'original', extractionGoal: 'Original search goal.' },
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/original', extractionGoal: 'Original fetch goal.' },
		]);
		findInput(contentEl, 'call-1', 'target').value = 'edited query';
		findInput(contentEl, 'call-1', 'extractionGoal').value = '  Edited search goal.  ';
		findInput(contentEl, 'call-2', 'target').value = 'https://example.test/edited';
		findInput(contentEl, 'call-2', 'extractionGoal').value = 'Edited fetch goal.';
		expect(findElements(contentEl, (element) => element.textContent === 'Extraction goal 1')).toHaveLength(1);
		expect(findElements(contentEl, (element) => element.textContent === 'Extraction goal 2')).toHaveLength(1);

		findElements(contentEl, (element) => element.textContent === 'Run web calls')[0]?.click();

		expect(resolve).toHaveBeenCalledWith([
			{ id: 'call-1', name: 'web_search', query: 'edited query', extractionGoal: 'Edited search goal.' },
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/edited', extractionGoal: 'Edited fetch goal.' },
		]);
	});

	it('keeps the dialog open when an edited target is invalid', () => {
		const { resolve, contentEl, close } = openModal();
		findInput(contentEl, 'call-1', 'target').value = ' ';

		findElements(contentEl, (element) => element.textContent === 'Run web calls')[0]?.click();

		expect(resolve).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(findElements(contentEl, (element) => element.className === 'emend-web-review-error')[0]?.textContent).toContain('1 to 128');
	});

	it('blocks Run with a visible error when an extraction goal is empty', () => {
		const { resolve, contentEl, close } = openModal();
		findInput(contentEl, 'call-1', 'extractionGoal').value = '  ';

		findElements(contentEl, (element) => element.textContent === 'Run web calls')[0]?.click();

		expect(resolve).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(findElements(contentEl, (element) => element.className === 'emend-web-review-error')[0]?.textContent).toContain('1 to 1000');
	});

	it('shows the shared AI reader disclosure', () => {
		const { contentEl } = openModal();

		expect(findElements(contentEl, (element) => element.textContent === EXTRACTION_DISCLOSURE)).toHaveLength(1);
	});

	it('cancels the active request when closed without approval', () => {
		const { resolve, reject, cancel, contentEl } = openModal();

		findElements(contentEl, (element) => element.textContent === 'Cancel')[0]?.click();

		expect(cancel).toHaveBeenCalledOnce();
		expect(reject).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
		expect(resolve).not.toHaveBeenCalled();
	});
});
