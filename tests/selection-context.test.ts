import { describe, expect, it } from 'vitest';
import { buildSmartSelectionContext } from '../src/selection-context';

function contextFor(
	fullText: string,
	selectedText: string,
	maxCharacters: number,
	selectionFrom?: number,
) {
	const from = selectionFrom ?? fullText.indexOf(selectedText);
	if (from < 0) {
		throw new Error('Test selection must occur in the source.');
	}
	const to = from + selectedText.length;
	const context = buildSmartSelectionContext(
		fullText,
		from,
		to,
		maxCharacters,
	);
	expect(context).toMatchObject({
		from,
		to,
		selectedText: fullText.slice(from, to),
	});
	return context.contextText;
}

describe('buildSmartSelectionContext', () => {
	it('returns the complete note when it fits the budget', () => {
		const fullText = 'Before\n\nA TARGET phrase.\n\nAfter';

		expect(contextFor(fullText, 'TARGET', 100)).toBe(fullText);
	});

	it('expands a partial sentence to its containing paragraph', () => {
		const paragraph =
			'A long sentence with TARGET phrase and a second sentence.';
		const fullText = `Intro paragraph.\n\n${paragraph}\n\nClosing paragraph.`;

		expect(contextFor(fullText, 'TARGET', paragraph.length)).toBe(
			`[...]\n${paragraph}\n[...]`,
		);
	});

	it('keeps a containing multiline paragraph intact', () => {
		const paragraph = 'First line TARGET\nsecond line\nthird line.';
		const fullText = `Before.\n\n${paragraph}\n\nAfter.`;

		expect(contextFor(fullText, 'TARGET', paragraph.length)).toBe(
			`[...]\n${paragraph}\n[...]`,
		);
	});

	it('adds whole adjacent paragraphs only while they fit the budget', () => {
		const before = 'Before paragraph.';
		const middle = 'Middle TARGET paragraph.';
		const after = 'After paragraph.';
		const fullText = `${before}\n\n${middle}\n\n${after}`;
		const maxCharacters = before.length + 2 + middle.length;

		expect(contextFor(fullText, 'TARGET', maxCharacters)).toBe(
			`${before}\n\n${middle}\n[...]`,
		);
	});

	it('does not partially add an adjacent paragraph over the limit', () => {
		const middle = 'Middle TARGET paragraph.';
		const fullText = `Before paragraph.\n\n${middle}\n\n${'After '.repeat(20)}`;

		expect(contextFor(fullText, 'TARGET', middle.length + 4)).toBe(
			`[...]\n${middle}\n[...]`,
		);
	});

	it('expands after a selection in the first paragraph without a leading marker', () => {
		const first = 'First TARGET paragraph.';
		const second = 'Second paragraph.';
		const fullText = `${first}\n\n${second}\n\nThird paragraph.`;
		const maxCharacters = first.length + 2 + second.length;

		expect(contextFor(fullText, 'TARGET', maxCharacters)).toBe(
			`${first}\n\n${second}\n[...]`,
		);
	});

	it('expands before a selection in the last paragraph without a trailing marker', () => {
		const previous = 'Previous paragraph.';
		const last = 'Last TARGET paragraph.';
		const fullText = `First paragraph.\n\n${previous}\n\n${last}`;
		const maxCharacters = previous.length + 2 + last.length;

		expect(contextFor(fullText, 'TARGET', maxCharacters)).toBe(
			`[...]\n${previous}\n\n${last}`,
		);
	});

	it('includes every containing paragraph for a selection spanning paragraphs', () => {
		const first = 'First selected paragraph.';
		const second = 'Second selected paragraph.';
		const selectedText = 'selected paragraph.\n\nSecond selected';
		const fullText = `Before.\n\n${first}\n\n${second}\n\nAfter.`;
		const containing = `${first}\n\n${second}`;

		expect(contextFor(fullText, selectedText, containing.length)).toBe(
			`[...]\n${containing}\n[...]`,
		);
	});

	it('uses symmetric in-block context and markers when the containing paragraph exceeds the budget', () => {
		const fullText = `Before.\n\n${'a'.repeat(30)}TARGET${'b'.repeat(30)}\n\nAfter.`;
		const from = fullText.indexOf('TARGET');

		expect(contextFor(fullText, 'TARGET', 16)).toBe(
			`[...]\n${fullText.slice(from - 5, from + 11)}\n[...]`,
		);
	});

	it('never truncates a selection larger than the budget', () => {
		const selectedText = 'SELECTED '.repeat(20).trim();
		const fullText = `Before paragraph.\n\n${selectedText}\n\nAfter paragraph.`;

		expect(contextFor(fullText, selectedText, 10)).toBe(
			`[...]\n${selectedText}\n[...]`,
		);
	});

	it('keeps complete YAML frontmatter boundaries when the block fits', () => {
		const frontmatter = '---\ntitle: TARGET note\ntags:\n  - one\n  - two\n---';
		const fullText = `${frontmatter}\n\nBody paragraph.`;

		expect(contextFor(fullText, 'TARGET', frontmatter.length)).toBe(
			`${frontmatter}\n[...]`,
		);
	});

	it('uses marked in-block truncation when YAML frontmatter exceeds the budget', () => {
		const frontmatter = `---\ntitle: TARGET note\ndescription: ${'x'.repeat(40)}\n---`;
		const fullText = `${frontmatter}\n\nBody paragraph.`;
		const from = fullText.indexOf('TARGET');

		expect(contextFor(fullText, 'TARGET', 16)).toBe(
			`[...]\n${fullText.slice(from - 5, from + 11)}\n[...]`,
		);
	});

	it('treats unclosed document-leading YAML as one block without duplicate inner blocks', () => {
		const fullText = '---\ntitle: TARGET\n\nx';

		expect(contextFor(fullText, 'TARGET', 16)).toBe(
			'[...]\ntitle: TARGET\n\nx',
		);
	});

	it('keeps complete fenced code boundaries and internal blank lines', () => {
		const fence = '```ts\nconst first = 1;\n\nconst TARGET = 2;\n```';
		const fullText = `Before.\n\n${fence}\n\nAfter.`;

		expect(contextFor(fullText, 'TARGET', fence.length)).toBe(
			`[...]\n${fence}\n[...]`,
		);
	});

	it('uses marked in-block truncation when a fenced code block exceeds the budget', () => {
		const fence = `~~~\n${'a'.repeat(30)}TARGET${'b'.repeat(30)}\n~~~`;
		const fullText = `Before.\n\n${fence}\n\nAfter.`;
		const from = fullText.indexOf('TARGET');

		expect(contextFor(fullText, 'TARGET', 16)).toBe(
			`[...]\n${fullText.slice(from - 5, from + 11)}\n[...]`,
		);
	});
});
