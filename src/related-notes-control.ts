import { App, TFile } from 'obsidian';
import type {
	AdditionalNoteHelper,
	AdditionalNoteHelperScope,
	AdditionalNotesStore,
} from './additional-notes-store';
import {
	captureRelatedNotesSnapshot,
	getRelatedFolderPaths,
	resolveAdditionalNoteHelper,
	type RelatedNotesSnapshot,
} from './related-notes-discovery';

type ExplorerMode = 'all' | 'links';

type ExplorerRow = {
	element: HTMLElement;
	type: 'folder' | 'note';
	path: string;
	parentPath: string | null;
};

interface RelatedNotesExplorerOptions {
	app: App;
	store: AdditionalNotesStore;
	targetPath: string;
	snapshot: RelatedNotesSnapshot;
	trigger: HTMLButtonElement;
	isCurrent: () => boolean;
	isDisabled: () => boolean;
	onClose: (explorer: RelatedNotesExplorer) => void;
}

let nextExplorerId = 1;

class RelatedNotesExplorer {
	readonly targetPath: string;

	private readonly app: App;
	private readonly store: AdditionalNotesStore;
	private readonly trigger: HTMLButtonElement;
	private readonly isCurrent: () => boolean;
	private readonly isDisabled: () => boolean;
	private readonly onClose: (explorer: RelatedNotesExplorer) => void;
	private readonly panelEl: HTMLElement;
	private readonly treeEl: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly selectAllInput: HTMLInputElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly cacheDisclosureEl: HTMLElement;
	private readonly modeButtons: Record<ExplorerMode, HTMLButtonElement>;
	private readonly noteInputs = new Map<string, HTMLInputElement>();
	private readonly folderInputs = new Map<string, HTMLInputElement>();
	private readonly folderButtons = new Map<string, HTMLButtonElement>();
	private readonly collapsedFolders = new Set<string>();
	private rows: ExplorerRow[] = [];
	private snapshot: RelatedNotesSnapshot;
	private mode: ExplorerMode = 'all';
	private query = '';
	private disabled = false;
	private closed = false;
	private activeNoteRow: HTMLElement | null = null;

	private readonly onDocumentKeyDown = (event: KeyboardEvent) => {
		if (this.closed || event.key !== 'Escape') {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.close();
	};

	private readonly onDocumentPointerDown = (event: PointerEvent) => {
		if (this.closed) {
			return;
		}
		const target = event.target as Node | null;
		if (target && (this.panelEl.contains(target) || this.trigger.contains(target))) {
			return;
		}
		this.close();
	};

	constructor(options: RelatedNotesExplorerOptions) {
		this.app = options.app;
		this.store = options.store;
		this.targetPath = options.targetPath;
		this.snapshot = options.snapshot;
		this.trigger = options.trigger;
		this.isCurrent = options.isCurrent;
		this.isDisabled = options.isDisabled;
		this.onClose = options.onClose;
		const document = this.trigger.ownerDocument;
		const panelId = `emend-chat-related-notes-explorer-${nextExplorerId++}`;
		this.panelEl = document.body.createDiv({
			cls: 'emend-chat-related-notes-explorer',
			attr: {
				id: panelId,
				role: 'dialog',
				'aria-label': 'Related notes explorer',
			},
		});
		this.trigger.setAttribute('aria-controls', panelId);
		this.trigger.setAttribute('aria-expanded', 'true');
		const actionsEl = this.panelEl.createDiv('emend-chat-related-notes-explorer-actions');
		this.modeButtons = {
			all: this.createActionButton(actionsEl, 'All', () => this.setMode('all')),
			links: this.createActionButton(actionsEl, 'Links', () => this.setMode('links')),
		};
		this.refreshButton = this.createActionButton(actionsEl, 'Refresh', () => this.refresh());
		this.refreshButton.title = 'Refresh paths and links with one new snapshot';
		this.searchInput = this.panelEl.createEl('input', {
			cls: 'emend-chat-related-notes-explorer-search',
			attr: {
				type: 'search',
				'aria-label': 'Search related notes',
				placeholder: 'Search full paths',
			},
		});
		this.searchInput.addEventListener('input', () => {
			if (this.closed || !this.isCurrent()) {
				this.close();
				return;
			}
			if (this.isDisabled()) {
				this.searchInput.value = this.query;
				return;
			}
			this.query = this.searchInput.value;
			this.applyVisibility();
			this.updateScopeLabels();
		});
		const selectAllRow = this.panelEl.createDiv('emend-chat-related-notes-explorer-select-all-row');
		this.selectAllInput = selectAllRow.createEl('input', {
			cls: 'emend-chat-related-notes-explorer-select-all',
			attr: { type: 'checkbox', 'aria-label': 'Select all notes in all' },
		});
		selectAllRow.createSpan({ text: 'Select all' });
		this.selectAllInput.addEventListener('change', () => this.toggleSelectAll());
		this.treeEl = this.panelEl.createDiv('emend-chat-related-notes-explorer-tree');
		this.cacheDisclosureEl = this.panelEl.createDiv(
			'emend-chat-related-notes-explorer-cache-disclosure',
		);
		this.panelEl.createDiv({
			cls: 'emend-chat-related-notes-explorer-disclosure',
			text: 'Contents are read at submission and share the existing context budget. Large selections may be rejected by capacity checks.',
		});
		this.renderTree();
		this.updateDisclosure();
		this.updateSelection();
		this.positionPanel();
		document.addEventListener('keydown', this.onDocumentKeyDown);
		document.addEventListener('pointerdown', this.onDocumentPointerDown);
		this.activeNoteRow?.scrollIntoView({ block: 'nearest' });
		this.searchInput.focus();
	}

	close(restoreFocus = true): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const document = this.trigger.ownerDocument;
		document.removeEventListener('keydown', this.onDocumentKeyDown);
		document.removeEventListener('pointerdown', this.onDocumentPointerDown);
		this.panelEl.remove();
		this.trigger.setAttribute('aria-expanded', 'false');
		this.onClose(this);
		if (restoreFocus) {
			this.trigger.focus();
		}
	}

