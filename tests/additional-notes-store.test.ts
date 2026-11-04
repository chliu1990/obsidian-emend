import { describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';

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

	it('removes deleted paths while retaining their own target state', () => {
		const store = new AdditionalNotesStore();
		store.add('A.md', 'B.md');
		store.add('A.md', 'C.md');
		store.add('B.md', 'C.md');

		store.removeDeleted('B.md');

		expect(store.list('A.md')).toEqual(['C.md']);
		expect(store.list('B.md')).toEqual(['C.md']);
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
