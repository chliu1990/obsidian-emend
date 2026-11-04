import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import { AdditionalNotesControl, AdditionalNotesPicker } from '../src/additional-notes-ui';

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

function findButton(root: FakeElement, text: string) {
	return findElements(
		root,
		(element) => element.tagName === 'button' && element.textContent === text,
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

function createControl(targetPath = 'Active.md') {
	const getMarkdownFiles = vi.fn(() => [
		file('Active.md'),
		file('Already selected.md'),
		file('First.md'),
		file('Folder/Second.md'),
	]);
	const app = new App();
	Object.assign(app, { vault: { getMarkdownFiles } });
	const store = new AdditionalNotesStore();
	const container = new FakeElement();
	const control = new AdditionalNotesControl(app, store, () => targetPath);
	return { app, store, container, control, getMarkdownFiles };
}

type MockPicker = AdditionalNotesPicker & {
	items: TFile[];
	opened: boolean;
};

function fuzzyModalInstances(): MockPicker[] {
	return (FuzzySuggestModal as unknown as { instances: MockPicker[] }).instances;
}

describe('AdditionalNotesControl', () => {
	beforeEach(() => {
		fuzzyModalInstances().length = 0;
	});

	it('discovers files only after Add notes is clicked and filters unavailable paths', () => {
		const { store, container, control, getMarkdownFiles } = createControl();
		store.add('Active.md', 'Already selected.md');

		control.render(container as unknown as HTMLElement, false);

		expect(getMarkdownFiles).not.toHaveBeenCalled();
		expect(fuzzyModalInstances()).toHaveLength(0);
		findButton(container, 'Add notes')?.click();

		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		const picker = fuzzyModalInstances()[0];
		expect(picker).toBeDefined();
		expect(picker?.opened).toBe(true);
		expect(picker?.items.map((item) => item.path)).toEqual([
			'First.md',
			'Folder/Second.md',
		]);
		const firstItem = picker?.items[0];
		if (!picker || !firstItem) {
			throw new Error('Picker did not offer the expected note.');
		}
		expect(picker.getItemText(firstItem)).toBe('First.md');

		picker.onChooseItem(firstItem);

		expect(store.list('Active.md')).toEqual([
			'Already selected.md',
			'First.md',
		]);
		expect(textOf(container)).toContain('First.md');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
	});

	it('shows local paths, empty copy, and next-request disclosure through every store update', () => {
		const { store, container, control, getMarkdownFiles } = createControl();
		control.render(container as unknown as HTMLElement, false);

		expect(textOf(container)).toContain('No additional notes selected.');
		expect(textOf(container)).toContain(
			'Selected note content is sent with your next request.',
		);

		store.add('Active.md', 'Private/Local path.md');
		expect(textOf(container)).toContain('Private/Local path.md');
		expect(textOf(container)).not.toContain('No additional notes selected.');

		store.rename('Private/Local path.md', 'Private/Renamed.md');
		expect(textOf(container)).toContain('Private/Renamed.md');
		expect(textOf(container)).not.toContain('Private/Local path.md');

		store.removeDeleted('Private/Renamed.md');
		expect(textOf(container)).toContain('No additional notes selected.');

		store.add('Active.md', 'One.md');
		store.add('Active.md', 'Two.md');
		const removeOne = findElements(
			container,
			(element) => element.attributes['aria-label'] === 'Remove One.md',
		)[0];
		expect(removeOne).toBeDefined();
		removeOne?.click();
		expect(store.list('Active.md')).toEqual(['Two.md']);
		expect(textOf(container)).not.toContain('One.md');
		expect(textOf(container)).toContain('Two.md');

		findButton(container, 'Clear all')?.click();
		expect(store.list('Active.md')).toEqual([]);
		expect(textOf(container)).toContain('No additional notes selected.');
		expect(getMarkdownFiles).not.toHaveBeenCalled();
	});

	it('disables every control and removes its subscription on destroy', () => {
		const { store, container, control } = createControl();
		store.add('Active.md', 'One.md');
		control.render(container as unknown as HTMLElement, false);
		const buttons = findElements(
			container,
			(element) => element.tagName === 'button',
		);
		expect(buttons.length).toBeGreaterThanOrEqual(3);

		control.setDisabled(true);
		expect(buttons.every((button) => button.disabled)).toBe(true);
		control.setDisabled(false);
		expect(buttons.every((button) => !button.disabled)).toBe(true);

		control.destroy();
		store.rename('One.md', 'Renamed.md');
		expect(textOf(container)).toContain('One.md');
		expect(textOf(container)).not.toContain('Renamed.md');
	});
});
