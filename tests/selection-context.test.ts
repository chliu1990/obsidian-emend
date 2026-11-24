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

	describe('legacy Markdown scanner boundaries', () => {
		it('retains the CRLF frontmatter closing carriage return before the omission suffix', () => {
			const frontmatter = '---\r\ntitle: TARGET note\r\n---\r';
			const fullText = `${frontmatter}\n\nBody paragraph.`;

			expect(contextFor(fullText, 'TARGET', frontmatter.length)).toBe(
				'---\r\ntitle: TARGET note\r\n---\r\n[...]',
			);
		});

		it('preserves CRLF multiline paragraph and fence slices with exact UTF-16 offsets', () => {
			const fullText =
				'Before\r\n\r\nAlpha TARGET\r\nbeta\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n\r\nAfter';

			expect(buildSmartSelectionContext(fullText, 16, 46, 47)).toEqual({
				from: 16,
				to: 46,
				selectedText: 'TARGET\r\nbeta\r\n\r\n```ts\r\nconst x',
				contextText:
					'[...]\nAlpha TARGET\r\nbeta\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n[...]',
			});
		});

		it('keeps lone carriage returns literal in bounded context', () => {
			const fullText = 'Alpha\rBeta TARGET\rGamma';

			expect(buildSmartSelectionContext(fullText, 11, 17, 16)).toEqual({
				from: 11,
				to: 17,
				selectedText: 'TARGET',
				contextText: '[...]\nBeta TARGET\rGamm\n[...]',
			});
		});

		it('preserves mixed CR, LF, and CRLF bytes during block expansion', () => {
			const fullText = 'Before\r\n\nFirst\rSecond TARGET\nThird\r\n\nAfter';

			expect(contextFor(fullText, 'TARGET', 35)).toBe(
				'Before\r\n\nFirst\rSecond TARGET\nThird\r\n[...]',
			);
		});

		it('recognizes a context fence with backticks in its info string', () => {
			const fence = '```ts`legacy\nconst TARGET = 1;\n```';
			const fullText = `Before.\n\n${fence}\n\nAfter.`;

			expect(contextFor(fullText, 'TARGET', fence.length)).toBe(
				'[...]\n```ts`legacy\nconst TARGET = 1;\n```\n[...]',
			);
		});

		it('accepts a closing context fence indented beyond three spaces', () => {
			const fence = '```\nTARGET\n        ```';
			const fullText = `Before.\n\n${fence}\n\nAfter.`;

			expect(contextFor(fullText, 'TARGET', fence.length)).toBe(
				'[...]\n```\nTARGET\n        ```\n[...]',
			);
		});

		it('does not recognize a blockquote-prefixed context fence across blank lines', () => {
			const fullText = '> ```\n> quoted\n\n> TARGET\n> ```\n\nAfter.';

			expect(contextFor(fullText, 'TARGET', 14)).toBe(
				'[...]\n> TARGET\n> ```\n[...]',
			);
		});

		it('does not recognize a list-prefixed context fence across blank lines', () => {
			const fullText = '- ```\n- listed\n\n- TARGET\n- ```\n\nAfter.';

			expect(contextFor(fullText, 'TARGET', 14)).toBe(
				'[...]\n- TARGET\n- ```\n[...]',
			);
		});

		it('trims an indented frontmatter opener and dash closer', () => {
			const frontmatter = '  ---  \ntitle: TARGET\n  ---  ';
			const fullText = `${frontmatter}\n\nBody paragraph.`;

			expect(contextFor(fullText, 'TARGET', frontmatter.length)).toBe(
				'  ---  \ntitle: TARGET\n  ---  \n[...]',
			);
		});

		it('trims an indented frontmatter opener and dot closer', () => {
			const frontmatter = '  ---  \ntitle: TARGET\n\t...  ';
			const fullText = `${frontmatter}\n\nBody paragraph.`;

			expect(contextFor(fullText, 'TARGET', frontmatter.length)).toBe(
				'  ---  \ntitle: TARGET\n\t...  \n[...]',
			);
		});

		it('keeps unclosed trimmed frontmatter as one bounded block', () => {
			const fullText = '  ---  \ntitle: TARGET\n\nx';

			expect(contextFor(fullText, 'TARGET', 20)).toBe(
				'[...]\n-  \ntitle: TARGET\n\nx',
			);
		});

		it('omits trailing document newlines after a closed fence', () => {
			const fence = '```\nfirst\n\nTARGET\n```';
			const fullText = `${fence}\n\n`;

			expect(contextFor(fullText, 'TARGET', fence.length)).toBe(
				'```\nfirst\n\nTARGET\n```\n[...]',
			);
		});

		it('extends an unclosed fence through internal and trailing blank lines', () => {
			const fullText = '~~~\nfirst\n\nTARGET\n\n';

			expect(contextFor(fullText, 'TARGET', 18)).toBe(
				'~~~\nfirst\n\nTARGET\n\n[...]',
			);
		});

		it('retains the containing-selection error for empty input during scanning', () => {
			expect(() => buildSmartSelectionContext('', 0, 0, -1)).toThrow(
				'Selection must intersect note text.',
			);
		});

		it('does not create a synthetic final line after a trailing newline', () => {
			expect(buildSmartSelectionContext('TARGET\n', 0, 6, 6)).toEqual({
				from: 0,
				to: 6,
				selectedText: 'TARGET',
				contextText: 'TARGET\n[...]',
			});
		});

		it('retains the containing-selection error for an empty selection at EOF', () => {
			expect(() => buildSmartSelectionContext('TARGET\n', 7, 7, 6)).toThrow(
				'Selection must intersect note text.',
			);
		});

		it('uses exact UTF-16 offsets for CJK, emoji, and decomposed text', () => {
			const fullText = '前🙂e\u0301漢 TARGET\n\n終';

			expect(buildSmartSelectionContext(fullText, 1, 6, 13)).toEqual({
				from: 1,
				to: 6,
				selectedText: '🙂e\u0301漢',
				contextText: '前🙂e\u0301漢 TARGET\n[...]',
			});
		});

		it('uses paragraph-bounded truncation rather than table-specific expansion', () => {
			const fullText = '| A | B |\n| - | - |\n| TARGET | x |';

			expect(buildSmartSelectionContext(fullText, 22, 28, 16)).toEqual({
				from: 22,
				to: 28,
				selectedText: 'TARGET',
				contextText: '[...]\n |\n| TARGET | x \n[...]',
			});
		});
	});
});
