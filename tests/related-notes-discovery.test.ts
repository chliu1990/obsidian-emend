import { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
	captureRelatedNotesSnapshot,
	getRelatedFolderPaths,
	resolveAdditionalNoteHelper,
	type RelatedNotesSnapshot,
} from '../src/related-notes-discovery';

function file(path: string): TFile {
	const result = new TFile();
	result.path = path;
	return result;
}

function createApp(
	files: readonly TFile[],
	resolvedLinks: Record<string, Record<string, number>> | undefined,
	cachedPaths: ReadonlySet<string>,
) {
	const read = vi.fn();
	const adapterRead = vi.fn();
	const getMarkdownFiles = vi.fn(() => [...files]);
	const getFileCache = vi.fn((candidate: TFile) => (
		cachedPaths.has(candidate.path) ? {} : null
	));
	const on = vi.fn();
	const app = {
		vault: {
			getMarkdownFiles,
			read,
			adapter: { read: adapterRead },
		},
		metadataCache: {
			resolvedLinks,
			getFileCache,
			on,
		},
	} as unknown as App;
	return { app, read, adapterRead, getMarkdownFiles, getFileCache, on };
}

describe('captureRelatedNotesSnapshot', () => {
	it('returns sorted current Markdown paths and the resolved outgoing/incoming union without content reads', () => {
		const target = file('Target.md');
		const outgoing = file('Outgoing.md');
		const incoming = file('nested/Incoming.md');
		const bidirectional = file('Both.md');
		const unrelated = file('Unrelated.md');
		const nested = file('nested/deep/Nested.md');
		const unresolved = file('Unresolved.md');
		const attachment = file('Attachment.png');
		const files = [nested, unrelated, incoming, outgoing, target, bidirectional, unresolved];
		const resolvedLinks = {
			'Target.md': {
				'Outgoing.md': 1,
				'Both.md': 1,
				'Target.md': 2,
				'Stale.md': 1,
				[attachment.path]: 1,
			},
			'Both.md': { 'Target.md': 1 },
			'nested/Incoming.md': { 'Target.md': 1, 'Unrelated.md': 1 },
			'Stale.md': { 'Target.md': 1 },
			'Unrelated.md': { 'Outgoing.md': 1 },
		};
		const harness = createApp(files, resolvedLinks, new Set(files.map((candidate) => candidate.path)));
		Object.assign(harness.app.metadataCache, {
			unresolvedLinks: { 'Target.md': { 'Unresolved.md': 1 } },
		});

		const snapshot = captureRelatedNotesSnapshot(harness.app, target);

		expect(snapshot).toEqual({
			targetPath: 'Target.md',
			allPaths: [
				'Both.md',
				'Outgoing.md',
				'Unrelated.md',
				'Unresolved.md',
				'nested/Incoming.md',
				'nested/deep/Nested.md',
			],
			linkedPaths: ['Both.md', 'Outgoing.md', 'nested/Incoming.md'],
			linksComplete: true,
		});
		expect(harness.getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(harness.read).not.toHaveBeenCalled();
		expect(harness.adapterRead).not.toHaveBeenCalled();
		expect(harness.on).not.toHaveBeenCalled();
	});

	it('treats a cached target without an outgoing-link entry as complete', () => {
		const target = file('Target.md');
		const source = file('Source.md');
		const files = [target, source];
		const harness = createApp(files, {}, new Set(['Target.md', 'Source.md']));

		const snapshot = captureRelatedNotesSnapshot(harness.app, target);

		expect(snapshot.linkedPaths).toEqual([]);
		expect(snapshot.linksComplete).toBe(true);
	});

	it.each(['Target.md', 'nested/Incoming.md', 'Unrelated.md'])(
		'keeps partial links but reports incomplete metadata when %s is uncached',
		(uncachedPath) => {
			const target = file('Target.md');
			const outgoing = file('Outgoing.md');
			const incoming = file('nested/Incoming.md');
			const unrelated = file('Unrelated.md');
			const files = [target, outgoing, incoming, unrelated];
			const cachedPaths = new Set(
				files.map((candidate) => candidate.path).filter((path) => path !== uncachedPath),
			);
			const harness = createApp(files, {
				'Target.md': { 'Outgoing.md': 1 },
				'nested/Incoming.md': { 'Target.md': 1 },
			}, cachedPaths);

			const snapshot = captureRelatedNotesSnapshot(harness.app, target);

			expect(snapshot.linkedPaths).toEqual(['Outgoing.md', 'nested/Incoming.md']);
			expect(snapshot.linksComplete).toBe(false);
		},
	);

	it('reports absent resolved-link metadata as incomplete', () => {
		const target = file('Target.md');
		const files = [target, file('Source.md')];
		const harness = createApp(files, undefined, new Set(['Target.md', 'Source.md']));

		const snapshot = captureRelatedNotesSnapshot(harness.app, target);

		expect(snapshot.linkedPaths).toEqual([]);
		expect(snapshot.linksComplete).toBe(false);
	});
});

describe('resolveAdditionalNoteHelper', () => {
	const snapshot: RelatedNotesSnapshot = {
		targetPath: 'Target.md',
		allPaths: [
			'Alpha/Nested/Two.md',
			'Alpha/One.md',
			'Alpha-other/Three.md',
			'Root.md',
			'Unrelated/Four.md',
		],
		linkedPaths: ['Alpha/One.md', 'Root.md'],
		linksComplete: true,
	};

	it('returns defensive All and matching Links snapshots', () => {
		const all = resolveAdditionalNoteHelper(snapshot, { type: 'all' });
		const links = resolveAdditionalNoteHelper(snapshot, {
			type: 'links',
			targetPath: 'Target.md',
		});

		expect(all).toEqual(snapshot.allPaths);
		expect(all).not.toBe(snapshot.allPaths);
		expect(links).toEqual(snapshot.linkedPaths);
		expect(links).not.toBe(snapshot.linkedPaths);
		(all as string[]).push('Injected.md');
		(links as string[]).push('Injected.md');
		expect(snapshot.allPaths).not.toContain('Injected.md');
		expect(snapshot.linkedPaths).not.toContain('Injected.md');
	});

	it('filters exact folder descendants within the selected All or Links scope', () => {
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: 'Alpha',
			scope: { type: 'all' },
		})).toEqual(['Alpha/Nested/Two.md', 'Alpha/One.md']);
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: 'Alpha',
			scope: { type: 'links', targetPath: 'Target.md' },
		})).toEqual(['Alpha/One.md']);
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: 'Alpha-other',
			scope: { type: 'links', targetPath: 'Target.md' },
		})).toEqual([]);
	});

	it('resolves the root folder against every path in the selected scope', () => {
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: '/',
			scope: { type: 'all' },
		})).toEqual(snapshot.allPaths);
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: '/',
			scope: { type: 'links', targetPath: 'Target.md' },
		})).toEqual(snapshot.linkedPaths);
	});

	it('fails closed for Links helpers and Links-scoped folders from another target', () => {
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'links',
			targetPath: 'Other.md',
		})).toEqual([]);
		expect(resolveAdditionalNoteHelper(snapshot, {
			type: 'folder',
			path: '/',
			scope: { type: 'links', targetPath: 'Other.md' },
		})).toEqual([]);
	});
});

describe('getRelatedFolderPaths', () => {
	it('returns sorted unique implied ancestors without root or empty folders', () => {
		expect(getRelatedFolderPaths([
			'Root.md',
			'z/Last.md',
			'Alpha/One.md',
			'Alpha/Nested/Two.md',
			'Alpha/Nested/Three.md',
			'Alpha-other/Other.md',
		])).toEqual(['Alpha', 'Alpha-other', 'Alpha/Nested', 'z']);
	});
});
