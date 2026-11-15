import { App, FuzzySuggestModal, setIcon, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import { AdditionalNotesControl } from '../src/additional-notes-ui';
import { RelatedNotesControl } from '../src/related-notes-control';

interface FakeEvent {
	type: string;
	target: FakeElement;
	key: string;
	defaultPrevented: boolean;
	propagationStopped: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

type FakeListener = (event: FakeEvent) => void;

class FakeDocument {
	readonly body: FakeElement;
	readonly defaultView = { innerWidth: 800, innerHeight: 600 };
	readonly listeners = new Map<string, FakeListener[]>();
	activeElement: FakeElement | null = null;

	constructor() {
		this.body = new FakeElement('body', this);
	}

	createElement(tagName: string): FakeElement {
		return new FakeElement(tagName, this);
	}

	addEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? [];
		this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
	}

	dispatch(type: string, target: FakeElement, key = ''): FakeEvent {
		const event = makeEvent(type, target, key);
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(event);
		}
		return event;
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.length ?? 0;
	}
}

function makeEvent(type: string, target: FakeElement, key = ''): FakeEvent {
	return {
		type,
		target,
		key,
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			this.propagationStopped = true;
		},
	};
}

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, FakeListener[]>();
	readonly style: Record<string, string> = {};
	parentElement: FakeElement | null = null;
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	value = '';
	checked = false;
	indeterminate = false;
	open = false;
	hidden = false;
	focused = false;
	removed = false;
	isConnected = true;
	scrollIntoViewCalls = 0;
	rectangle = { left: 20, top: 30, bottom: 60, right: 220, width: 200, height: 30 };

	constructor(
		readonly tagName = 'div',
		readonly ownerDocument: FakeDocument = new FakeDocument(),
	) {}

	createDiv(options?: string | { cls?: string; text?: string }): FakeElement {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }): FakeElement {
		return this.append('span', options);
	}

	createEl(
		tagName: string,
		options?: {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	): FakeElement {
		return this.append(tagName, options);
	}

	addEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? [];
		this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
	}

	dispatch(type: string, key = ''): FakeEvent {
		const event = makeEvent(type, this, key);
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(event);
		}
		return event;
	}

	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
	}

	click(): void {
		if (this.disabled) {
			return;
		}
		if (this.tagName === 'input' && this.attributes.type === 'checkbox') {
			this.checked = !this.checked;
			this.dispatch('change');
			return;
		}
		this.dispatch('click');
	}

	focus(): void {
		this.ownerDocument.activeElement?.blur();
		this.focused = true;
		this.ownerDocument.activeElement = this;
	}

	blur(): void {
		this.focused = false;
		if (this.ownerDocument.activeElement === this) {
			this.ownerDocument.activeElement = null;
		}
	}

	empty(): void {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children.length = 0;
		this.textContent = '';
	}

	remove(): void {
		if (this.parentElement) {
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) {
				this.parentElement.children.splice(index, 1);
			}
		}
		this.parentElement = null;
		this.removed = true;
		this.isConnected = false;
	}

	contains(candidate: FakeElement | null): boolean {
		if (!candidate) {
			return false;
		}
		if (candidate === this) {
			return true;
		}
		return this.children.some((child) => child.contains(candidate));
	}

	getBoundingClientRect() {
		return this.rectangle;
	}

	scrollIntoView(): void {
		this.scrollIntoViewCalls += 1;
	}

	private append(
		tagName: string,
		options?: string | {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	): FakeElement {
		const child = new FakeElement(tagName, this.ownerDocument);
		child.parentElement = this;
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

function findByClass(root: FakeElement, className: string): FakeElement | undefined {
	return findElements(
		root,
		(element) => element.className.split(' ').includes(className),
	)[0];
}

function findButton(root: FakeElement, label: string): FakeElement | undefined {
	return findElements(
		root,
		(element) => element.tagName === 'button' && element.attributes['aria-label'] === label,
	)[0];
}

function findTrigger(root: FakeElement): FakeElement {
	const trigger = findByClass(root, 'emend-chat-related-notes-trigger');
	if (!trigger) {
		throw new Error('Related notes trigger missing.');
	}
	return trigger;
}

function textOf(root: FakeElement): string {
	if (root.hidden || root.removed) {
		return '';
	}
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

function isVisible(element: FakeElement): boolean {
	let current: FakeElement | null = element;
	while (current) {
		if (current.hidden || current.removed) {
			return false;
		}
		current = current.parentElement;
	}
	return true;
}

function file(path: string): TFile {
	const note = new TFile();
	note.path = path;
	return note;
}

function fuzzyModalInstances(): Array<InstanceType<typeof FuzzySuggestModal>> {
	return (FuzzySuggestModal as unknown as {
		instances: Array<InstanceType<typeof FuzzySuggestModal>>;
	}).instances;
}

function createControl(initialTargetPath: string | null = 'Active.md') {
	let targetPath = initialTargetPath;
	const files = [
		file('Active.md'),
		file('Zeta.md'),
		file('Outgoing.md'),
		file('Incoming.md'),
		file('Both.md'),
		file('Folder/Unrelated.md'),
		file('Folder/Linked.md'),
		file('Folder/Nested/Deep.md'),
	];
	const resolvedLinks: Record<string, Record<string, number>> = {
		'Active.md': {
			'Outgoing.md': 1,
			'Both.md': 1,
			'Folder/Linked.md': 1,
			'Missing.md': 1,
			'Image.png': 1,
		},
		'Incoming.md': { 'Active.md': 1 },
		'Both.md': { 'Active.md': 1 },
	};
	const read = vi.fn();
	const adapterRead = vi.fn();
	const provider = vi.fn();
	const getMarkdownFiles = vi.fn(() => files);
	const getAbstractFileByPath = vi.fn((path: string) =>
		files.find((item) => item.path === path) ?? null
	);
	const getFileCache = vi.fn((): object | null => ({}));
	const app = new App();
	Object.assign(app, {
		vault: {
			read,
			adapter: { read: adapterRead },
			getMarkdownFiles,
			getAbstractFileByPath,
		},
		metadataCache: { resolvedLinks, getFileCache },
	});
	const store = new AdditionalNotesStore();
	const document = new FakeDocument();
	const container = new FakeElement('div', document);
	const control = new RelatedNotesControl(app, store, () => targetPath);
	return {
		app,
		store,
		document,
		container,
		control,
		files,
		resolvedLinks,
		read,
		adapterRead,
		provider,
		getMarkdownFiles,
		getAbstractFileByPath,
		getFileCache,
		setTargetPath: (path: string | null) => {
			targetPath = path;
		},
	};
}

type ControlFixture = ReturnType<typeof createControl>;

function openExplorer(fixture: ControlFixture): FakeElement {
	findTrigger(fixture.container).click();
	const panels = findElements(
		fixture.document.body,
		(element) => element.className.split(' ').includes('emend-chat-related-notes-explorer'),
	).filter(isVisible);
	if (panels.length !== 1 || !panels[0]) {
		throw new Error(`Expected one open explorer, found ${panels.length}.`);
	}
	return panels[0];
}

function noteCheckbox(panel: FakeElement, path: string): FakeElement {
	const input = findElements(panel, (element) =>
		element.tagName === 'input' && element.attributes['data-note-path'] === path
	)[0];
	if (!input) {
		throw new Error(`Note checkbox missing: ${path}`);
	}
	return input;
}

function folderCheckbox(panel: FakeElement, path: string): FakeElement {
	const input = findElements(panel, (element) =>
		element.tagName === 'input' && element.attributes['data-folder-path'] === path
	)[0];
	if (!input) {
		throw new Error(`Folder checkbox missing: ${path}`);
	}
	return input;
}

function folderDisclosure(panel: FakeElement, path: string): FakeElement {
	const button = findButton(panel, `Toggle folder ${path}`);
	if (!button) {
		throw new Error(`Folder disclosure missing: ${path}`);
	}
	return button;
}

function noteRow(panel: FakeElement, path: string): FakeElement {
	const row = findElements(panel, (element) =>
		element.className.split(' ').includes('emend-chat-related-notes-explorer-note-row')
		&& element.attributes['data-note-path'] === path
	)[0];
	if (!row) {
		throw new Error(`Note row missing: ${path}`);
	}
	return row;
}

function selectAllCheckbox(panel: FakeElement): FakeElement {
	const input = findByClass(panel, 'emend-chat-related-notes-explorer-select-all');
	if (!input) {
		throw new Error('Select-all checkbox missing.');
	}
	return input;
}

function searchInput(panel: FakeElement): FakeElement {
	const input = findByClass(panel, 'emend-chat-related-notes-explorer-search');
	if (!input) {
		throw new Error('Search input missing.');
	}
	return input;
}

function visibleNotePaths(panel: FakeElement): string[] {
	return findElements(panel, (element) =>
		element.className.split(' ').includes('emend-chat-related-notes-explorer-note-row')
		&& isVisible(element)
	).map((element) => element.attributes['data-note-path'] ?? '');
}

function visibleFolderPaths(panel: FakeElement): string[] {
	return findElements(panel, (element) =>
		element.className.split(' ').includes('emend-chat-related-notes-explorer-folder-row')
		&& isVisible(element)
	).map((element) => element.attributes['data-folder-path'] ?? '');
}

function setSearch(panel: FakeElement, query: string): void {
	const input = searchInput(panel);
	input.value = query;
	input.dispatch('input');
}

const allCandidatePaths = [
	'Both.md',
	'Folder/Linked.md',
	'Folder/Nested/Deep.md',
	'Folder/Unrelated.md',
	'Incoming.md',
	'Outgoing.md',
	'Zeta.md',
];

const linkedCandidatePaths = [
	'Both.md',
	'Folder/Linked.md',
	'Incoming.md',
	'Outgoing.md',
];

describe('RelatedNotesControl', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fuzzyModalInstances().length = 0;
		vi.mocked(setIcon).mockClear();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps the selected count, details, disclosure, and accessible trigger name in sync', () => {
		const { store, container, control } = createControl();
		control.render(container as unknown as HTMLElement, false);
		const trigger = findTrigger(container);

		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('0');
		expect(findByClass(container, 'emend-chat-related-notes-details')).toBeUndefined();
		expect(trigger.attributes['aria-label']).toBe('Related notes');

		store.add('Other.md', 'Other target only.md');
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('0');
		store.add('Active.md', 'Outgoing.md');
		store.add('Active.md', 'Folder/Linked.md');
		expect(trigger.attributes['aria-label']).toBe('Related notes, 2 selected');
		const details = findByClass(container, 'emend-chat-related-notes-details');
		expect(details?.open).toBe(false);
		expect(textOf(details as FakeElement)).toContain('Selected notes');
		expect(textOf(details as FakeElement)).toContain('Outgoing.md');
		expect(textOf(details as FakeElement)).toContain(
			'Selected note content is sent with your next request.',
		);
		if (details) {
			details.open = true;
		}
		store.add('Active.md', 'Zeta.md');
		expect(findByClass(container, 'emend-chat-related-notes-details')?.open).toBe(true);
		expect(findTrigger(container)).toBe(trigger);
	});

	it('renders decorative folder and file icons immediately before names without replacing controls', () => {
		const fixture = createControl();
		const { container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const rows = findElements(panel, (element) =>
			element.className.split(' ').includes('emend-chat-related-notes-explorer-row')
		);

		expect(rows).toHaveLength(10);
		for (const row of rows) {
			const folder = row.attributes['data-folder-path'] !== undefined;
			const icon = findByClass(row, 'emend-chat-related-notes-explorer-icon');
			const path = findByClass(row, 'emend-chat-related-notes-explorer-path');
			expect(icon?.attributes['data-icon']).toBe(folder ? 'folder' : 'file-text');
			expect(icon?.attributes['aria-hidden']).toBe('true');
			expect(icon && path && row.children.indexOf(icon) + 1 === row.children.indexOf(path)).toBe(true);
		}
		expect(vi.mocked(setIcon).mock.calls.filter(([, icon]) => icon === 'folder')).toHaveLength(2);
		expect(vi.mocked(setIcon).mock.calls.filter(([, icon]) => icon === 'file-text')).toHaveLength(8);
		expect(noteCheckbox(panel, 'Active.md').attributes['aria-label']).toBe('Active note Active.md');
		expect(textOf(noteRow(panel, 'Active.md'))).toContain('Active');
		expect(folderDisclosure(panel, 'Folder').attributes['aria-label']).toBe('Toggle folder Folder');
		expect(folderCheckbox(panel, 'Folder').attributes['aria-label']).toBe('Select folder Folder');
	});

	it('expands the active note ancestors while leaving unrelated folders and descendants collapsed', () => {
		const fixture = createControl('Folder/Nested/Deep.md');
		const { container, control, files } = fixture;
		files.push(file('Other/Visible.md'), file('Other/Nested/Hidden.md'));
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);

		expect(visibleFolderPaths(panel)).toEqual(['Folder', 'Folder/Nested', 'Other']);
		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('true');
		expect(folderDisclosure(panel, 'Folder/Nested').attributes['aria-expanded']).toBe('true');
		expect(folderDisclosure(panel, 'Other').attributes['aria-expanded']).toBe('false');
		expect(isVisible(noteRow(panel, 'Folder/Nested/Deep.md'))).toBe(true);
		expect(isVisible(noteRow(panel, 'Other/Visible.md'))).toBe(false);
		expect(isVisible(noteRow(panel, 'Other/Nested/Hidden.md'))).toBe(false);

		folderDisclosure(panel, 'Folder').click();
		findButton(panel, 'Links')?.click();
		findButton(panel, 'All')?.click();
		findButton(panel, 'Refresh')?.click();
		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('false');
		expect(isVisible(noteRow(panel, 'Folder/Nested/Deep.md'))).toBe(false);
	});

	it('starts every folder collapsed when the active note is at vault root', () => {
		const fixture = createControl();
		const { container, control, files } = fixture;
		files.push(file('Other/Visible.md'), file('Other/Nested/Hidden.md'));
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);

		expect(visibleNotePaths(panel)).toEqual([
			'Active.md',
			'Both.md',
			'Incoming.md',
			'Outgoing.md',
			'Zeta.md',
		]);
		expect(visibleFolderPaths(panel)).toEqual(['Folder', 'Other']);
		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('false');
		expect(folderDisclosure(panel, 'Other').attributes['aria-expanded']).toBe('false');
		expect(isVisible(noteRow(panel, 'Folder/Nested/Deep.md'))).toBe(false);
		expect(isVisible(noteRow(panel, 'Other/Nested/Hidden.md'))).toBe(false);
	});

	it('preserves manual expansion across modes and Refresh while new folders start collapsed', () => {
		const fixture = createControl();
		const { container, control, files } = fixture;
		files.push(file('Other/Visible.md'), file('Other/Nested/Hidden.md'));
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderDisclosure(panel, 'Folder').click();
		folderDisclosure(panel, 'Folder/Nested').click();
		folderDisclosure(panel, 'Other').click();
		findButton(panel, 'Links')?.click();
		findButton(panel, 'All')?.click();
		files.push(file('Folder/Fresh/New.md'), file('Other/Fresh/New.md'));

		findButton(panel, 'Refresh')?.click();

		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('true');
		expect(folderDisclosure(panel, 'Folder/Nested').attributes['aria-expanded']).toBe('true');
		expect(folderDisclosure(panel, 'Other').attributes['aria-expanded']).toBe('true');
		expect(folderDisclosure(panel, 'Folder/Fresh').attributes['aria-expanded']).toBe('false');
		expect(folderDisclosure(panel, 'Other/Fresh').attributes['aria-expanded']).toBe('false');
		expect(isVisible(noteRow(panel, 'Folder/Fresh/New.md'))).toBe(false);
		expect(isVisible(noteRow(panel, 'Other/Fresh/New.md'))).toBe(false);
	});

	it('opens one snapshot-based All explorer without a modal, content read, or provider call', () => {
		const fixture = createControl();
		const {
			container,
			control,
			document,
			getMarkdownFiles,
			getAbstractFileByPath,
			read,
			adapterRead,
			provider,
		} = fixture;
		control.render(container as unknown as HTMLElement, false);
		expect(getMarkdownFiles).not.toHaveBeenCalled();

		const panel = openExplorer(fixture);

		expect(getAbstractFileByPath).toHaveBeenCalledWith('Active.md');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(fuzzyModalInstances()).toHaveLength(0);
		expect(visibleNotePaths(panel)).toEqual([
			'Active.md',
			'Both.md',
			'Incoming.md',
			'Outgoing.md',
			'Zeta.md',
		]);
		expect(visibleFolderPaths(panel)).toEqual(['Folder']);
		expect(isVisible(noteRow(panel, 'Folder/Nested/Deep.md'))).toBe(false);
		const active = noteCheckbox(panel, 'Active.md');
		expect(active.disabled).toBe(true);
		expect(active.attributes['aria-label']).toBe('Active note Active.md');
		const activeRow = findElements(panel, (element) =>
			element.attributes['data-note-path'] === 'Active.md'
			&& element.className.includes('note-row')
		)[0];
		expect(textOf(activeRow as FakeElement)).toContain('Active');
		expect(activeRow?.scrollIntoViewCalls).toBe(1);
		expect(findButton(panel, 'All')?.attributes['aria-pressed']).toBe('true');
		expect(findButton(panel, 'Links')?.attributes['aria-pressed']).toBe('false');
		expect(findTrigger(container).attributes['aria-expanded']).toBe('true');

		findTrigger(container).click();
		expect(findElements(document.body, (element) =>
			element.className.split(' ').includes('emend-chat-related-notes-explorer')
			&& isVisible(element)
		)).toHaveLength(1);
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(document.listenerCount('keydown')).toBe(1);
		expect(document.listenerCount('pointerdown')).toBe(1);
		expect(read).not.toHaveBeenCalled();
		expect(adapterRead).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(provider).not.toHaveBeenCalled();
	});

	it('reuses the opening snapshot for Links and shows only outgoing and incoming candidates', () => {
		const fixture = createControl();
		const { container, control, getMarkdownFiles } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);

		findButton(panel, 'Links')?.click();

		expect(visibleNotePaths(panel)).toEqual(['Active.md', 'Both.md', 'Incoming.md', 'Outgoing.md']);
		expect(isVisible(noteRow(panel, 'Folder/Linked.md'))).toBe(false);
		expect(visibleNotePaths(panel)).not.toContain('Folder/Unrelated.md');
		expect(visibleNotePaths(panel)).not.toContain('Zeta.md');
		expect(findButton(panel, 'All')?.attributes['aria-pressed']).toBe('false');
		expect(findButton(panel, 'Links')?.attributes['aria-pressed']).toBe('true');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(noteCheckbox(panel, 'Active.md').disabled).toBe(true);
	});

	it('filters full paths case-insensitively and reveals matching ancestors despite collapsed state', () => {
		const fixture = createControl();
		const { container, control, getMarkdownFiles } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('false');
		expect(folderDisclosure(panel, 'Folder/Nested').attributes['aria-expanded']).toBe('false');

		setSearch(panel, 'nested/deep');

		expect(visibleNotePaths(panel)).toEqual(['Folder/Nested/Deep.md']);
		expect(visibleFolderPaths(panel)).toEqual(['Folder', 'Folder/Nested']);
		expect(folderDisclosure(panel, 'Folder').attributes['aria-expanded']).toBe('false');
		expect(folderDisclosure(panel, 'Folder/Nested').attributes['aria-expanded']).toBe('false');
		setSearch(panel, 'OUTGOING');
		expect(visibleNotePaths(panel)).toEqual(['Outgoing.md']);
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
	});

	it('adds and removes manual paths while keeping the active note excluded', () => {
		const fixture = createControl();
		const { store, container, control, read, adapterRead, provider } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);

		noteCheckbox(panel, 'Outgoing.md').click();
		expect(store.list('Active.md')).toEqual(['Outgoing.md']);
		expect(findByClass(container, 'emend-chat-related-notes-count')?.textContent).toBe('1');
		noteCheckbox(panel, 'Active.md').dispatch('change');
		expect(store.list('Active.md')).toEqual(['Outgoing.md']);
		noteCheckbox(panel, 'Outgoing.md').click();
		expect(store.list('Active.md')).toEqual([]);
		expect(read).not.toHaveBeenCalled();
		expect(adapterRead).not.toHaveBeenCalled();
		expect(provider).not.toHaveBeenCalled();
	});

	it('selects the complete All result set once, including search-hidden descendants', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		setSearch(panel, 'Outgoing');
		let notifications = 0;
		const unsubscribe = store.subscribe(() => {
			notifications += 1;
		});

		selectAllCheckbox(panel).click();

		expect(store.list('Active.md')).toEqual(allCandidatePaths);
		expect(notifications).toBe(1);
		expect(selectAllCheckbox(panel).checked).toBe(true);
		expect(selectAllCheckbox(panel).indeterminate).toBe(false);
		expect(noteCheckbox(panel, 'Folder/Nested/Deep.md').checked).toBe(true);
		unsubscribe();
	});

	it('refreshes selection state only from the store notification for a bulk action', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const list = vi.spyOn(store, 'list');

		selectAllCheckbox(panel).click();

		expect(list.mock.calls.filter(([targetPath]) => targetPath === 'Active.md')).toHaveLength(2);
	});

	it('scopes a Links folder selection to linked descendants only, even when search hides them', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		findButton(panel, 'Links')?.click();
		setSearch(panel, 'Linked');
		expect(isVisible(folderCheckbox(panel, 'Folder'))).toBe(true);
		expect(visibleNotePaths(panel)).not.toContain('Folder/Unrelated.md');
		let notifications = 0;
		const unsubscribe = store.subscribe(() => {
			notifications += 1;
		});

		folderCheckbox(panel, 'Folder').click();

		expect(store.list('Active.md')).toEqual(['Folder/Linked.md']);
		expect(store.listHelpers('Active.md')).toEqual([{
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'Active.md' },
		}]);
		expect(notifications).toBe(1);
		expect(store.list('Active.md')).not.toContain('Folder/Unrelated.md');
		expect(store.list('Active.md')).not.toContain('Folder/Nested/Deep.md');
		unsubscribe();
	});

	it('maintains checked and indeterminate note, folder, and Select-all states in place', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const folder = folderCheckbox(panel, 'Folder');
		const tree = findByClass(panel, 'emend-chat-related-notes-explorer-tree');

		folder.click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
		]);
		expect(folder.checked).toBe(true);
		expect(selectAllCheckbox(panel).indeterminate).toBe(true);
		noteCheckbox(panel, 'Folder/Linked.md').click();
		expect(folder.checked).toBe(false);
		expect(folder.indeterminate).toBe(true);
		expect(findByClass(panel, 'emend-chat-related-notes-explorer-tree')).toBe(tree);
		selectAllCheckbox(panel).click();
		expect(selectAllCheckbox(panel).checked).toBe(true);
		expect(folder.indeterminate).toBe(false);
		selectAllCheckbox(panel).click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
		]);
		expect(selectAllCheckbox(panel).checked).toBe(false);
		expect(folder.indeterminate).toBe(true);
	});

	it('preserves manual and other-helper membership when Select all is cleared', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		findButton(panel, 'Links')?.click();
		selectAllCheckbox(panel).click();
		findButton(panel, 'All')?.click();
		selectAllCheckbox(panel).click();
		store.add('Active.md', 'Outgoing.md');

		selectAllCheckbox(panel).click();
		expect(store.list('Active.md')).toEqual(linkedCandidatePaths);
		expect(store.listHelpers('Active.md')).toEqual([{
			type: 'links',
			targetPath: 'Active.md',
		}]);
		findButton(panel, 'Refresh')?.click();
		expect(store.list('Active.md')).toEqual(linkedCandidatePaths);
	});

	it('preserves manual and other-helper membership when a folder is deselected', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderCheckbox(panel, 'Folder').click();
		store.add('Active.md', 'Folder/Unrelated.md');
		findButton(panel, 'Links')?.click();
		selectAllCheckbox(panel).click();
		findButton(panel, 'All')?.click();

		folderCheckbox(panel, 'Folder').click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Unrelated.md',
			'Both.md',
			'Incoming.md',
			'Outgoing.md',
		]);
		findButton(panel, 'Refresh')?.click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Unrelated.md',
			'Both.md',
			'Incoming.md',
			'Outgoing.md',
		]);
	});

	it('restores an individually removed helper path on Refresh and updates external details', () => {
		const fixture = createControl();
		const { store, container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderCheckbox(panel, 'Folder').click();
		expect(findButton(container, 'Remove Folder/Linked.md')).toBeDefined();

		findButton(container, 'Remove Folder/Linked.md')?.click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
		]);
		expect(noteCheckbox(panel, 'Folder/Linked.md').checked).toBe(false);
		findButton(panel, 'Refresh')?.click();
		expect(store.list('Active.md')).toEqual([
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
			'Folder/Linked.md',
		]);
		expect(noteCheckbox(panel, 'Folder/Linked.md').checked).toBe(true);
		findButton(container, 'Clear all related notes')?.click();
		expect(store.list('Active.md')).toEqual([]);
		expect(store.listHelpers('Active.md')).toEqual([]);
	});

	it('uses one explicit snapshot to refresh coexisting folder and Links helpers after path and metadata changes', () => {
		const fixture = createControl();
		const { store, container, control, files, resolvedLinks, getMarkdownFiles } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderCheckbox(panel, 'Folder').click();
		findButton(panel, 'Links')?.click();
		selectAllCheckbox(panel).click();
		findButton(panel, 'All')?.click();
		const initialPaths = [
			'Folder/Linked.md',
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
			'Both.md',
			'Incoming.md',
			'Outgoing.md',
		];
		expect(store.list('Active.md')).toEqual(initialPaths);
		expect(store.listHelpers('Active.md')).toEqual([
			{
				type: 'folder',
				path: 'Folder',
				scope: { type: 'all' },
			},
			{ type: 'links', targetPath: 'Active.md' },
		]);

		const removed = files.findIndex((candidate) => candidate.path === 'Folder/Unrelated.md');
		if (removed < 0) {
			throw new Error('Expected the folder fixture to exist.');
		}
		files.splice(removed, 1);
		files.push(file('Folder/New.md'), file('New Link.md'));
		const activeLinks = resolvedLinks['Active.md'];
		if (!activeLinks) {
			throw new Error('Expected active-note link metadata.');
		}
		delete activeLinks['Outgoing.md'];
		activeLinks['New Link.md'] = 1;
		findButton(panel, 'Links')?.click();

		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(store.list('Active.md')).toEqual(initialPaths);
		expect(visibleNotePaths(panel)).toContain('Outgoing.md');
		expect(visibleNotePaths(panel)).not.toContain('New Link.md');
		findButton(panel, 'Refresh')?.click();

		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Nested/Deep.md',
			'Both.md',
			'Incoming.md',
			'Folder/New.md',
			'New Link.md',
		]);
		expect(visibleNotePaths(panel)).toContain('New Link.md');
		expect(visibleNotePaths(panel)).not.toContain('Outgoing.md');
		findButton(panel, 'All')?.click();
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(isVisible(noteRow(panel, 'Folder/New.md'))).toBe(false);
		folderDisclosure(panel, 'Folder').click();
		expect(visibleNotePaths(panel)).toContain('Folder/New.md');
		expect(visibleNotePaths(panel)).not.toContain('Folder/Unrelated.md');
	});

	it('refreshes every helper from exactly one new snapshot and preserves manual paths', () => {
		const fixture = createControl();
		const { store, container, control, files, getMarkdownFiles } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderCheckbox(panel, 'Folder').click();
		store.add('Active.md', 'Zeta.md');
		const removed = files.findIndex((candidate) => candidate.path === 'Folder/Unrelated.md');
		files.splice(removed, 1);
		files.push(file('Folder/New.md'));
		setSearch(panel, 'Folder/');

		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(store.list('Active.md')).toContain('Folder/Unrelated.md');
		findButton(panel, 'Refresh')?.click();

		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Nested/Deep.md',
			'Zeta.md',
			'Folder/New.md',
		]);
		expect(searchInput(panel).value).toBe('Folder/');
		expect(visibleNotePaths(panel)).toContain('Folder/New.md');
		expect(visibleNotePaths(panel)).not.toContain('Folder/Unrelated.md');
	});

	it('updates candidates on explicit Refresh even when no helpers are recorded', () => {
		const fixture = createControl();
		const { store, container, control, files, getMarkdownFiles } = fixture;
		control.render(container as unknown as HTMLElement, false);
		store.add('Active.md', 'Zeta.md');
		const panel = openExplorer(fixture);
		files.push(file('New manual candidate.md'));

		expect(visibleNotePaths(panel)).not.toContain('New manual candidate.md');
		findButton(panel, 'Links')?.click();
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		findButton(panel, 'Refresh')?.click();

		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(store.list('Active.md')).toEqual(['Zeta.md']);
		findButton(panel, 'All')?.click();
		expect(visibleNotePaths(panel)).toContain('New manual candidate.md');
	});

	it('shows the exact incomplete-cache disclosure only in Links without scanning bodies', () => {
		const fixture = createControl();
		const { container, control, getFileCache, read, adapterRead } = fixture;
		getFileCache.mockReturnValueOnce(null);
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const warning = 'Links may be incomplete while Obsidian finishes indexing this vault. Refresh later; Emend does not read note bodies to find links.';

		expect(textOf(panel)).not.toContain(warning);
		findButton(panel, 'Links')?.click();
		expect(textOf(panel)).toContain(warning);
		findButton(panel, 'All')?.click();
		expect(textOf(panel)).not.toContain(warning);
		expect(textOf(panel)).toContain('Contents are read at submission');
		expect(textOf(panel)).toContain('capacity checks');
		expect(read).not.toHaveBeenCalled();
		expect(adapterRead).not.toHaveBeenCalled();
	});

	it('invalidates stale checkbox and Refresh handlers on rerender, destroy, and target change', () => {
		const fixture = createControl();
		const { store, container, control, files, setTargetPath, getMarkdownFiles } = fixture;
		files.push(file('Other.md'));
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const staleNote = noteCheckbox(panel, 'Outgoing.md');
		const staleRefresh = findButton(panel, 'Refresh') as FakeElement;

		container.empty();
		control.render(container as unknown as HTMLElement, false);
		setTargetPath('Other.md');
		control.setDisabled(false);
		staleNote.checked = true;
		staleNote.dispatch('change');
		staleRefresh.click();

		expect(store.list('Other.md')).toEqual([]);
		expect(store.list('Active.md')).toEqual([]);
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		const currentPanel = openExplorer(fixture);
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		control.destroy();
		const destroyedNote = noteCheckbox(currentPanel, 'Outgoing.md');
		destroyedNote.checked = true;
		destroyedNote.dispatch('change');
		expect(store.list('Other.md')).toEqual([]);
	});

	it('disables all explorer mutations while pending and closes for a missing target', () => {
		const fixture = createControl();
		const { store, container, control, setTargetPath } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const note = noteCheckbox(panel, 'Outgoing.md');
		control.setDisabled(true);

		const controls = findElements(panel, (element) =>
			element.tagName === 'button' || element.tagName === 'input'
		);
		expect(controls.every((element) => element.disabled)).toBe(true);
		note.checked = true;
		note.dispatch('change');
		findButton(panel, 'Refresh')?.dispatch('click');
		expect(store.list('Active.md')).toEqual([]);

		setTargetPath(null);
		control.setDisabled(false);
		expect(panel.removed).toBe(true);
		expect(findTrigger(container).disabled).toBe(true);
	});

	it('uses native accessible controls, scoped Select-all names, and folder disclosure state', () => {
		const fixture = createControl();
		const { container, control } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		const search = searchInput(panel);
		const disclosure = folderDisclosure(panel, 'Folder');
		const deep = noteRow(panel, 'Folder/Nested/Deep.md');

		expect(panel.attributes.role).toBe('dialog');
		expect(search.tagName).toBe('input');
		expect(search.attributes.type).toBe('search');
		expect(noteCheckbox(panel, 'Outgoing.md').attributes.type).toBe('checkbox');
		expect(disclosure.tagName).toBe('button');
		expect(disclosure.attributes['aria-expanded']).toBe('false');
		expect(isVisible(deep)).toBe(false);
		disclosure.click();
		expect(disclosure.attributes['aria-expanded']).toBe('true');
		expect(isVisible(deep)).toBe(false);
		folderDisclosure(panel, 'Folder/Nested').click();
		expect(isVisible(deep)).toBe(true);
		disclosure.click();
		expect(isVisible(deep)).toBe(false);
		disclosure.click();
		setSearch(panel, 'Outgoing');
		expect(selectAllCheckbox(panel).attributes['aria-label']).toContain('including search-hidden results');
		setSearch(panel, '');
		findButton(panel, 'Links')?.click();
		expect(selectAllCheckbox(panel).attributes['aria-label']).toContain('links');
	});

	it('positions above when below has 180px but above has more space', () => {
		const fixture = createControl();
		const { container, control, document } = fixture;
		control.render(container as unknown as HTMLElement, false);
		document.defaultView.innerHeight = 600;
		findTrigger(container).rectangle = { left: 20, top: 320, bottom: 360, right: 220, width: 200, height: 40 };

		const panel = openExplorer(fixture);

		expect(panel.style.top).toBe('8px');
		expect(panel.style.maxHeight).toBe('308px');
	});

	it('retains below placement when below has more space but less than the preferred height', () => {
		const fixture = createControl();
		const { container, control, document } = fixture;
		control.render(container as unknown as HTMLElement, false);
		document.defaultView.innerHeight = 800;
		findTrigger(container).rectangle = { left: 20, top: 300, bottom: 340, right: 220, width: 200, height: 40 };

		const panel = openExplorer(fixture);

		expect(panel.style.top).toBe('344px');
		expect(panel.style.maxHeight).toBe('448px');
	});

	it('prefers below placement whenever below fits the preferred height', () => {
		const fixture = createControl();
		const { container, control, document } = fixture;
		control.render(container as unknown as HTMLElement, false);
		document.defaultView.innerHeight = 1200;
		findTrigger(container).rectangle = { left: 20, top: 600, bottom: 640, right: 220, width: 200, height: 40 };

		const panel = openExplorer(fixture);

		expect(panel.style.top).toBe('644px');
		expect(panel.style.maxHeight).toBe('480px');
	});

	it('handles Escape and outside pointer-down, ignores inside clicks, and cleans up listeners', () => {
		const fixture = createControl();
		const { container, control, document } = fixture;
		control.render(container as unknown as HTMLElement, false);
		let panel = openExplorer(fixture);
		const trigger = findTrigger(container);

		document.dispatch('pointerdown', searchInput(panel));
		expect(panel.removed).toBe(false);
		const escape = document.dispatch('keydown', searchInput(panel), 'Escape');
		expect(escape.defaultPrevented).toBe(true);
		expect(escape.propagationStopped).toBe(true);
		expect(panel.removed).toBe(true);
		expect(trigger.focused).toBe(true);
		expect(trigger.attributes['aria-expanded']).toBe('false');
		expect(document.listenerCount('keydown')).toBe(0);
		expect(document.listenerCount('pointerdown')).toBe(0);

		panel = openExplorer(fixture);
		document.dispatch('pointerdown', document.body);
		expect(panel.removed).toBe(true);
		expect(trigger.focused).toBe(true);
		expect(document.listenerCount('keydown')).toBe(0);
		expect(document.listenerCount('pointerdown')).toBe(0);
	});

	it('shares the ordered list, removals, and Clear all with the unchanged Modify Selection control', () => {
		const fixture = createControl();
		const { app, store, container, control, document } = fixture;
		control.render(container as unknown as HTMLElement, false);
		const modalContainer = new FakeElement('div', document);
		const modal = new AdditionalNotesControl(app, store, () => 'Active.md');
		modal.render(modalContainer as unknown as HTMLElement, false);
		const panel = openExplorer(fixture);
		folderCheckbox(panel, 'Folder').click();

		expect(store.list('Active.md')).toEqual([
			'Folder/Linked.md',
			'Folder/Nested/Deep.md',
			'Folder/Unrelated.md',
		]);
		expect(textOf(modalContainer)).toContain('Folder/Linked.md');
		expect(textOf(modalContainer)).toContain('Folder/Nested/Deep.md');
		findButton(container, 'Remove Folder/Linked.md')?.click();
		expect(textOf(modalContainer)).not.toContain('Folder/Linked.md');
		findButton(container, 'Clear all related notes')?.click();
		expect(store.list('Active.md')).toEqual([]);
		expect(textOf(modalContainer)).toContain('No additional notes selected.');
		modal.destroy();
	});
});
