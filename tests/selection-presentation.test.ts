// eslint-disable-next-line import/no-extraneous-dependencies -- CodeMirror is supplied by the Obsidian host.
import { EditorSelection, EditorState } from '@codemirror/state';
// eslint-disable-next-line import/no-extraneous-dependencies -- CodeMirror is supplied by the Obsidian host.
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
	buildSelectionDecorations,
	createSelectionPresentation,
	selectionPresentationField,
} from '../src/selection-presentation';

interface DecorationRange {
	from: number;
	to: number;
	className: string;
}

function ranges(decorations: DecorationSet, docLength = 1000): DecorationRange[] {
	const result: DecorationRange[] = [];
	decorations.between(0, docLength, (from, to, decoration) => {
		const spec = decoration.spec as { class: unknown };
		result.push({
			from,
			to,
			className: typeof spec.class === 'string' ? spec.class : '',
		});
	});
	return result;
}

function stateWith(doc: string, selection: EditorSelection) {
	return EditorState.create({
		doc,
		selection,
		extensions: [createSelectionPresentation()],
	});
}

describe('selection presentation decorations', () => {
	it('decorates the complete multiline selection with the exact class', () => {
		const doc = '# Note\n\nAlpha first line.\nAlpha second line.\nTail';
		const from = doc.indexOf('Alpha first');
		const to = doc.indexOf('\nTail');
		const state = stateWith(doc, EditorSelection.single(from, to));

		expect(ranges(state.field(selectionPresentationField), doc.length)).toEqual([
			{ from, to, className: 'emend-selection-highlight' },
		]);
	});

	it('includes reversed and multiple nonempty ranges in sorted order', () => {
		const doc = '0123456789abcdefghijABCDEFGHIJ';
		const selection = EditorSelection.create([
			EditorSelection.range(10, 5),
			EditorSelection.range(20, 25),
		]);

		expect(ranges(buildSelectionDecorations(selection), doc.length)).toEqual([
			{ from: 5, to: 10, className: 'emend-selection-highlight' },
			{ from: 20, to: 25, className: 'emend-selection-highlight' },
		]);
	});

	it('includes a nonempty whitespace-only range', () => {
		const selection = EditorSelection.single(2, 7);

		expect(ranges(buildSelectionDecorations(selection), 10)).toEqual([
			{ from: 2, to: 7, className: 'emend-selection-highlight' },
		]);
	});

	it('removes every decoration when the selection collapses', () => {
		const state = stateWith('alpha beta', EditorSelection.single(0, 5));
		const next = state.update({ selection: EditorSelection.single(4) }).state;

		expect(next.field(selectionPresentationField)).toBe(Decoration.none);
		expect(ranges(next.field(selectionPresentationField), next.doc.length)).toEqual([]);
	});

	it('rebuilds from selection B without retaining selection A', () => {
		const state = stateWith('alpha beta gamma', EditorSelection.single(0, 5));
		const next = state.update({ selection: EditorSelection.single(11, 16) }).state;

		expect(ranges(next.field(selectionPresentationField), next.doc.length)).toEqual([
			{ from: 11, to: 16, className: 'emend-selection-highlight' },
		]);
	});

	it('rebuilds from the remapped current selection after a document change', () => {
		const state = stateWith('alpha beta', EditorSelection.single(6, 10));
		const next = state.update({ changes: { from: 0, insert: 'XYZ' } }).state;

		expect(next.selection.main.from).toBe(9);
		expect(next.selection.main.to).toBe(13);
		expect(ranges(next.field(selectionPresentationField), next.doc.length)).toEqual([
			{ from: 9, to: 13, className: 'emend-selection-highlight' },
		]);
	});

	it('normalizes an inverted remapped selection after whole-document replacement', () => {
		const original = '# Stale\n\nStale target changes.\n';
		let state = stateWith(original, EditorSelection.single(9, 30));
		state = state.update({ changes: { from: 0, insert: 'USER_STALE_EDIT ' } }).state;
		const next = state.update({
			changes: { from: 0, to: state.doc.length, insert: original },
		}).state;

		expect(next.selection.main.from).toBe(31);
		expect(next.selection.main.to).toBe(0);
		expect(next.selection.main.empty).toBe(false);
		expect(ranges(next.field(selectionPresentationField), next.doc.length)).toEqual([
			{ from: 0, to: 31, className: 'emend-selection-highlight' },
		]);
	});

	it('keeps independent A and B editor states isolated', () => {
		const a = stateWith('alpha beta gamma', EditorSelection.single(0, 5));
		const b = stateWith('alpha beta gamma', EditorSelection.single(11, 16));
		const nextA = a.update({ selection: EditorSelection.single(6, 10) }).state;

		expect(ranges(nextA.field(selectionPresentationField), nextA.doc.length)).toEqual([
			{ from: 6, to: 10, className: 'emend-selection-highlight' },
		]);
		expect(ranges(b.field(selectionPresentationField), b.doc.length)).toEqual([
			{ from: 11, to: 16, className: 'emend-selection-highlight' },
		]);
	});

	it('provides the nonempty field through the EditorView decorations facet', () => {
		const state = stateWith('alpha beta', EditorSelection.single(0, 5));
		const provided = state.facet(EditorView.decorations).filter(
			(value): value is DecorationSet => typeof value !== 'function',
		);

		expect(provided).toHaveLength(1);
		expect(provided[0]?.size).toBeGreaterThan(0);
		expect(ranges(provided[0] ?? Decoration.none, state.doc.length)).toEqual([
			{ from: 0, to: 5, className: 'emend-selection-highlight' },
		]);
	});
});
