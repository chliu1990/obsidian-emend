import { describe, expect, it, vi } from 'vitest';
import {
	AdditionalNotesStore,
	type AdditionalNoteHelper,
	type AdditionalNoteHelperScope,
} from '../src/additional-notes-store';

describe('AdditionalNotesStore', () => {
	it('lists selections in insertion order and returns defensive snapshots', () => {
		const store = new AdditionalNotesStore();
		expect(store.add('A.md', 'B.md')).toBe(true);
		expect(store.add('A.md', 'C.md')).toBe(true);

		const snapshot = store.list('A.md');
		expect(snapshot).toEqual(['B.md', 'C.md']);
		(snapshot as string[]).push('D.md');

		expect(store.list('A.md')).toEqual(['B.md', 'C.md']);
	});

	it('rejects the active path and repeats without reordering selections', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');

		expect(store.add('A.md', 'A.md')).toBe(false);
		expect(store.add('A.md', 'B.md')).toBe(false);
		expect(store.list('A.md')).toEqual(['B.md', 'C.md']);
	});

	it('keeps selections for different target notes independent', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('B.md', 'C.md');

		expect(store.list('A.md')).toEqual(['B.md', 'C.md']);
		expect(store.list('B.md')).toEqual(['C.md']);
	});

	it('removes one selection and clears all selections for one target', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('B.md', 'C.md');

		store.remove('A.md', 'B.md');
		expect(store.list('A.md')).toEqual(['C.md']);
		expect(store.list('B.md')).toEqual(['C.md']);

		store.clear('A.md');
		expect(store.list('A.md')).toEqual([]);
		expect(store.list('B.md')).toEqual(['C.md']);
	});

	it('renames target keys and included paths without cross-target leakage', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'D.md');

		store.rename('A.md', 'C.md');
		store.add('B.md', 'C.md');

		expect(store.list('A.md')).toEqual([]);
		expect(store.list('B.md')).toEqual(['C.md']);
		expect(store.list('C.md')).toEqual(['B.md', 'D.md']);
		expect(store.add('C.md', 'C.md')).toBe(false);
	});

	it('removes an included path when renaming it makes it the active target', () => {
		const store = new AdditionalNotesStore();
		store.add('C.md', 'A.md');
		store.add('C.md', 'D.md');

		store.rename('A.md', 'C.md');

		expect(store.list('C.md')).toEqual(['D.md']);
	});

	it('deduplicates included-path rename collisions without reordering', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'X.md');
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('A.md', 'Y.md');

		store.rename('B.md', 'C.md');

		expect(store.list('A.md')).toEqual(['X.md', 'C.md', 'Y.md']);
	});

	it('merges target-key rename collisions and removes duplicate paths', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'shared.md');
		store.add('A.md', 'A-only.md');
		store.add('C.md', 'C-only.md');
		store.add('C.md', 'shared.md');

		store.rename('A.md', 'C.md');

		expect(store.list('A.md')).toEqual([]);
		expect(store.list('C.md')).toEqual(['shared.md', 'A-only.md', 'C-only.md']);
	});

	it('removes deleted paths and drops their own target state', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('B.md', 'C.md');

		store.removeDeleted('B.md');

		expect(store.list('A.md')).toEqual(['C.md']);
		expect(store.list('B.md')).toEqual([]);
	});

	it('drops the deleted target note\'s own selections', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('Folder/Target.md', 'C.md');
		store.add('Folder-other/Target.md', 'C.md');
		store.add('Folder/Target-other.md', 'C.md');

		store.removeDeleted('A.md');

		expect(store.list('A.md')).toEqual([]);

		store.add('A.md', 'C.md');

		expect(store.list('A.md')).toEqual(['C.md']);

		store.removeDeletedFolder('Folder');

		expect(store.list('Folder/Target.md')).toEqual([]);
		expect(store.list('Folder/Target-other.md')).toEqual([]);
		expect(store.list('Folder-other/Target.md')).toEqual(['C.md']);
	});

	it('notifies subscribers for mutations and stops after unsubscription', () => {
		const store = new AdditionalNotesStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);

		store.add('A.md', 'B.md');
		store.rename('B.md', 'C.md');
		store.removeDeleted('C.md');
		store.add('A.md', 'D.md');
		store.remove('A.md', 'D.md');
		store.add('A.md', 'E.md');
		store.clear('A.md');
		expect(listener).toHaveBeenCalledTimes(7);

		unsubscribe();
		store.add('A.md', 'F.md');
		expect(listener).toHaveBeenCalledTimes(7);
	});

	it('does not notify subscribers for no-op mutations', () => {
		const store = new AdditionalNotesStore();
		const listener = vi.fn();
		store.add('A.md', 'B.md');
		store.subscribe(listener);

		expect(store.add('A.md', 'A.md')).toBe(false);
		expect(store.add('A.md', 'B.md')).toBe(false);
		store.remove('A.md', 'missing.md');
		store.clear('missing-target.md');
		store.rename('missing.md', 'renamed.md');
		store.removeDeleted('missing.md');
		store.rename('A.md', 'A.md');

		expect(listener).not.toHaveBeenCalled();
	});
});


