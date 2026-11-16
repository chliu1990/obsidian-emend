import { describe, expect, it } from 'vitest';
import { buildFullNoteSelectionSections } from '../src/selection-focus';

const snapshot = {
	fullText: '---\ntitle: 雪 🌨️\n---\n\nFirst α\n\n选中的 😀 line\n尾巴 Ω\n',
	selectedText: '选中的 😀 line\n尾巴 Ω',
};

describe('buildFullNoteSelectionSections', () => {
	it('labels the complete selection as read-only conversational focus for Chat', () => {
		expect(buildFullNoteSelectionSections(snapshot, 'chat-focus')).toBe(
			`Full note (supporting context):\n${snapshot.fullText}\n\nSelected text (read-only conversational focus):\n${snapshot.selectedText}`,
		);
	});

	it('labels the complete selection as the only edit target for Edit', () => {
		expect(buildFullNoteSelectionSections(snapshot, 'edit-target')).toBe(
			`Full note (supporting context):\n${snapshot.fullText}\n\nSelected text (the only edit target):\n${snapshot.selectedText}`,
		);
	});
});
