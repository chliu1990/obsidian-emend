import type { App, TFile } from 'obsidian';
import type { AdditionalNoteHelper } from './additional-notes-store';

export interface RelatedNotesSnapshot {
	targetPath: string;
	allPaths: readonly string[];
	linkedPaths: readonly string[];
	linksComplete: boolean;
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isWithinFolder(path: string, folderPath: string): boolean {
	return folderPath === '/'
		? path !== '/'
		: path.startsWith(`${folderPath}/`);
}

function resolveScopePaths(
	snapshot: RelatedNotesSnapshot,
	scope: { type: 'all' } | { type: 'links'; targetPath: string },
): readonly string[] {
	if (scope.type === 'all') {
		return snapshot.allPaths;
	}
	return scope.targetPath === snapshot.targetPath ? snapshot.linkedPaths : [];
}

export function captureRelatedNotesSnapshot(
	app: App,
	targetFile: TFile,
): RelatedNotesSnapshot {
	const files = app.vault.getMarkdownFiles();
	const targetPath = targetFile.path;
	const currentPaths = new Set(files.map((file) => file.path));
	const allPaths = [...currentPaths]
		.filter((path) => path !== targetPath)
		.sort(comparePaths);
	const linkedPaths = new Set<string>();
	const resolvedLinks = app.metadataCache.resolvedLinks as
		Record<string, Record<string, number>> | null | undefined;
	if (resolvedLinks) {
		for (const path of Object.keys(resolvedLinks[targetPath] ?? {})) {
			if (path !== targetPath && currentPaths.has(path)) {
				linkedPaths.add(path);
			}
		}
		for (const file of files) {
			if (file.path !== targetPath && Object.prototype.hasOwnProperty.call(
				resolvedLinks[file.path] ?? {},
				targetPath,
			)) {
				linkedPaths.add(file.path);
			}
		}
	}
	const linksComplete = resolvedLinks != null
		&& app.metadataCache.getFileCache(targetFile) !== null
		&& files.every((file) => file.path === targetPath
			|| app.metadataCache.getFileCache(file) !== null);

	return {
		targetPath,
		allPaths,
		linkedPaths: [...linkedPaths].sort(comparePaths),
		linksComplete,
	};
}

export function resolveAdditionalNoteHelper(
	snapshot: RelatedNotesSnapshot,
	helper: AdditionalNoteHelper,
): readonly string[] {
	if (helper.type === 'folder') {
		return resolveScopePaths(snapshot, helper.scope)
			.filter((path) => isWithinFolder(path, helper.path));
	}
	return [...resolveScopePaths(snapshot, helper)];
}

export function getRelatedFolderPaths(
	paths: readonly string[],
): readonly string[] {
	const folders = new Set<string>();
	for (const path of paths) {
		let separator = path.lastIndexOf('/');
		while (separator > 0) {
			folders.add(path.slice(0, separator));
			separator = path.lastIndexOf('/', separator - 1);
		}
	}
	return [...folders].sort(comparePaths);
}
