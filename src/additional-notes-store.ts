export type AdditionalNoteHelperScope =
	| { type: 'all' }
	| { type: 'links'; targetPath: string };

export type AdditionalNoteHelper =
	| { type: 'all' }
	| { type: 'links'; targetPath: string }
	| { type: 'folder'; path: string; scope: AdditionalNoteHelperScope };

export type AdditionalNoteSource = { type: 'manual' } | AdditionalNoteHelper;

type AdditionalNoteEntry = {
	path: string;
	sources: AdditionalNoteSource[];
};

type AdditionalNoteTargetState = {
	entries: AdditionalNoteEntry[];
	helpers: AdditionalNoteHelper[];
};

function cloneScope(scope: AdditionalNoteHelperScope): AdditionalNoteHelperScope {
	return scope.type === 'all'
		? { type: 'all' }
		: { type: 'links', targetPath: scope.targetPath };
}

function cloneHelper(helper: AdditionalNoteHelper): AdditionalNoteHelper {
	switch (helper.type) {
		case 'all':
			return { type: 'all' };
		case 'links':
			return { type: 'links', targetPath: helper.targetPath };
		case 'folder':
			return { type: 'folder', path: helper.path, scope: cloneScope(helper.scope) };
	}
}

function cloneSource(source: AdditionalNoteSource): AdditionalNoteSource {
	return source.type === 'manual' ? { type: 'manual' } : cloneHelper(source);
}

function scopesEqual(left: AdditionalNoteHelperScope, right: AdditionalNoteHelperScope): boolean {
	if (left.type === 'all' || right.type === 'all') {
		return left.type === right.type;
	}
	return left.targetPath === right.targetPath;
}

function helpersEqual(left: AdditionalNoteHelper, right: AdditionalNoteHelper): boolean {
	switch (left.type) {
		case 'all':
			return right.type === 'all';
		case 'links':
			return right.type === 'links' && left.targetPath === right.targetPath;
		case 'folder':
			return right.type === 'folder'
				&& left.path === right.path
				&& scopesEqual(left.scope, right.scope);
	}
}

function sourcesEqual(left: AdditionalNoteSource, right: AdditionalNoteSource): boolean {
	if (left.type === 'manual' || right.type === 'manual') {
		return left.type === right.type;
	}
	return helpersEqual(left, right);
}

function helperKey(helper: AdditionalNoteHelper): string {
	switch (helper.type) {
		case 'all':
			return 'all';
		case 'links':
			return JSON.stringify(['links', helper.targetPath]);
		case 'folder':
			return JSON.stringify([
				'folder',
				helper.path,
				helper.scope.type,
				helper.scope.type === 'links' ? helper.scope.targetPath : null,
			]);
	}
}

function hasSource(entry: AdditionalNoteEntry, source: AdditionalNoteSource): boolean {
	return entry.sources.some((candidate) => sourcesEqual(candidate, source));
}

function hasHelper(state: AdditionalNoteTargetState, helper: AdditionalNoteHelper): boolean {
	return state.helpers.some((candidate) => helpersEqual(candidate, helper));
}

function cloneState(state: AdditionalNoteTargetState): AdditionalNoteTargetState {
	return {
		entries: state.entries.map((entry) => ({
			path: entry.path,
			sources: entry.sources.map(cloneSource),
		})),
		helpers: state.helpers.map(cloneHelper),
	};
}

function emptyState(): AdditionalNoteTargetState {
	return { entries: [], helpers: [] };
}

function isEmptyState(state: AdditionalNoteTargetState): boolean {
	return state.entries.length === 0 && state.helpers.length === 0;
}

function entriesEqual(left: readonly AdditionalNoteEntry[], right: readonly AdditionalNoteEntry[]): boolean {
	return left.length === right.length && left.every((entry, index) => {
		const other = right[index];
		return other !== undefined
			&& entry.path === other.path
			&& entry.sources.length === other.sources.length
			&& entry.sources.every((source, sourceIndex) => {
				const otherSource = other.sources[sourceIndex];
				return otherSource !== undefined && sourcesEqual(source, otherSource);
			});
	});
}

