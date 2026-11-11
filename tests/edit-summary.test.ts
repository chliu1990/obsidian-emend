import { describe, expect, it } from 'vitest';
import type { EditSummaryItem } from '../src/edit-strategy';
import { formatEditSummary } from '../src/edit-summary';

const HEADER_ONE = 'Edit applied — 1 changes tracked. Review in Track Changes.';

function lineStarts(fullText: string) {
	let offset = 0;
	return fullText.split('\n').map((line) => {
		const start = offset;
		offset += line.length + 1;
		return start;
	});
}

describe('formatEditSummary', () => {
	it('returns exactly the header line when there are no summary items', () => {
		expect(formatEditSummary(0, [], 'Alpha beta.', 0)).toBe(
			'Edit applied — 0 changes tracked. Review in Track Changes.',
		);
	});

	it('renders exact singular bullets for every operation type in response order', () => {
		const text = 'Alpha beta gamma.';
		const items: EditSummaryItem[] = [
			{ type: 'insert', start: 6, end: 11, insertionPoint: 6 },
			{ type: 'insert', start: 6, end: 11, insertionPoint: 11 },
			{ type: 'remove', start: 6, end: 11 },
			{ type: 'replace', start: 0, end: 5 },
			{ type: 'comment', start: 6, end: 11 },
		];

		expect(formatEditSummary(5, items, text, 0)).toBe([
			'Edit applied — 5 changes tracked. Review in Track Changes.',
			'- Inserted text before line 1.',
			'- Inserted text after line 1.',
			'- Removed line 1.',
			'- Replaced line 1.',
			'- Commented on line 1.',
		].join('\n'));
	});

	it('renders plural ranges from original note lines in response order', () => {
		const text = 'Line one.\nLine two.\nLine three.\nLine four.';
		const items: EditSummaryItem[] = [
			{ type: 'replace', start: 0, end: 19 },
			{ type: 'comment', start: 20, end: 31 },
			{ type: 'remove', start: 32, end: 41 },
		];

		expect(formatEditSummary(6, items, text, 0)).toBe([
			'Edit applied — 6 changes tracked. Review in Track Changes.',
			'- Replaced lines 1–2.',
			'- Commented on line 3.',
			'- Removed line 4.',
		].join('\n'));
	});

	it('maps CRLF text without claiming the line after a target that ends at a newline', () => {
		const text = 'Alpha\r\nBeta\r\nGamma\r\n';
		const items: EditSummaryItem[] = [
			{ type: 'replace', start: 0, end: 7 },
			{ type: 'remove', start: 7, end: 18 },
		];

		expect(formatEditSummary(2, items, text, 0)).toBe([
			'Edit applied — 2 changes tracked. Review in Track Changes.',
			'- Replaced line 1.',
			'- Removed lines 2–3.',
		].join('\n'));
	});

	it.each([
		{
			label: 'a point inside a line',
			fullText: 'Alpha beta.\nSecond line.',
			item: { type: 'insert', start: 6, end: 10, insertionPoint: 6 } satisfies EditSummaryItem,
			expected: 'Inserted text before line 1.',
		},
		{
			label: 'a point at a line start',
			fullText: 'Alpha\nBeta',
			item: { type: 'insert', start: 6, end: 10, insertionPoint: 6 } satisfies EditSummaryItem,
			expected: 'Inserted text before line 2.',
		},
		{
			label: 'a point at a line end',
			fullText: 'Alpha\nBeta',
			item: { type: 'insert', start: 0, end: 5, insertionPoint: 5 } satisfies EditSummaryItem,
			expected: 'Inserted text after line 1.',
		},
		{
			label: 'a point at EOF after a trailing newline',
			fullText: 'Alpha\n',
			item: { type: 'insert', start: 0, end: 6, insertionPoint: 6 } satisfies EditSummaryItem,
			expected: 'Inserted text after line 2.',
		},
	])('names the one line containing $label', ({ fullText, item, expected }) => {
		expect(formatEditSummary(1, [item], fullText, 0)).toBe(
			`${HEADER_ONE}\n- ${expected}`,
		);
	});

	it('adds the Selection source offset exactly once to ranges and insertion points', () => {
		const fullText = 'a\nb\nc\nd\ne';
		const replaceItems: EditSummaryItem[] = [{ type: 'replace', start: 0, end: 1 }];
		const insertItems: EditSummaryItem[] = [
			{ type: 'insert', start: 0, end: 1, insertionPoint: 1 },
		];

		const ranged = formatEditSummary(1, replaceItems, fullText, 4);
		expect(ranged).toBe(`${HEADER_ONE}\n- Replaced line 3.`);
		expect(ranged).not.toContain('line 5');
		expect(formatEditSummary(1, replaceItems, fullText, 0)).toBe(
			`${HEADER_ONE}\n- Replaced line 1.`,
		);
		expect(formatEditSummary(1, insertItems, fullText, 4)).toBe(
			`${HEADER_ONE}\n- Inserted text after line 3.`,
		);
	});

	it('renders eight items as eight individual bullets', () => {
		const fullText = Array.from({ length: 8 }, (_value, index) => `Line ${index + 1}.`).join('\n');
		const starts = lineStarts(fullText);
		const items: EditSummaryItem[] = starts.map((start, index) => ({
			type: 'replace',
			start,
			end: start + `Line ${index + 1}.`.length,
		}));

		const summary = formatEditSummary(8, items, fullText, 0);

		expect(summary.split('\n')).toEqual([
			'Edit applied — 8 changes tracked. Review in Track Changes.',
			'- Replaced line 1.',
			'- Replaced line 2.',
			'- Replaced line 3.',
			'- Replaced line 4.',
			'- Replaced line 5.',
			'- Replaced line 6.',
			'- Replaced line 7.',
			'- Replaced line 8.',
		]);
	});

	it('caps nine or more items at seven bullets plus one aggregate', () => {
		const fullText = Array.from({ length: 20 }, (_value, index) => `Line ${index + 1}.`).join('\n');
		const starts = lineStarts(fullText);
		const items: EditSummaryItem[] = starts.map((start, index) => ({
			type: 'replace',
			start,
			end: start + `Line ${index + 1}.`.length,
		}));

		const nine = formatEditSummary(9, items.slice(0, 9), fullText, 0).split('\n');
		expect(nine).toHaveLength(9);
		expect(nine.slice(0, 8)).toEqual([
			'Edit applied — 9 changes tracked. Review in Track Changes.',
			'- Replaced line 1.',
			'- Replaced line 2.',
			'- Replaced line 3.',
			'- Replaced line 4.',
			'- Replaced line 5.',
			'- Replaced line 6.',
			'- Replaced line 7.',
		]);
		expect(nine[8]).toBe('- And 2 more replacements.');

		const twenty = formatEditSummary(20, items, fullText, 0).split('\n');
		expect(twenty).toHaveLength(9);
		expect(twenty[8]).toBe('- And 13 more replacements.');
	});

	it('aggregates every remaining type in fixed order with singular and plural nouns', () => {
		const fullText = Array.from({ length: 13 }, (_value, index) => `Line ${index + 1}.`).join('\n');
		const starts = lineStarts(fullText);
		const startsOf = (index: number) => starts[index] ?? 0;
		const lengthOf = (index: number) => `Line ${index + 1}.`.length;
		const items: EditSummaryItem[] = [
			{ type: 'replace', start: startsOf(0), end: startsOf(0) + lengthOf(0) },
			{ type: 'replace', start: startsOf(1), end: startsOf(1) + lengthOf(1) },
			{ type: 'replace', start: startsOf(2), end: startsOf(2) + lengthOf(2) },
			{ type: 'replace', start: startsOf(3), end: startsOf(3) + lengthOf(3) },
			{ type: 'replace', start: startsOf(4), end: startsOf(4) + lengthOf(4) },
			{ type: 'replace', start: startsOf(5), end: startsOf(5) + lengthOf(5) },
			{ type: 'replace', start: startsOf(6), end: startsOf(6) + lengthOf(6) },
			{
				type: 'insert',
				start: startsOf(7),
				end: startsOf(7) + lengthOf(7),
				insertionPoint: startsOf(7),
			},
			{
				type: 'insert',
				start: startsOf(8),
				end: startsOf(8) + lengthOf(8),
				insertionPoint: startsOf(8),
			},
			{ type: 'remove', start: startsOf(9), end: startsOf(9) + lengthOf(9) },
			{ type: 'replace', start: startsOf(10), end: startsOf(10) + lengthOf(10) },
			{ type: 'replace', start: startsOf(11), end: startsOf(11) + lengthOf(11) },
			{ type: 'comment', start: startsOf(12), end: startsOf(12) + lengthOf(12) },
		];

		expect(formatEditSummary(13, items, fullText, 0)).toBe([
			'Edit applied — 13 changes tracked. Review in Track Changes.',
			'- Replaced line 1.',
			'- Replaced line 2.',
			'- Replaced line 3.',
			'- Replaced line 4.',
			'- Replaced line 5.',
			'- Replaced line 6.',
			'- Replaced line 7.',
			'- And 2 more insertions, 1 more removal, 2 more replacements, 1 more comment.',
		].join('\n'));
	});

	it('keeps comment-only edits on the provided zero change count', () => {
		expect(formatEditSummary(0, [
			{ type: 'comment', start: 6, end: 11 },
		], 'Alpha beta gamma.', 0)).toBe(
			'Edit applied — 0 changes tracked. Review in Track Changes.\n- Commented on line 1.',
		);
	});

	it('never includes anchors, targets, replacements, comment text, or note excerpts', () => {
		const item = {
			type: 'replace' as const,
			start: 0,
			end: 4,
			target: 'SECRET_ANCHOR',
			replacement: 'SECRET_REPLACEMENT',
			comment: 'SECRET_COMMENT',
		};

		const summary = formatEditSummary(1, [item], 'SECRET_ANCHOR has SECRET_REPLACEMENT.', 0);

		expect(summary).toBe(`${HEADER_ONE}\n- Replaced line 1.`);
		expect(summary).not.toContain('SECRET');
		expect(summary).not.toContain('{');
	});
});