	setDisabled(disabled: boolean): void {
		if (this.closed) {
			return;
		}
		if (!this.isCurrent()) {
			this.close();
			return;
		}
		this.disabled = disabled;
		this.updateDisabled();
	}

	updateSelection(): void {
		if (this.closed) {
			return;
		}
		if (!this.isCurrent()) {
			this.close();
			return;
		}
		const selected = new Set(this.store.list(this.targetPath));
		const scopePaths = this.scopePaths();
		for (const [path, input] of this.noteInputs) {
			const active = path === this.targetPath;
			input.checked = !active && selected.has(path);
			input.indeterminate = false;
		}
		for (const [path, input] of this.folderInputs) {
			const descendants = this.folderDescendants(path, scopePaths);
			const selectedCount = descendants.filter((candidate) => selected.has(candidate)).length;
			input.checked = descendants.length > 0 && selectedCount === descendants.length;
			input.indeterminate = selectedCount > 0 && selectedCount < descendants.length;
		}
		const selectedCount = scopePaths.filter((path) => selected.has(path)).length;
		this.selectAllInput.checked = scopePaths.length > 0 && selectedCount === scopePaths.length;
		this.selectAllInput.indeterminate = selectedCount > 0 && selectedCount < scopePaths.length;
		this.updateDisabled();
	}