function statesEqual(left: AdditionalNoteTargetState, right: AdditionalNoteTargetState): boolean {
	return entriesEqual(left.entries, right.entries)
		&& left.helpers.length === right.helpers.length
		&& left.helpers.every((helper, index) => {
			const other = right.helpers[index];
			return other !== undefined && helpersEqual(helper, other);
		});
}

function mapSource(
	source: AdditionalNoteSource,
	mapPath: (path: string) => string,
): AdditionalNoteSource {
	switch (source.type) {
		case 'manual':
			return { type: 'manual' };
		case 'all':
			return { type: 'all' };
		case 'links':
			return { type: 'links', targetPath: mapPath(source.targetPath) };
		case 'folder':
			return {
				type: 'folder',
				path: mapPath(source.path),
				scope: source.scope.type === 'all'
					? { type: 'all' }
					: { type: 'links', targetPath: mapPath(source.scope.targetPath) },
			};
	}
}

function isWithinFolder(path: string, folderPath: string): boolean {
	return folderPath === '/' || path === folderPath || path.startsWith(`${folderPath}/`);
}

function mapFolderPath(path: string, oldPath: string, newPath: string): string {
	if (!isWithinFolder(path, oldPath)) {
		return path;
	}
	if (oldPath === '/') {
		if (path === '/' || newPath === '/') {
			return newPath === '/' ? path : newPath;
		}
		return `${newPath}/${path}`;
	}
	const suffix = path.slice(oldPath.length);
	if (newPath === '/') {
		return suffix ? suffix.slice(1) : '/';
	}
	return `${newPath}${suffix}`;
}

export class AdditionalNotesStore {
	private selections = new Map<string, AdditionalNoteTargetState>();
	private readonly listeners = new Set<() => void>();

	list(targetPath: string): readonly string[] {
		return (this.selections.get(targetPath)?.entries ?? []).map((entry) => entry.path);
	}

	listHelpers(targetPath: string): readonly AdditionalNoteHelper[] {
		return (this.selections.get(targetPath)?.helpers ?? []).map(cloneHelper);
	}

	add(
		targetPath: string,
		notePath: string,
		source: AdditionalNoteSource = { type: 'manual' },
	): boolean {
		if (targetPath === notePath) {
			return false;
		}
		const next = cloneState(this.selections.get(targetPath) ?? emptyState());
		const entriesByPath = new Map(next.entries.map((entry) => [entry.path, entry]));
		let changed = this.addSource(next, targetPath, notePath, source, entriesByPath);
		if (source.type !== 'manual' && !hasHelper(next, source)) {
			next.helpers.push(cloneHelper(source));
			changed = true;
		}
		if (!changed) {
			return false;
		}
		this.selections.set(targetPath, next);
		this.notify();
		return true;
	}

	addHelper(
		targetPath: string,
		helper: AdditionalNoteHelper,
		notePaths: readonly string[],
	): boolean {
		const next = cloneState(this.selections.get(targetPath) ?? emptyState());
		let changed = false;
		if (!hasHelper(next, helper)) {
			next.helpers.push(cloneHelper(helper));
			changed = true;
		}
		const entriesByPath = new Map(next.entries.map((entry) => [entry.path, entry]));
		for (const notePath of notePaths) {
			changed = this.addSource(next, targetPath, notePath, helper, entriesByPath) || changed;
		}
		if (!changed) {
			return false;
		}
		this.selections.set(targetPath, next);
		this.notify();
		return true;
	}

