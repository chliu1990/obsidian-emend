// eslint-disable-next-line import/no-extraneous-dependencies -- CodeMirror is supplied by the Obsidian host.
import {
	EditorSelection,
	type Extension,
	StateField,
} from '@codemirror/state';
// eslint-disable-next-line import/no-extraneous-dependencies -- CodeMirror is supplied by the Obsidian host.
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export function buildSelectionDecorations(
	selection: EditorSelection,
): DecorationSet {
	const decorations = selection.ranges
		.filter((range) => !range.empty)
		.map((range) => Decoration.mark({
			class: 'emend-selection-highlight',
		}).range(
			Math.min(range.from, range.to),
			Math.max(range.from, range.to),
		));
	return decorations.length > 0 ? Decoration.set(decorations, true) : Decoration.none;
}

export const selectionPresentationField = StateField.define<DecorationSet>({
	create: (state) => buildSelectionDecorations(state.selection),
	update: (value, transaction) => {
		if (transaction.docChanged || transaction.selection !== undefined) {
			return buildSelectionDecorations(transaction.state.selection);
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});

export function createSelectionPresentation(): Extension {
	return selectionPresentationField;
}