	private createActionButton(
		container: HTMLElement,
		label: 'All' | 'Links' | 'Refresh',
		onClick: () => void,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'emend-chat-related-notes-explorer-action',
			text: label,
			attr: { type: 'button', 'aria-label': label },
		});
		if (label !== 'Refresh') {
			button.setAttribute('aria-pressed', String(label.toLowerCase() === this.mode));
		}
		button.addEventListener('click', () => {
			if (!this.canInteract()) {
				return;
			}
			onClick();
		});
		return button;
	}

	private setMode(mode: ExplorerMode): void {
		if (this.mode === mode) {
			return;
		}
		this.mode = mode;
		for (const [candidate, button] of Object.entries(this.modeButtons)) {
			button.setAttribute('aria-pressed', String(candidate === mode));
		}
		this.renderTree();
		this.updateDisclosure();
		this.updateSelection();
	}

	private refresh(): void {
		if (!this.canInteract()) {
			return;
		}
		const targetFile = this.app.vault.getAbstractFileByPath(this.targetPath);
		if (!(targetFile instanceof TFile) || !this.canInteract()) {
			this.close();
			return;
		}
		const snapshot = captureRelatedNotesSnapshot(this.app, targetFile);
		if (!this.canInteract()) {
			return;
		}
		this.snapshot = snapshot;
		this.store.refresh(
			this.targetPath,
			(helper) => resolveAdditionalNoteHelper(snapshot, helper),
		);
		this.renderTree();
		this.updateDisclosure();
		this.updateSelection();
	}

	private toggleSelectAll(): void {
		if (!this.canInteract()) {
			this.updateSelection();
			return;
		}
		const helper: AdditionalNoteHelper = this.mode === 'all'
			? { type: 'all' }
			: { type: 'links', targetPath: this.targetPath };
		if (this.selectAllInput.checked) {
			this.store.addHelper(this.targetPath, helper, this.scopePaths());
		} else {
			this.store.removeHelper(this.targetPath, helper);
		}
		this.updateSelection();
	}

	private toggleFolder(path: string): void {
		if (!this.canInteract()) {
			this.updateSelection();
			return;
		}
		const helper: AdditionalNoteHelper = {
			type: 'folder',
			path,
			scope: this.helperScope(),
		};
		const input = this.folderInputs.get(path);
		if (!input) {
			return;
		}
		if (input.checked) {
			this.store.addHelper(this.targetPath, helper, this.folderDescendants(path));
		} else {
			this.store.removeHelper(this.targetPath, helper);
		}
		this.updateSelection();
	}

	private toggleNote(path: string): void {
		if (path === this.targetPath || !this.canInteract()) {
			this.updateSelection();
			return;
		}
		const input = this.noteInputs.get(path);
		if (!input) {
			return;
		}
		if (input.checked) {
			this.store.add(this.targetPath, path);
		} else {
			this.store.remove(this.targetPath, path);
		}
		this.updateSelection();
	}

	private helperScope(): AdditionalNoteHelperScope {
		return this.mode === 'all'
			? { type: 'all' }
			: { type: 'links', targetPath: this.targetPath };
	}

	private scopePaths(): readonly string[] {
		return this.mode === 'all' ? this.snapshot.allPaths : this.snapshot.linkedPaths;
	}

	private folderDescendants(
		folderPath: string,
		paths = this.scopePaths(),
	): readonly string[] {
		return paths.filter((path) => path.startsWith(`${folderPath}/`));
	}

	private renderTree(): void {
		this.treeEl.empty();
		this.noteInputs.clear();
		this.folderInputs.clear();
		this.folderButtons.clear();
		this.rows = [];
		this.activeNoteRow = null;
		const candidates = this.scopePaths();
		const treePaths = this.mode === 'all'
			? [...candidates, this.targetPath].sort(comparePaths)
			: [...candidates];
		if (this.mode === 'links') {
			this.activeNoteRow = this.createNoteRow(this.treeEl, this.targetPath, null, 0);
			this.treeEl.createDiv({
				cls: 'emend-chat-related-notes-explorer-links-separator',
				text: 'Linked notes',
			});
		}
		const folders = getRelatedFolderPaths(treePaths);
		this.renderTreeLevel(null, 0, treePaths, folders);
		if (treePaths.length === 0) {
			this.treeEl.createDiv({
				cls: 'emend-chat-related-notes-explorer-empty',
				text: this.mode === 'links' ? 'No linked notes found.' : 'No other Markdown notes found.',
			});
		}
		this.applyVisibility();
		this.updateScopeLabels();
	}

	private renderTreeLevel(
		parentPath: string | null,
		depth: number,
		paths: readonly string[],
		folders: readonly string[],
	): void {
		const entries: Array<{ type: 'folder' | 'note'; path: string }> = [
			...folders
				.filter((path) => parentFolder(path) === parentPath)
				.map((path) => ({ type: 'folder' as const, path })),
			...paths
				.filter((path) => parentFolder(path) === parentPath)
				.map((path) => ({ type: 'note' as const, path })),
		].sort((left, right) => comparePaths(left.path, right.path));
		for (const entry of entries) {
			if (entry.type === 'folder') {
				this.createFolderRow(entry.path, parentPath, depth);
				this.renderTreeLevel(entry.path, depth + 1, paths, folders);
			} else {
				const row = this.createNoteRow(this.treeEl, entry.path, parentPath, depth);
				if (entry.path === this.targetPath) {
					this.activeNoteRow = row;
				}
			}
		}
	}

	private createFolderRow(path: string, parentPath: string | null, depth: number): void {
		const rowEl = this.treeEl.createDiv({
			cls: 'emend-chat-related-notes-explorer-row emend-chat-related-notes-explorer-folder-row',
			attr: { 'data-folder-path': path },
		});
		rowEl.style.paddingInlineStart = `${depth * 14}px`;
		const disclosure = rowEl.createEl('button', {
			cls: 'emend-chat-related-notes-explorer-folder-disclosure',
			text: '▾',
			attr: {
				type: 'button',
				'aria-label': `Toggle folder ${path}`,
				'aria-expanded': 'true',
			},
		});
		this.folderButtons.set(path, disclosure);
		disclosure.addEventListener('click', () => {
			if (!this.canInteract()) {
				return;
			}
			if (this.collapsedFolders.has(path)) {
				this.collapsedFolders.delete(path);
			} else {
				this.collapsedFolders.add(path);
			}
			this.applyVisibility();
		});
		const input = rowEl.createEl('input', {
			cls: 'emend-chat-related-notes-explorer-checkbox',
			attr: {
				type: 'checkbox',
				'aria-label': `Select folder ${path}`,
				'data-folder-path': path,
			},
		});
		input.addEventListener('change', () => this.toggleFolder(path));
		this.folderInputs.set(path, input);
		rowEl.createSpan({
			cls: 'emend-chat-related-notes-explorer-path',
			text: path,
			attr: { title: path },
		});
		this.rows.push({ element: rowEl, type: 'folder', path, parentPath });
	}

	private createNoteRow(
		container: HTMLElement,
		path: string,
		parentPath: string | null,
		depth: number,
	): HTMLElement {
		const active = path === this.targetPath;
		const rowEl = container.createDiv({
			cls: `emend-chat-related-notes-explorer-row emend-chat-related-notes-explorer-note-row${active ? ' is-active' : ''}`,
			attr: { 'data-note-path': path },
		});
		rowEl.style.paddingInlineStart = `${depth * 14 + 24}px`;
		const input = rowEl.createEl('input', {
			cls: 'emend-chat-related-notes-explorer-checkbox',
			attr: {
				type: 'checkbox',
				'aria-label': active ? `Active note ${path}` : `Select note ${path}`,
				'data-note-path': path,
			},
		});
		input.disabled = active;
		input.addEventListener('change', () => this.toggleNote(path));
		this.noteInputs.set(path, input);
		rowEl.createSpan({
			cls: 'emend-chat-related-notes-explorer-path',
			text: path,
			attr: { title: path },
		});
		if (active) {
			rowEl.createSpan({
				cls: 'emend-chat-related-notes-explorer-active-label',
				text: 'Active',
			});
		}
		this.rows.push({ element: rowEl, type: 'note', path, parentPath });
		return rowEl;
	}

	private applyVisibility(): void {
		const query = this.query.trim().toLowerCase();
		const matchingFolders = new Set<string>();
		if (query) {
			for (const row of this.rows) {
				if (row.type !== 'note' || !row.path.toLowerCase().includes(query)) {
					continue;
				}
				let parent = row.parentPath;
				while (parent) {
					matchingFolders.add(parent);
					parent = parentFolder(parent);
				}
			}
		}
		for (const row of this.rows) {
			let visible: boolean;
			if (query) {
				visible = row.type === 'note'
					? row.path.toLowerCase().includes(query)
					: matchingFolders.has(row.path);
			} else {
				let parent = row.parentPath;
				visible = true;
				while (parent) {
					if (this.collapsedFolders.has(parent)) {
						visible = false;
						break;
					}
					parent = parentFolder(parent);
				}
			}
			row.element.hidden = !visible;
		}
		for (const [path, button] of this.folderButtons) {
			button.setAttribute('aria-expanded', String(!this.collapsedFolders.has(path)));
			button.textContent = this.collapsedFolders.has(path) ? '▸' : '▾';
		}
	}

	private updateScopeLabels(): void {
		const scope = this.mode === 'all' ? 'all' : 'links';
		const suffix = this.query.trim() ? ', including search-hidden results' : '';
		this.selectAllInput.setAttribute('aria-label', `Select all notes in ${scope}${suffix}`);
		this.selectAllInput.title = this.query.trim()
			? `Applies to the complete ${scope} result set, including paths hidden by search.`
			: `Applies to the complete ${scope} result set.`;
	}

	private updateDisclosure(): void {
		this.cacheDisclosureEl.textContent = 'Links may be incomplete while Obsidian finishes indexing this vault. Refresh later; Emend does not read note bodies to find links.';
		this.cacheDisclosureEl.hidden = this.mode !== 'links' || this.snapshot.linksComplete;
	}

	private updateDisabled(): void {
		if (this.closed) {
			return;
		}
		const disabled = this.disabled || this.isDisabled();
		this.searchInput.disabled = disabled;
		this.refreshButton.disabled = disabled;
		for (const button of Object.values(this.modeButtons)) {
			button.disabled = disabled;
		}
		for (const [path, input] of this.noteInputs) {
			input.disabled = disabled || path === this.targetPath;
		}
		for (const [path, input] of this.folderInputs) {
			input.disabled = disabled || this.folderDescendants(path).length === 0;
		}
		for (const button of this.folderButtons.values()) {
			button.disabled = disabled;
		}
		this.selectAllInput.disabled = disabled || this.scopePaths().length === 0;
	}

	private canInteract(): boolean {
		if (this.closed) {
			return false;
		}
		if (!this.isCurrent()) {
			this.close();
			return false;
		}
		return !this.isDisabled();
	}

	private positionPanel(): void {
		const view = this.trigger.ownerDocument.defaultView ?? window;
		const rectangle = this.trigger.getBoundingClientRect();
		const width = Math.min(360, Math.max(0, view.innerWidth - 16));
		const left = Math.max(8, Math.min(rectangle.left, view.innerWidth - width - 8));
		const belowTop = rectangle.bottom + 4;
		const belowSpace = view.innerHeight - belowTop - 8;
		const useBelow = belowSpace >= 180;
		const maxHeight = useBelow
			? Math.min(480, belowSpace)
			: Math.min(480, Math.max(0, rectangle.top - 12));
		const top = useBelow ? belowTop : Math.max(8, rectangle.top - 4 - maxHeight);
		this.panelEl.style.width = `${width}px`;
		this.panelEl.style.left = `${left}px`;
		this.panelEl.style.top = `${top}px`;
		this.panelEl.style.maxHeight = `${maxHeight}px`;
	}
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function parentFolder(path: string): string | null {
	const separator = path.lastIndexOf('/');
	return separator > 0 ? path.slice(0, separator) : null;
}