	remove(targetPath: string, notePath: string): void {
		const current = this.selections.get(targetPath);
		if (!current?.entries.some((entry) => entry.path === notePath)) {
			return;
		}
		const next = cloneState(current);
		next.entries = next.entries.filter((entry) => entry.path !== notePath);
		this.commit(targetPath, next);
		this.notify();
	}

	removeHelper(targetPath: string, helper: AdditionalNoteHelper): void {
		const current = this.selections.get(targetPath);
		if (!current || !hasHelper(current, helper)) {
			return;
		}
		const next = cloneState(current);
		next.helpers = next.helpers.filter((candidate) => !helpersEqual(candidate, helper));
		for (const entry of next.entries) {
			entry.sources = entry.sources.filter((source) => (
				source.type === 'manual' || !helpersEqual(source, helper)
			));
		}
		next.entries = next.entries.filter((entry) => entry.sources.length > 0);
		this.commit(targetPath, next);
		this.notify();
	}

	refresh(
		targetPath: string,
		resolve: (helper: AdditionalNoteHelper) => readonly string[],
	): void {
		const current = this.selections.get(targetPath);
		if (!current || current.helpers.length === 0) {
			return;
		}
		const resolutions = current.helpers.map((helper) => {
			const resolved = resolve(cloneHelper(helper));
			const paths: string[] = [];
			const seen = new Set<string>();
			for (const path of resolved) {
				if (path !== targetPath && !seen.has(path)) {
					seen.add(path);
					paths.push(path);
				}
			}
			return paths;
		});

		const resolutionSets = resolutions.map((paths) => new Set(paths));
		const helperIndices = new Map(current.helpers.map((helper, index) => [helperKey(helper), index]));
		const entries: AdditionalNoteEntry[] = [];
		const entriesByPath = new Map<string, AdditionalNoteEntry>();
		for (const entry of current.entries) {
			const sources = entry.sources.filter((source) => {
				if (source.type === 'manual') {
					return true;
				}
				const helperIndex = helperIndices.get(helperKey(source));
				return helperIndex !== undefined && resolutionSets[helperIndex]?.has(entry.path) === true;
			}).map(cloneSource);
			if (sources.length > 0) {
				const nextEntry = { path: entry.path, sources };
				entries.push(nextEntry);
				entriesByPath.set(nextEntry.path, nextEntry);
			}
		}
		current.helpers.forEach((helper, helperIndex) => {
			for (const path of resolutions[helperIndex] ?? []) {
				let entry = entriesByPath.get(path);
				if (!entry) {
					entry = { path, sources: [] };
					entries.push(entry);
					entriesByPath.set(path, entry);
				}
				if (!hasSource(entry, helper)) {
					entry.sources.push(cloneHelper(helper));
				}
			}
		});
		if (entriesEqual(current.entries, entries)) {
			return;
		}
		this.selections.set(targetPath, { entries, helpers: current.helpers.map(cloneHelper) });
		this.notify();
	}

	clear(targetPath: string): void {
		if (this.selections.delete(targetPath)) {
			this.notify();
		}
	}