describe('AdditionalNotesStore provenance and refresh', () => {
	it('tracks coexisting sources without reordering and notifies only for effective additions', () => {
		const store = new AdditionalNotesStore();
		const listener = vi.fn();
		store.subscribe(listener);
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'A.md' },
		};

		expect(store.add('A.md', 'B.md')).toBe(true);
		expect(store.add('A.md', 'B.md', { type: 'all' })).toBe(true);
		expect(store.add('A.md', 'B.md', folder)).toBe(true);
		expect(store.add('A.md', 'B.md', { type: 'links', targetPath: 'A.md' })).toBe(true);
		expect(listener).toHaveBeenCalledTimes(4);
		expect(store.list('A.md')).toEqual(['B.md']);
		expect(store.listHelpers('A.md')).toEqual([
			{ type: 'all' },
			{ type: 'folder', path: 'Folder', scope: { type: 'links', targetPath: 'A.md' } },
			{ type: 'links', targetPath: 'A.md' },
		]);

		expect(store.add('A.md', 'B.md')).toBe(false);
		expect(store.add('A.md', 'B.md', { type: 'all' })).toBe(false);
		expect(store.add('A.md', 'B.md', {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'A.md' },
		})).toBe(false);
		expect(store.add('A.md', 'A.md')).toBe(false);
		expect(store.add('A.md', 'A.md', { type: 'all' })).toBe(false);
		expect(listener).toHaveBeenCalledTimes(4);

		expect(store.add('Other.md', 'B.md', { type: 'all' })).toBe(true);
		expect(listener).toHaveBeenCalledTimes(5);
		expect(store.list('Other.md')).toEqual(['B.md']);
		expect(store.listHelpers('Other.md')).toEqual([{ type: 'all' }]);
		expect(store.list('A.md')).toEqual(['B.md']);
	});

	it('defensively copies input descriptors, snapshots, and nested scopes', () => {
		const store = new AdditionalNotesStore();
		const scope: AdditionalNoteHelperScope = { type: 'links', targetPath: 'A.md' };
		const helper: AdditionalNoteHelper = { type: 'folder', path: 'Folder', scope };
		const notePaths = ['B.md'];
		store.addHelper('A.md', helper, notePaths);
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'Links.md' };
		store.add('A.md', 'C.md', links);

		helper.path = 'Mutated';
		if (helper.scope.type === 'links') {
			helper.scope.targetPath = 'Mutated.md';
		}
		scope.targetPath = 'AlsoMutated.md';
		links.targetPath = 'MutatedLinks.md';
		notePaths.push('D.md');

		const paths = store.list('A.md');
		(paths as string[]).push('E.md');
		const helpers = store.listHelpers('A.md') as AdditionalNoteHelper[];
		const firstHelper = helpers[0];
		if (!firstHelper || firstHelper.type !== 'folder' || firstHelper.scope.type !== 'links') {
			throw new Error('Expected the folder helper with a nested Links scope.');
		}
		firstHelper.path = 'SnapshotMutation';
		firstHelper.scope.targetPath = 'SnapshotMutation.md';
		helpers.pop();

		expect(store.list('A.md')).toEqual(['B.md', 'C.md']);
		expect(store.listHelpers('A.md')).toEqual([
			{ type: 'folder', path: 'Folder', scope: { type: 'links', targetPath: 'A.md' } },
			{ type: 'links', targetPath: 'Links.md' },
		]);
	});

	it('adds bulk helper sources and one descriptor with a single notification', () => {
		const store = new AdditionalNotesStore();
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'A.md' };
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'all' },
		};
		store.add('A.md', 'manual.md');
		store.addHelper('A.md', links, ['two.md', 'linked.md']);
		store.add('A.md', 'two.md');
		const listener = vi.fn();
		store.subscribe(listener);

		expect(store.addHelper('A.md', folder, [
			'one.md',
			'two.md',
			'three.md',
			'two.md',
			'A.md',
		])).toBe(true);

		expect(store.list('A.md')).toEqual([
			'manual.md',
			'two.md',
			'linked.md',
			'one.md',
			'three.md',
		]);
		expect(store.listHelpers('A.md')).toEqual([links, folder]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.addHelper('A.md', folder, ['one.md', 'two.md', 'three.md'])).toBe(false);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('records and removes an empty helper descriptor atomically', () => {
		const store = new AdditionalNotesStore();
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Empty',
			scope: { type: 'all' },
		};
		const listener = vi.fn();
		store.subscribe(listener);

		expect(store.addHelper('A.md', folder, ['A.md', 'A.md'])).toBe(true);
		expect(store.list('A.md')).toEqual([]);
		expect(store.listHelpers('A.md')).toEqual([folder]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.addHelper('A.md', folder, ['A.md'])).toBe(false);
		expect(listener).toHaveBeenCalledTimes(1);

		store.removeHelper('A.md', folder);
		expect(store.listHelpers('A.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(2);
		store.clear('A.md');
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('removes only the matching helper contribution and preserves other sources', () => {
		const store = new AdditionalNotesStore();
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'A.md' };
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'all' },
		};
		store.add('A.md', 'manual.md');
		store.add('A.md', 'shared.md');
		store.addHelper('A.md', links, ['shared.md', 'link-only.md']);
		store.addHelper('A.md', folder, ['shared.md', 'folder-only.md']);
		const listener = vi.fn();
		store.subscribe(listener);

		store.removeHelper('A.md', links);
		expect(store.list('A.md')).toEqual(['manual.md', 'shared.md', 'folder-only.md']);
		expect(store.listHelpers('A.md')).toEqual([folder]);
		expect(listener).toHaveBeenCalledTimes(1);

		store.removeHelper('A.md', { type: 'links', targetPath: 'Other.md' });
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.list('A.md')).toEqual(['manual.md', 'shared.md', 'folder-only.md']);

		store.removeHelper('A.md', folder);
		expect(store.list('A.md')).toEqual(['manual.md', 'shared.md']);
		expect(store.listHelpers('A.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('refreshes helpers in order and commits the complete rebuilt membership once', () => {
		const store = new AdditionalNotesStore();
		const all: AdditionalNoteHelper = { type: 'all' };
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'Target.md' };
		const allFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'AllFolder',
			scope: { type: 'all' },
		};
		const linksFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'LinksFolder',
			scope: { type: 'links', targetPath: 'Target.md' },
		};
		store.add('Target.md', 'manual.md');
		store.addHelper('Target.md', all, ['stale-all.md', 'shared.md']);
		store.addHelper('Target.md', links, ['stale-links.md', 'shared.md']);
		store.addHelper('Target.md', allFolder, ['stale-folder.md', 'shared.md']);
		store.addHelper('Target.md', linksFolder, ['stale-links-folder.md']);
		const initialPaths = [
			'manual.md',
			'stale-all.md',
			'shared.md',
			'stale-links.md',
			'stale-folder.md',
			'stale-links-folder.md',
		];
		const initialHelpers = [all, links, allFolder, linksFolder];
		const calls: AdditionalNoteHelper[] = [];
		const listener = vi.fn();
		store.subscribe(listener);
		const resolve = (helper: AdditionalNoteHelper, paths: readonly string[]): readonly string[] => {
			calls.push(helper);
			expect(store.list('Target.md')).toEqual(initialPaths);
			expect(store.listHelpers('Target.md')).toEqual(initialHelpers);
			return paths;
		};

		store.refresh('Target.md', (helper) => {
			switch (helper.type) {
				case 'all':
					return resolve(helper, ['shared.md', 'all-new.md', 'Target.md', 'all-new.md']);
				case 'links':
					return resolve(helper, ['link-new.md', 'shared.md', 'link-new.md']);
				case 'folder':
					if (helper.path === 'AllFolder') {
						return resolve(helper, ['folder-new.md', 'shared.md']);
					}
					return resolve(helper, ['Target.md', 'links-folder-new.md', 'all-new.md']);
			}
		});

		expect(calls).toEqual([all, links, allFolder, linksFolder]);
		expect(store.list('Target.md')).toEqual([
			'manual.md',
			'shared.md',
			'all-new.md',
			'link-new.md',
			'folder-new.md',
			'links-folder-new.md',
		]);
		expect(store.listHelpers('Target.md')).toEqual(initialHelpers);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('restores an individually removed path on refresh but never reruns removed helpers', () => {
		const store = new AdditionalNotesStore();
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'all' },
		};
		store.addHelper('A.md', folder, ['B.md', 'C.md']);
		store.remove('A.md', 'B.md');
		expect(store.list('A.md')).toEqual(['C.md']);
		expect(store.listHelpers('A.md')).toEqual([folder]);
		const listener = vi.fn();
		store.subscribe(listener);

		store.refresh('A.md', () => ['B.md', 'C.md']);
		expect(store.list('A.md')).toEqual(['C.md', 'B.md']);
		expect(listener).toHaveBeenCalledTimes(1);

		store.removeHelper('A.md', folder);
		expect(listener).toHaveBeenCalledTimes(2);
		const resolver = vi.fn(() => ['B.md']);
		store.refresh('A.md', resolver);
		expect(resolver).not.toHaveBeenCalled();
		expect(store.list('A.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('preserves manual paths without helpers and does not notify for an unchanged refresh', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'manual.md');
		const resolver = vi.fn(() => ['unexpected.md']);
		const listener = vi.fn();
		store.subscribe(listener);

		store.refresh('A.md', resolver);
		expect(resolver).not.toHaveBeenCalled();
		expect(store.list('A.md')).toEqual(['manual.md']);
		expect(listener).not.toHaveBeenCalled();

		store.addHelper('A.md', { type: 'all' }, ['manual.md', 'helper.md']);
		listener.mockClear();
		store.refresh('A.md', () => ['helper.md', 'manual.md', 'manual.md', 'A.md']);
		expect(store.list('A.md')).toEqual(['manual.md', 'helper.md']);
		expect(listener).not.toHaveBeenCalled();
	});

	it('leaves membership, helpers, and notifications unchanged when a resolver throws', () => {
		const store = new AdditionalNotesStore();
		const all: AdditionalNoteHelper = { type: 'all' };
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'A.md' };
		store.add('A.md', 'manual.md');
		store.addHelper('A.md', all, ['old-all.md']);
		store.addHelper('A.md', links, ['old-links.md']);
		const listener = vi.fn();
		store.subscribe(listener);
		const laterResolver = vi.fn(() => ['later.md']);

		expect(() => store.refresh('A.md', (helper) => {
			if (helper.type === 'all') {
				return ['new-all.md'];
			}
			if (helper.type === 'links') {
				throw new Error('Resolver failed.');
			}
			return laterResolver();
		})).toThrow('Resolver failed.');

		expect(laterResolver).not.toHaveBeenCalled();
		expect(store.list('A.md')).toEqual(['manual.md', 'old-all.md', 'old-links.md']);
		expect(store.listHelpers('A.md')).toEqual([all, links]);
		expect(listener).not.toHaveBeenCalled();
	});

	it('renames Links provenance and merges target collisions in stable order', () => {
		const store = new AdditionalNotesStore();
		const originalLinks: AdditionalNoteHelper = { type: 'links', targetPath: 'Links.md' };
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'Links.md' },
		};
		store.addHelper('A.md', originalLinks, ['shared.md', 'A-only.md']);
		store.add('A.md', 'shared.md');
		store.addHelper('A.md', folder, ['folder.md']);
		store.addHelper('C.md', originalLinks, ['C-only.md', 'shared.md']);

		store.rename('Links.md', 'RenamedLinks.md');
		expect(store.listHelpers('A.md')).toEqual([
			{ type: 'links', targetPath: 'RenamedLinks.md' },
			{
				type: 'folder',
				path: 'Folder',
				scope: { type: 'links', targetPath: 'RenamedLinks.md' },
			},
		]);

		store.rename('A.md', 'C.md');
		expect(store.list('A.md')).toEqual([]);
		expect(store.list('C.md')).toEqual(['shared.md', 'A-only.md', 'folder.md', 'C-only.md']);
		expect(store.listHelpers('C.md')).toEqual([
			{ type: 'links', targetPath: 'RenamedLinks.md' },
			{
				type: 'folder',
				path: 'Folder',
				scope: { type: 'links', targetPath: 'RenamedLinks.md' },
			},
		]);
	});

	it('merges provenance for selected-path collisions and excludes a renamed active path', () => {
		const store = new AdditionalNotesStore();
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'Links.md' };
		store.add('A.md', 'old.md');
		store.addHelper('A.md', links, ['new.md']);
		store.rename('old.md', 'new.md');
		expect(store.list('A.md')).toEqual(['new.md']);
		store.removeHelper('A.md', links);
		expect(store.list('A.md')).toEqual(['new.md']);

		store.addHelper('C.md', { type: 'all' }, ['B.md']);
		store.rename('B.md', 'C.md');
		expect(store.list('C.md')).toEqual([]);
		expect(store.listHelpers('C.md')).toEqual([{ type: 'all' }]);
	});

	it('deduplicates Links helpers that rename into structural equality', () => {
		const store = new AdditionalNotesStore();
		store.addHelper('A.md', { type: 'links', targetPath: 'X.md' }, ['X-only.md']);
		store.addHelper('A.md', { type: 'links', targetPath: 'Y.md' }, ['Y-only.md']);

		store.rename('X.md', 'Y.md');
		expect(store.list('A.md')).toEqual(['X-only.md', 'Y-only.md']);
		expect(store.listHelpers('A.md')).toEqual([{ type: 'links', targetPath: 'Y.md' }]);

		store.removeHelper('A.md', { type: 'links', targetPath: 'Y.md' });
		expect(store.list('A.md')).toEqual([]);
	});

	it('renames nested folder targets, descendants, descriptors, and Links targets segment-aware', () => {
		const store = new AdditionalNotesStore();
		const folder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder/nested',
			scope: { type: 'links', targetPath: 'Folder/nested/Target.md' },
		};
		const links: AdditionalNoteHelper = {
			type: 'links',
			targetPath: 'Folder/nested/Target.md',
		};
		store.addHelper('Folder/nested/Target.md', folder, [
			'Folder/nested/note.md',
			'Folder-other/keep.md',
		]);
		store.addHelper('Folder/nested/Target.md', links, ['Folder/link.md']);

		store.renameFolder('Folder', 'Renamed');

		expect(store.list('Folder/nested/Target.md')).toEqual([]);
		expect(store.list('Renamed/nested/Target.md')).toEqual([
			'Renamed/nested/note.md',
			'Folder-other/keep.md',
			'Renamed/link.md',
		]);
		expect(store.listHelpers('Renamed/nested/Target.md')).toEqual([
			{
				type: 'folder',
				path: 'Renamed/nested',
				scope: { type: 'links', targetPath: 'Renamed/nested/Target.md' },
			},
			{ type: 'links', targetPath: 'Renamed/nested/Target.md' },
		]);
	});

	it('deduplicates converging folder descriptors without merging different scopes', () => {
		const store = new AdditionalNotesStore();
		store.addHelper('A.md', { type: 'folder', path: 'Old', scope: { type: 'all' } }, ['old.md']);
		store.addHelper('A.md', {
			type: 'folder',
			path: 'Existing',
			scope: { type: 'links', targetPath: 'Links.md' },
		}, ['linked.md']);
		store.addHelper('A.md', {
			type: 'folder',
			path: 'Existing',
			scope: { type: 'all' },
		}, ['existing.md']);

		store.renameFolder('Old', 'Existing');
		expect(store.list('A.md')).toEqual(['old.md', 'linked.md', 'existing.md']);
		expect(store.listHelpers('A.md')).toEqual([
			{ type: 'folder', path: 'Existing', scope: { type: 'all' } },
			{ type: 'folder', path: 'Existing', scope: { type: 'links', targetPath: 'Links.md' } },
		]);
	});

	it('removes deleted file paths and invalid Links provenance without cross-target leakage', () => {
		const store = new AdditionalNotesStore();
		const invalidLinks: AdditionalNoteHelper = { type: 'links', targetPath: 'B.md' };
		const validLinks: AdditionalNoteHelper = { type: 'links', targetPath: 'Other.md' };
		const invalidFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Invalid',
			scope: { type: 'links', targetPath: 'B.md' },
		};
		const validFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Valid',
			scope: { type: 'all' },
		};
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.addHelper('A.md', invalidLinks, ['link-invalid.md']);
		store.addHelper('A.md', validLinks, ['link-valid.md']);
		store.addHelper('A.md', invalidFolder, ['folder-invalid.md']);
		store.addHelper('A.md', validFolder, ['folder-valid.md']);
		store.add('B.md', 'C.md');
		store.addHelper('B.md', invalidLinks, ['self-link.md']);
		const listener = vi.fn();
		store.subscribe(listener);

		store.removeDeleted('B.md');

		expect(store.list('A.md')).toEqual(['C.md', 'link-valid.md', 'folder-valid.md']);
		expect(store.listHelpers('A.md')).toEqual([validLinks, validFolder]);
		expect(store.list('B.md')).toEqual([]);
		expect(store.listHelpers('B.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(1);
		store.removeDeleted('B.md');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('removes deleted folder descendants and affected descriptors without cross-target leakage', () => {
		const store = new AdditionalNotesStore();
		const all: AdditionalNoteHelper = { type: 'all' };
		const deletedFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder/Sub',
			scope: { type: 'all' },
		};
		const retainedFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder-other',
			scope: { type: 'all' },
		};
		const invalidScopedFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Outside',
			scope: { type: 'links', targetPath: 'Folder/Link.md' },
		};
		const invalidLinks: AdditionalNoteHelper = {
			type: 'links',
			targetPath: 'Folder/Link.md',
		};
		const validLinks: AdditionalNoteHelper = { type: 'links', targetPath: 'Outside.md' };
		store.add('Target.md', 'Folder/A.md');
		store.add('Target.md', 'Folder-other/Keep.md');
		store.add('Target.md', 'Outside.md');
		store.addHelper('Target.md', all, ['all.md']);
		store.addHelper('Target.md', deletedFolder, ['deleted-helper.md']);
		store.addHelper('Target.md', retainedFolder, ['retained-helper.md']);
		store.addHelper('Target.md', invalidScopedFolder, ['invalid-scope.md']);
		store.addHelper('Target.md', invalidLinks, ['invalid-link.md']);
		store.addHelper('Target.md', validLinks, ['valid-link.md']);
		store.add('Outside.md', 'Folder/B.md');
		store.add('Outside.md', 'Folder-other/Safe.md');
		const listener = vi.fn();
		store.subscribe(listener);

		store.removeDeletedFolder('Folder');

		expect(store.list('Target.md')).toEqual([
			'Folder-other/Keep.md',
			'Outside.md',
			'all.md',
			'retained-helper.md',
			'valid-link.md',
		]);
		expect(store.listHelpers('Target.md')).toEqual([all, retainedFolder, validLinks]);
		expect(store.list('Outside.md')).toEqual(['Folder-other/Safe.md']);
		expect(listener).toHaveBeenCalledTimes(1);
		store.removeDeletedFolder('Folder');
		store.renameFolder('Folder', 'Folder');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('renames the root folder across target keys, paths, descriptors, and Links scopes', () => {
		const store = new AdditionalNotesStore();
		const rootFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: '/',
			scope: { type: 'all' },
		};
		const nestedFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'Links.md' },
		};
		const links: AdditionalNoteHelper = { type: 'links', targetPath: 'Links.md' };
		store.addHelper('Target.md', rootFolder, ['Root.md', 'Folder/Nested.md']);
		store.addHelper('Target.md', nestedFolder, ['Folder/Linked.md']);
		store.addHelper('Target.md', links, ['Linked.md']);

		store.renameFolder('/', 'Renamed');

		expect(store.list('Target.md')).toEqual([]);
		expect(store.list('Renamed/Target.md')).toEqual([
			'Renamed/Root.md',
			'Renamed/Folder/Nested.md',
			'Renamed/Folder/Linked.md',
			'Renamed/Linked.md',
		]);
		expect(store.listHelpers('Renamed/Target.md')).toEqual([
			{ type: 'folder', path: 'Renamed', scope: { type: 'all' } },
			{
				type: 'folder',
				path: 'Renamed/Folder',
				scope: { type: 'links', targetPath: 'Renamed/Links.md' },
			},
			{ type: 'links', targetPath: 'Renamed/Links.md' },
		]);
		expect(store.list('Renamed/Target.md').every((path) => !path.includes('//'))).toBe(true);
	});

	it('deletes root descendants and invalid provenance while retaining target-keyed All helpers', () => {
		const store = new AdditionalNotesStore();
		const all: AdditionalNoteHelper = { type: 'all' };
		const rootFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: '/',
			scope: { type: 'all' },
		};
		const scopedFolder: AdditionalNoteHelper = {
			type: 'folder',
			path: 'Outside',
			scope: { type: 'links', targetPath: 'Links.md' },
		};
		store.addHelper('Target.md', all, ['All.md']);
		store.addHelper('Target.md', rootFolder, ['Root.md']);
		store.addHelper('Target.md', scopedFolder, ['Scoped.md']);
		store.addHelper('Target.md', { type: 'links', targetPath: 'Links.md' }, ['Linked.md']);
		store.add('Folder/Target.md', 'Folder/Nested.md');
		store.addHelper('Folder/Target.md', all, ['Other.md']);
		const listener = vi.fn();
		store.subscribe(listener);

		store.removeDeletedFolder('/');

		expect(store.list('Target.md')).toEqual([]);
		expect(store.listHelpers('Target.md')).toEqual([]);
		expect(store.list('Folder/Target.md')).toEqual([]);
		expect(store.listHelpers('Folder/Target.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(1);
		store.removeDeletedFolder('/');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('clears paths and helpers together and canonicalizes empty target state', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'manual.md');
		store.addHelper('A.md', { type: 'all' }, ['helper.md']);
		const listener = vi.fn();
		store.subscribe(listener);

		store.clear('A.md');
		expect(store.list('A.md')).toEqual([]);
		expect(store.listHelpers('A.md')).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(1);
		store.clear('A.md');
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