export class RelatedNotesControl {
	private triggerButton: HTMLButtonElement | null = null;
	private countEl: HTMLElement | null = null;
	private detailsHost: HTMLElement | null = null;
	private detailsEl: HTMLDetailsElement | null = null;
	private clearButton: HTMLButtonElement | null = null;
	private readonly buttons = new Set<HTMLButtonElement>();
	private readonly removeButtons = new Set<HTMLButtonElement>();
	private unsubscribe: (() => void) | null = null;
	private activeExplorer: RelatedNotesExplorer | null = null;
	private disabled = false;
	private pendingFocus: 'details' | 'trigger' | null = null;
	private generation = 0;

	constructor(
		private readonly app: App,
		private readonly store: AdditionalNotesStore,
		private readonly getTargetPath: () => string | null,
	) {}

	render(container: HTMLElement, disabled: boolean): void {
		this.destroy();
		const generation = this.generation;
		this.disabled = disabled;
		const rootEl = container.createDiv('emend-chat-related-notes');
		const triggerRowEl = rootEl.createDiv('emend-chat-related-notes-trigger-row');
		this.triggerButton = this.createButton(
			triggerRowEl,
			'emend-chat-related-notes-trigger',
			'Related notes',
			'Related notes',
		);
		this.triggerButton.setAttribute('aria-haspopup', 'dialog');
		this.triggerButton.setAttribute('aria-expanded', 'false');
		this.triggerButton.addEventListener('click', () => {
			if (generation !== this.generation || this.disabled) {
				return;
			}
			const targetPath = this.getTargetPath();
			this.closeExplorer();
			if (!targetPath) {
				return;
			}
			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (!(targetFile instanceof TFile) || !this.triggerButton) {
				return;
			}
			const snapshot = captureRelatedNotesSnapshot(this.app, targetFile);
			if (generation !== this.generation || this.getTargetPath() !== targetPath) {
				return;
			}
			const explorer = new RelatedNotesExplorer({
				app: this.app,
				store: this.store,
				targetPath,
				snapshot,
				trigger: this.triggerButton,
				isCurrent: () => generation === this.generation
					&& this.getTargetPath() === targetPath,
				isDisabled: () => this.disabled || this.getTargetPath() !== targetPath,
				onClose: (closed) => {
					if (this.activeExplorer === closed) {
						this.activeExplorer = null;
					}
				},
			});
			this.activeExplorer = explorer;
			explorer.setDisabled(this.disabled);
		});
		this.countEl = this.triggerButton.createSpan({
			cls: 'emend-chat-related-notes-count',
			text: '0',
			attr: { 'aria-hidden': 'true' },
		});
		this.detailsHost = rootEl.createDiv('emend-chat-related-notes-details-host');
		this.unsubscribe = this.store.subscribe(() => {
			this.renderPaths(generation);
			if (generation === this.generation) {
				this.activeExplorer?.updateSelection();
			}
		});
		this.renderPaths(generation);
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.updateDisabled();
	}