	rename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}
		this.remap((path) => path === oldPath ? newPath : path);
	}

	renameFolder(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}
		this.remap((path) => mapFolderPath(path, oldPath, newPath));
	}

	removeDeleted(notePath: string): void {
		this.removeInvalid(
			(path) => path === notePath,
			(helper) => this.hasDeletedLinksTarget(helper, (path) => path === notePath),
		);
	}

	removeDeletedFolder(path: string): void {
		this.removeInvalid(
			(candidate) => isWithinFolder(candidate, path),
			(helper) => (helper.type === 'folder' && isWithinFolder(helper.path, path))
				|| this.hasDeletedLinksTarget(helper, (candidate) => isWithinFolder(candidate, path)),
		);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private addSource(
		state: AdditionalNoteTargetState,
		targetPath: string,
		notePath: string,
		source: AdditionalNoteSource,
		entriesByPath: Map<string, AdditionalNoteEntry>,
	): boolean {
		if (targetPath === notePath) {
			return false;
		}
		let entry = entriesByPath.get(notePath);
		if (!entry) {
			entry = { path: notePath, sources: [] };
			state.entries.push(entry);
			entriesByPath.set(notePath, entry);
		}
		if (hasSource(entry, source)) {
			return false;
		}
		entry.sources.push(cloneSource(source));
		return true;
	}

	private commit(targetPath: string, state: AdditionalNoteTargetState): void {
		if (isEmptyState(state)) {
			this.selections.delete(targetPath);
		} else {
			this.selections.set(targetPath, state);
		}
	}

	private remap(mapPath: (path: string) => string): void {
		const remapped = new Map<string, AdditionalNoteTargetState>();
		for (const [targetPath, state] of this.selections) {
			const renamedTarget = mapPath(targetPath);
			const next = remapped.get(renamedTarget) ?? emptyState();
			for (const entry of state.entries) {
				const renamedPath = mapPath(entry.path);
				if (renamedPath === renamedTarget) {
					continue;
				}
				let renamedEntry = next.entries.find((candidate) => candidate.path === renamedPath);
				if (!renamedEntry) {
					renamedEntry = { path: renamedPath, sources: [] };
					next.entries.push(renamedEntry);
				}
				for (const source of entry.sources) {
					const renamedSource = mapSource(source, mapPath);
					if (!hasSource(renamedEntry, renamedSource)) {
						renamedEntry.sources.push(renamedSource);
					}
				}
			}
			for (const helper of state.helpers) {
				const renamedHelper = mapSource(helper, mapPath) as AdditionalNoteHelper;
				if (!hasHelper(next, renamedHelper)) {
					next.helpers.push(renamedHelper);
				}
			}
			remapped.set(renamedTarget, next);
		}
		for (const [targetPath, state] of remapped) {
			if (isEmptyState(state)) {
				remapped.delete(targetPath);
			}
		}
		if (this.mapsEqual(this.selections, remapped)) {
			return;
		}
		this.selections = remapped;
		this.notify();
	}

	private removeInvalid(
		isDeletedPath: (path: string) => boolean,
		isInvalidHelper: (helper: AdditionalNoteHelper) => boolean,
	): void {
		const nextSelections = new Map<string, AdditionalNoteTargetState>();
		for (const [targetPath, state] of this.selections) {
			const next: AdditionalNoteTargetState = {
				entries: [],
				helpers: state.helpers.filter((helper) => !isInvalidHelper(helper)).map(cloneHelper),
			};
			for (const entry of state.entries) {
				if (isDeletedPath(entry.path)) {
					continue;
				}
				const sources = entry.sources.filter((source) => (
					source.type === 'manual' || !isInvalidHelper(source)
				)).map(cloneSource);
				if (sources.length > 0) {
					next.entries.push({ path: entry.path, sources });
				}
			}
			if (!isEmptyState(next)) {
				nextSelections.set(targetPath, next);
			}
		}
		if (this.mapsEqual(this.selections, nextSelections)) {
			return;
		}
		this.selections = nextSelections;
		this.notify();
	}

	private hasDeletedLinksTarget(
		helper: AdditionalNoteHelper,
		isDeletedPath: (path: string) => boolean,
	): boolean {
		return (helper.type === 'links' && isDeletedPath(helper.targetPath))
			|| (helper.type === 'folder'
				&& helper.scope.type === 'links'
				&& isDeletedPath(helper.scope.targetPath));
	}

	private mapsEqual(
		left: ReadonlyMap<string, AdditionalNoteTargetState>,
		right: ReadonlyMap<string, AdditionalNoteTargetState>,
	): boolean {
		if (left.size !== right.size) {
			return false;
		}
		for (const [targetPath, state] of left) {
			const other = right.get(targetPath);
			if (!other || !statesEqual(state, other)) {
				return false;
			}
		}
		return true;
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
