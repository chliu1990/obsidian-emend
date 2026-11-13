import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import { AdditionalNotesPicker } from '../src/additional-notes-ui';
import { RelatedNotesControl } from '../src/related-notes-control';

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<() => void>>();
	className = '';
	textContent = '';
	disabled = false;
	open = false;
	focused = false;

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

	focus() {
		this.focused = true;
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

function findByClass(root: FakeElement, className: string) {
	return findElements(
		root,
		(element) => element.className.split(' ').includes(className),
	)[0];
}

function findButton(root: FakeElement, label: string) {
	return findElements(
		root,
		(element) => element.tagName === 'button' && element.attributes['aria-label'] === label,
	)[0];
}

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

function file(path: string) {
	const note = new TFile();
	note.path = path;
	return note;
}

function createControl(initialTargetPath: string | null = 'Active.md') {
	let targetPath = initialTargetPath;
	const files = [
		file('Active.md'),
		file('Other.md'),
		file('Already selected.md'),
		file('First.md'),
		file('Folder/Second.md'),
	];
	const read = vi.fn();
	const adapterRead = vi.fn();
	const getMarkdownFiles = vi.fn(() => files);
	const getAbstractFileByPath = vi.fn((path: string) =>
		files.find((item) => item.path === path) ?? null
	);
	const app = new App();
	Object.assign(app, {
		vault: {
			read,
			adapter: { read: adapterRead },
			getMarkdownFiles,
			getAbstractFileByPath,
		},
	});
	const store = new AdditionalNotesStore();
	const container = new FakeElement();
	const control = new RelatedNotesControl(app, store, () => targetPath);
	return {
		store,
		container,
		control,
		read,
		adapterRead,
		getMarkdownFiles,
		getAbstractFileByPath,
		setTargetPath: (path: string | null) => {
			targetPath = path;
		},
	};
}

type MockPicker = AdditionalNotesPicker & {
	items: TFile[];
	opened: boolean;
};

function fuzzyModalInstances(): MockPicker[] {
	return (FuzzySuggestModal as unknown as { instances: MockPicker[] }).instances;
}

describe('RelatedNotesControl', () => {
	beforeEach(() => {
		fuzzyModalInstances().length = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('shows a count without an empty disclosure and preserves open details across updates', () => {
		const { store, container, control } = createControl();
		control.render(container as unknown as HTMLElement, false);
		const trigger = findButton(container, 'Related notes');

		expect(trigger).toBeDefined();
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('0');
		expect(findByClass(container, 'emend-chat-related-notes-details')).toBeUndefined();
		expect(textOf(container)).not.toContain('No additional notes selected.');
		expect(textOf(container)).not.toContain(
			'Selected note content is sent with your next request.',
		);

		store.add('Other.md', 'Other target only.md');
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('0');
		store.add('Active.md', 'First.md');
		store.add('Active.md', 'Folder/Second.md');

		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('2');
		const details = findByClass(container, 'emend-chat-related-notes-details');
		expect(details?.tagName).toBe('details');
		expect(details?.open).toBe(false);
		expect(textOf(details as FakeElement)).toContain('Selected notes');
		expect(textOf(details as FakeElement)).toContain('First.md');
		expect(textOf(details as FakeElement)).toContain('Folder/Second.md');
		expect(textOf(details as FakeElement)).toContain(
			'Selected note content is sent with your next request.',
		);
		expect(findButton(container, 'Remove First.md')).toBeDefined();
		expect(findButton(container, 'Remove Folder/Second.md')).toBeDefined();

		if (details) {
			details.open = true;
		}
		store.add('Active.md', 'Already selected.md');

		expect(findByClass(container, 'emend-chat-related-notes-details')?.open).toBe(true);
		expect(findButton(container, 'Related notes')).toBe(trigger);
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('3');
	});

	it('opens the existing picker for the current target and excludes active and selected paths', () => {
		const {
			store,
			container,
			control,
			getMarkdownFiles,
			getAbstractFileByPath,
		} = createControl();
		store.add('Active.md', 'Already selected.md');
		control.render(container as unknown as HTMLElement, false);

		expect(getMarkdownFiles).not.toHaveBeenCalled();
		findButton(container, 'Related notes')?.click();

		expect(getAbstractFileByPath).toHaveBeenCalledWith('Active.md');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		const picker = fuzzyModalInstances()[0];
		expect(picker?.opened).toBe(true);
		expect(picker?.items.map((item) => item.path)).toEqual([
			'Other.md',
			'First.md',
			'Folder/Second.md',
		]);
	});

	it('selects, removes, and clears only the current target without content reads or requests', () => {
		const {
			store,
			container,
			control,
			read,
			adapterRead,
		} = createControl();
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		store.add('Other.md', 'Keep for other.md');
		control.render(container as unknown as HTMLElement, false);

		findButton(container, 'Related notes')?.click();
		const picker = fuzzyModalInstances()[0];
		const first = picker?.items.find((item) => item.path === 'First.md');
		if (!picker || !first) {
			throw new Error('Expected First.md in the picker.');
		}
		picker.onChooseItem(first);
		expect(store.list('Active.md')).toEqual(['First.md']);

		findButton(container, 'Remove First.md')?.click();
		expect(store.list('Active.md')).toEqual([]);
		expect(store.list('Other.md')).toEqual(['Keep for other.md']);
		expect(findButton(container, 'Related notes')?.focused).toBe(true);

		store.add('Active.md', 'First.md');
		store.add('Active.md', 'Folder/Second.md');
		findButton(container, 'Clear all related notes')?.click();
		expect(store.list('Active.md')).toEqual([]);
		expect(store.list('Other.md')).toEqual(['Keep for other.md']);
		expect(read).not.toHaveBeenCalled();
		expect(adapterRead).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('disables all actions while pending or without a target', () => {
		const { store, container, control, setTargetPath } = createControl(null);
		control.render(container as unknown as HTMLElement, false);
		expect(findButton(container, 'Related notes')?.disabled).toBe(true);

		setTargetPath('Active.md');
		control.setDisabled(false);
		expect(findButton(container, 'Related notes')?.disabled).toBe(false);
		store.add('Active.md', 'First.md');
		control.setDisabled(true);

		const buttons = findElements(container, (element) => element.tagName === 'button');
		expect(buttons.length).toBeGreaterThanOrEqual(3);
		expect(buttons.every((button) => button.disabled)).toBe(true);
		findButton(container, 'Related notes')?.click();
		findButton(container, 'Remove First.md')?.click();
		findButton(container, 'Clear all related notes')?.click();
		expect(fuzzyModalInstances()).toHaveLength(0);
		expect(store.list('Active.md')).toEqual(['First.md']);

		setTargetPath(null);
		control.setDisabled(false);
		expect(buttons.every((button) => button.disabled)).toBe(true);
	});

	it('closes its picker and unsubscribes on destroy', () => {
		const { store, container, control } = createControl();
		control.render(container as unknown as HTMLElement, false);
		findButton(container, 'Related notes')?.click();
		const picker = fuzzyModalInstances()[0];
		store.add('Active.md', 'First.md');
		expect(textOf(container)).toContain('First.md');

		control.destroy();
		expect(picker?.opened).toBe(false);
		store.add('Active.md', 'Folder/Second.md');
		expect(textOf(container)).not.toContain('Folder/Second.md');
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('1');
	});
});