	destroy(): void {
		this.generation += 1;
		this.closeExplorer();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.triggerButton = null;
		this.countEl = null;
		this.detailsHost = null;
		this.detailsEl = null;
		this.clearButton = null;
		this.buttons.clear();
		this.removeButtons.clear();
		this.pendingFocus = null;
	}

	private closeExplorer(): void {
		const explorer = this.activeExplorer;
		this.activeExplorer = null;
		explorer?.close();
	}

	private renderPaths(generation: number): void {
		if (
			generation !== this.generation ||
			!this.detailsHost ||
			!this.triggerButton ||
			!this.countEl
		) {
			return;
		}
		const wasOpen = this.detailsEl?.open ?? false;
		const targetPath = this.getTargetPath();
		const paths = targetPath ? this.store.list(targetPath) : [];
		this.countEl.textContent = String(paths.length);
		this.triggerButton.setAttribute(
			'aria-label',
			paths.length > 0 ? `Related notes, ${paths.length} selected` : 'Related notes',
		);
		this.detailsHost.empty();
		this.buttons.clear();
		this.buttons.add(this.triggerButton);
		this.removeButtons.clear();
		this.clearButton = null;
		this.detailsEl = null;
		if (paths.length > 0) {
			const detailsEl = this.detailsHost.createEl('details', {
				cls: 'emend-chat-related-notes-details',
			});
			detailsEl.open = wasOpen;
			this.detailsEl = detailsEl;
			detailsEl.createEl('summary', {
				cls: 'emend-chat-related-notes-summary',
				text: 'Selected notes',
			});
			const listEl = detailsEl.createDiv('emend-chat-related-notes-list');
			for (const path of paths) {
				const itemEl = listEl.createDiv('emend-chat-related-notes-item');
				itemEl.createSpan({
					cls: 'emend-chat-related-notes-path',
					text: path,
					attr: { title: path },
				});
				const removeButton = this.createButton(
					itemEl,
					'emend-chat-related-notes-remove',
					'Remove',
					`Remove ${path}`,
				);
				this.removeButtons.add(removeButton);
				removeButton.addEventListener('click', () => {
					if (generation !== this.generation) {
						return;
					}
					const currentTargetPath = this.getTargetPath();
					if (!this.disabled && currentTargetPath) {
						this.pendingFocus = 'details';
						this.store.remove(currentTargetPath, path);
					}
				});
			}
			this.clearButton = this.createButton(
				detailsEl,
				'emend-chat-related-notes-clear',
				'Clear all',
				'Clear all related notes',
			);
			this.clearButton.addEventListener('click', () => {
				if (generation !== this.generation) {
					return;
				}
				const currentTargetPath = this.getTargetPath();
				if (!this.disabled && currentTargetPath) {
					this.pendingFocus = 'trigger';
					this.store.clear(currentTargetPath);
				}
			});
			detailsEl.createDiv({
				cls: 'emend-chat-related-notes-disclosure',
				text: 'Selected note content is sent with your next request.',
			});
		}
		this.updateDisabled();
		const pendingFocus = this.pendingFocus;
		this.pendingFocus = null;
		if (pendingFocus === 'trigger') {
			this.triggerButton.focus();
		} else if (pendingFocus === 'details') {
			const nextButton = this.removeButtons.values().next().value;
			(nextButton ?? this.clearButton ?? this.triggerButton).focus();
		}
	}

	private createButton(
		container: HTMLElement,
		className: string,
		text: string,
		label: string,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: className,
			text,
			attr: { 'aria-label': label, type: 'button' },
		});
		this.buttons.add(button);
		button.disabled = this.disabled || !this.getTargetPath();
		return button;
	}

	private updateDisabled(): void {
		const targetPath = this.getTargetPath();
		const disabled = this.disabled || !targetPath;
		for (const button of this.buttons) {
			button.disabled = disabled;
		}
		if (this.activeExplorer?.targetPath !== targetPath) {
			this.closeExplorer();
		} else {
			this.activeExplorer?.setDisabled(disabled);
		}
	}
}
