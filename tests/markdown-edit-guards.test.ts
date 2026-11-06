import { describe, expect, it } from 'vitest';
import {
	findMarkdownEditViolation,
	type GuardedMarkdownOperation,
} from '../src/markdown-edit-guards';

function targetOperation(
	fullText: string,
	target: string,
	overrides: Partial<GuardedMarkdownOperation> = {},
): GuardedMarkdownOperation {
	const start = fullText.indexOf(target);
	if (start < 0) {
		throw new Error(`Missing test target: ${target}`);
	}
	return {
		operation: 1,
		operationType: 'remove',
		start,
		end: start + target.length,
		...overrides,
	};
}

function insertionOperation(
	fullText: string,
	anchor: string,
	position: 'before' | 'after',
	overrides: Partial<GuardedMarkdownOperation> = {},
): GuardedMarkdownOperation {
	const operation = targetOperation(fullText, anchor, {
		operationType: 'insert',
		text: 'added',
	});
	return {
		...operation,
		insertionPoint: position === 'before' ? operation.start : operation.end,
		...overrides,
	};
}

describe('inline code edit guards', () => {
	it('rejects content-only and cross-delimiter targets with exact diagnostics', () => {
		const fullText = 'Before\n`alpha` after';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'alpha', { operation: 2, operationType: 'replace', replacement: 'beta' }),
		])).toEqual({
			code: 'inline-code-range',
			operation: 2,
			operationType: 'replace',
			field: 'target',
			line: 2,
		});
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, '`alpha'),
		])).toMatchObject({ code: 'inline-code-range', field: 'target', line: 2 });
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'alpha`'),
		])).toMatchObject({ code: 'inline-code-range', field: 'target', line: 2 });
	});

	it('allows complete spans and larger targets containing complete spans', () => {
		const complete = 'Before `alpha` after';
		expect(findMarkdownEditViolation(complete, [
			targetOperation(complete, '`alpha`', { operationType: 'replace', replacement: '`beta`' }),
		])).toBeUndefined();
		expect(findMarkdownEditViolation(complete, [
			targetOperation(complete, 'Before `alpha` after', { operationType: 'comment', comment: 'Review' }),
		])).toBeUndefined();
	});

	it('rejects insertion strictly inside a span but allows exact outside boundaries', () => {
		const fullText = 'Before `alpha` after';
		expect(findMarkdownEditViolation(fullText, [
			insertionOperation(fullText, 'alpha', 'after', { operation: 3 }),
		])).toEqual({
			code: 'inline-code-range',
			operation: 3,
			operationType: 'insert',
			field: 'anchor',
			line: 1,
		});
		expect(findMarkdownEditViolation(fullText, [
			insertionOperation(fullText, 'Before ', 'after'),
		])).toBeUndefined();
		expect(findMarkdownEditViolation(fullText, [
			insertionOperation(fullText, '`alpha`', 'after'),
		])).toBeUndefined();
	});

	it('handles adjacent, multiline, unmatched, and escaped backtick runs', () => {
		const adjacent = '`one` `two`';
		expect(findMarkdownEditViolation(adjacent, [
			targetOperation(adjacent, 'one` `two'),
		])).toMatchObject({ code: 'inline-code-range' });
		expect(findMarkdownEditViolation(adjacent, [
			targetOperation(adjacent, '`one` `two`'),
		])).toBeUndefined();

		const multiline = 'Before\n``alpha\nbeta``\nafter';
		expect(findMarkdownEditViolation(multiline, [
			targetOperation(multiline, 'alpha\nbeta'),
		])).toMatchObject({ code: 'inline-code-range', line: 2 });
		expect(findMarkdownEditViolation(multiline, [
			targetOperation(multiline, '``alpha\nbeta``'),
		])).toBeUndefined();

		const unmatched = 'Before `alpha after';
		expect(findMarkdownEditViolation(unmatched, [
			targetOperation(unmatched, 'alpha'),
		])).toBeUndefined();
		const escaped = 'Before \\`alpha\\` after';
		expect(findMarkdownEditViolation(escaped, [
			targetOperation(escaped, 'alpha'),
		])).toBeUndefined();
	});
});

describe('fenced code edit guards', () => {
	it.each([
		['backtick', 'Before\n```js\nconst value = 1;\n```\nAfter'],
		['tilde', 'Before\n~~~js\nconst value = 1;\n~~~\nAfter'],
		['CRLF', 'Before\r\n```js\r\nconst value = 1;\r\n```\r\nAfter'],
	])('rejects every operation kind intersecting a %s fence', (_label, fullText) => {
		const target = 'const value = 1;';
		const operations: GuardedMarkdownOperation[] = [
			targetOperation(fullText, target),
			targetOperation(fullText, target, { operationType: 'replace', replacement: 'const value = 2;' }),
			targetOperation(fullText, target, { operationType: 'comment', comment: 'Review' }),
			insertionOperation(fullText, target, 'after'),
		];
		for (const operation of operations) {
			expect(findMarkdownEditViolation(fullText, [operation])).toEqual({
				code: 'fenced-code-edit',
				operation: 1,
				operationType: operation.operationType,
				field: operation.operationType === 'insert' ? 'anchor' : 'target',
				line: 3,
			});
		}
	});

	it('rejects larger targets containing a complete fence', () => {
		const fullText = 'Before\n```\ninside\n```\nAfter';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, fullText),
		])).toMatchObject({ code: 'fenced-code-edit', line: 1 });
	});

	it('allows edits and insertions exactly outside a complete block', () => {
		const fullText = 'Before\n```\ninside\n```\nAfter';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'Before'),
			targetOperation(fullText, 'After', { operation: 2 }),
			insertionOperation(fullText, 'Before\n', 'after', { operation: 3 }),
			insertionOperation(fullText, 'After', 'before', { operation: 4 }),
		])).toBeUndefined();
	});

	it('extends unclosed fences to EOF and requires a matching close run', () => {
		const unclosed = 'Before\n  ~~~~ info\ninside\nAfter';
		expect(findMarkdownEditViolation(unclosed, [
			targetOperation(unclosed, 'After'),
		])).toMatchObject({ code: 'fenced-code-edit', line: 4 });

		const shortClose = 'Before\n````\ninside\n```\nAfter';
		expect(findMarkdownEditViolation(shortClose, [
			targetOperation(shortClose, 'After'),
		])).toMatchObject({ code: 'fenced-code-edit', line: 5 });

		const closed = 'Before\n~~~\ninside\n~~~~   \nAfter';
		expect(findMarkdownEditViolation(closed, [
			targetOperation(closed, 'After'),
		])).toBeUndefined();
	});
});

describe('table edit guards', () => {
	const table = '| Alpha | Beta |\n| --- | :---: |\n| one | two |\n| three | four |';

	it('allows text edits wholly within one header or body cell', () => {
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, 'Alpha', { operationType: 'replace', replacement: 'First' }),
			targetOperation(table, 'one', { operation: 2 }),
			targetOperation(table, 'two', { operation: 3, operationType: 'comment', comment: 'Review' }),
			insertionOperation(table, 'three', 'after', { operation: 4, text: ' value' }),
		])).toBeUndefined();
	});

	it('allows emptying cell text and escaped pipes in cell payloads', () => {
		const escaped = '| Alpha | Beta |\n| --- | --- |\n| one \\| two | three |';
		expect(findMarkdownEditViolation(escaped, [
			targetOperation(escaped, 'one \\| two', { operationType: 'replace', replacement: 'new \\| value' }),
			targetOperation(escaped, 'three', { operation: 2 }),
			insertionOperation(escaped, 'three', 'before', { operation: 3, text: '\\| ' }),
			targetOperation(escaped, 'Alpha', { operation: 4, operationType: 'comment', comment: 'Keep \\| literal' }),
		])).toBeUndefined();
	});

	it('always rejects delimiter-row operations', () => {
		const fullText = `Before\n${table}\nAfter`;
		const delimiter = '| --- | :---: |';
		for (const operation of [
			targetOperation(fullText, delimiter),
			targetOperation(fullText, '---', { operationType: 'replace', replacement: '::-' }),
			targetOperation(fullText, ':---:', { operationType: 'comment', comment: 'Review' }),
			insertionOperation(fullText, delimiter, 'after'),
		]) {
			expect(findMarkdownEditViolation(fullText, [operation])).toEqual({
				code: 'table-structure-edit',
				operation: 1,
				operationType: operation.operationType,
				field: operation.operationType === 'insert' ? 'anchor' : 'target',
				line: 3,
			});
		}
	});

	it('rejects targets spanning cells, rows, and complete added or removed rows and columns', () => {
		const row = '| Alpha | Beta |';
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, 'Alpha | Beta', { operationType: 'replace', replacement: 'Alpha | New | Beta' }),
		])).toMatchObject({ code: 'table-structure-edit', line: 1, field: 'target' });
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, row, { operationType: 'replace', replacement: '| Alpha | New | Beta |' }),
		])).toMatchObject({ code: 'table-structure-edit', line: 1 });
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, '| one | two |'),
		])).toMatchObject({ code: 'table-structure-edit', line: 3 });
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, '| Beta |'),
		])).toMatchObject({ code: 'table-structure-edit', line: 1 });
		expect(findMarkdownEditViolation(table, [
			targetOperation(table, 'Alpha | Beta |\n| ---'),
		])).toMatchObject({ code: 'table-structure-edit', line: 1 });
	});

	it('requires an insertion anchor and insertion point in the same cell', () => {
		const crossCell = insertionOperation(table, 'Alpha', 'after', {
			insertionPoint: table.indexOf('Beta'),
		});
		expect(findMarkdownEditViolation(table, [crossCell])).toEqual({
			code: 'table-structure-edit',
			operation: 1,
			operationType: 'insert',
			field: 'anchor',
			line: 1,
		});
		expect(findMarkdownEditViolation(table, [
			insertionOperation(table, 'Alpha', 'after', { text: ' | New' }),
		])).toMatchObject({ code: 'table-structure-edit', field: 'text', line: 1 });
	});

	it.each([
		['replacement', targetOperation(table, 'Alpha', { operationType: 'replace', replacement: 'A | B' })],
		['comment', targetOperation(table, 'Alpha', { operationType: 'comment', comment: 'A | B' })],
		['text', insertionOperation(table, 'Alpha', 'after', { text: 'A\nB' })],
	] as const)('rejects structural characters in table %s payloads', (field, operation) => {
		expect(findMarkdownEditViolation(table, [operation])).toMatchObject({
			code: 'table-structure-edit',
			field,
			line: 1,
		});
	});

	it('uses absolute ranges and CRLF lines for selection mappings', () => {
		const fullText = `Before\r\n${table.replaceAll('\n', '\r\n')}\r\nAfter`;
		const operation = targetOperation(fullText, 'one', {
			operation: 4,
			operationType: 'replace',
			replacement: 'one | two',
		});
		expect(operation.start).toBe(45);
		expect(findMarkdownEditViolation(fullText, [operation])).toEqual({
			code: 'table-structure-edit',
			operation: 4,
			operationType: 'replace',
			field: 'replacement',
			line: 4,
		});
	});

	it('does not classify prose pipes without an adjacent delimiter as tables', () => {
		const prose = 'Alpha | Beta\nordinary prose\none | two';
		expect(findMarkdownEditViolation(prose, [
			targetOperation(prose, 'Alpha | Beta', { operationType: 'replace', replacement: 'A | B' }),
			targetOperation(prose, 'one | two', { operation: 2 }),
		])).toBeUndefined();
	});

	it('recognizes tables without outer pipes and ignores table-like fence contents', () => {
		const noOuterPipes = 'Alpha | Beta\n--- | ---\none | two';
		expect(findMarkdownEditViolation(noOuterPipes, [
			targetOperation(noOuterPipes, 'Alpha | Beta'),
		])).toMatchObject({ code: 'table-structure-edit', line: 1 });
		const fenced = '```\n| Alpha | Beta |\n| --- | --- |\n| one | two |\n```';
		expect(findMarkdownEditViolation(fenced, [
			targetOperation(fenced, 'one'),
		])).toMatchObject({ code: 'fenced-code-edit', line: 4 });
	});
});

describe('Markdown scanner review regressions', () => {
	it('treats closing backticks as code delimiters after odd or even backslashes', () => {
		for (const fullText of ['`alpha\\` after', '`alpha\\\\` after']) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'alpha', { operationType: 'replace', replacement: 'beta' }),
			])).toMatchObject({ code: 'inline-code-range', field: 'target', line: 1 });
		}
		const multiline = 'Before\n`alpha\nbeta\\`\nafter';
		expect(findMarkdownEditViolation(multiline, [
			targetOperation(multiline, 'alpha\nbeta\\'),
		])).toMatchObject({ code: 'inline-code-range', line: 2 });
	});

	it('recognizes outer table pipes after indentation and trailing whitespace without shifting cells', () => {
		for (const spaces of [0, 1, 2, 3]) {
			const indent = ' '.repeat(spaces);
			const header = `${indent}| Alpha | Beta |`;
			const body = `${indent}| one | two |`;
			const fullText = `${header} \t\r\n${indent}| --- | --- |  \r\n${body} \t`;
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, '| Alpha | Beta |', {
					operationType: 'replace',
					replacement: '| Alpha | New | Beta |',
				}),
			])).toMatchObject({ code: 'table-structure-edit', line: 1 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, body),
			])).toMatchObject({ code: 'table-structure-edit', line: 3 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'Alpha', { operationType: 'replace', replacement: 'First' }),
				insertionOperation(fullText, 'Beta', 'after', { operation: 2, text: ' value' }),
			])).toBeUndefined();
		}
	});

	it('retains no-outer-pipe table recognition with indentation and trailing whitespace', () => {
		const fullText = '   Alpha | Beta  \n   --- | --- \t\n   one | two  ';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'Alpha | Beta', {
				operationType: 'replace',
				replacement: 'Alpha | New | Beta',
			}),
		])).toMatchObject({ code: 'table-structure-edit', line: 1 });
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'two', { operationType: 'replace', replacement: 'safe' }),
		])).toBeUndefined();
	});

	it('rejects insertion at EOF in unclosed fences but allows exact-after closed fences', () => {
		for (const fullText of ['```\nalpha', '```\nalpha\n', '```\r\nalpha\r\n']) {
			const anchor = fullText.slice(fullText.indexOf('alpha'));
			expect(findMarkdownEditViolation(fullText, [
				insertionOperation(fullText, anchor, 'after'),
			])).toMatchObject({
				code: 'fenced-code-edit',
				field: 'anchor',
				line: fullText.endsWith('\n') ? 3 : 2,
			});
		}
		for (const fullText of ['```\nalpha\n```', '```\nalpha\n```\n']) {
			const start = fullText.lastIndexOf('```');
			expect(findMarkdownEditViolation(fullText, [{
				operation: 1,
				operationType: 'insert',
				start,
				end: fullText.length,
				insertionPoint: fullText.length,
				text: 'added',
			}])).toBeUndefined();
		}
	});

	it('classifies fenced code in consistent blockquote and list containers', () => {
		for (const fullText of [
			'> ~~~\n> alpha\n> ~~~\nAfter',
			'- ~~~\n  alpha\n  ~~~\nAfter',
			'1. ```\n   alpha\n   ```\nAfter',
			'> - ~~~\n>   alpha\n>   ~~~\nAfter',
		]) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'alpha'),
			])).toMatchObject({ code: 'fenced-code-edit', line: 2 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'After'),
			])).toBeUndefined();
		}
	});

	it('does not accept mismatched container prefixes as fence closers', () => {
		const fullText = '> ~~~\n> alpha\n~~~\nAfter';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'After'),
		])).toMatchObject({ code: 'fenced-code-edit', line: 4 });
	});

	it('classifies tables in consistent blockquote and list containers with absolute cell offsets', () => {
		for (const fullText of [
			'> | Alpha | Beta |\n> | --- | --- |\n> | one | two |',
			'- | Alpha | Beta |\n  | --- | --- |\n  | one | two |',
			'> - | Alpha | Beta |\n>   | --- | --- |\n>   | one | two |',
		]) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, '| Alpha | Beta |', {
					operationType: 'replace',
					replacement: '| Alpha | New | Beta |',
				}),
			])).toMatchObject({ code: 'table-structure-edit', line: 1 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, '| one | two |'),
			])).toMatchObject({ code: 'table-structure-edit', line: 3 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'Alpha', { operationType: 'replace', replacement: 'First' }),
				insertionOperation(fullText, 'two', 'after', { operation: 2, text: ' value' }),
			])).toBeUndefined();
		}
	});

	it('keeps backtick fence openers with backtick info strings as inline code', () => {
		const fullText = '```alpha``` followed by prose\nNext prose';
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'followed by prose'),
			targetOperation(fullText, 'Next prose', { operation: 2 }),
		])).toBeUndefined();
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'alpha'),
		])).toMatchObject({ code: 'inline-code-range', line: 1 });
	});

	it.each([
		['heading', '# Heading'],
		['blockquote', '> quote'],
		['unordered list', '- item'],
		['ordered list', '1. item'],
		['thematic break', '---'],
	])('ends a table body at a %s before prose with pipes', (_label, terminator) => {
		const fullText = `| Alpha | Beta |\n| --- | --- |\n| one | two |\n${terminator}\nAfter | prose`;
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'one', { operationType: 'replace', replacement: 'safe' }),
			targetOperation(fullText, 'After | prose', {
				operation: 2,
				operationType: 'replace',
				replacement: 'Changed | text',
			}),
		])).toBeUndefined();
	});

	it('reports an insertion violation at the insertion point across CRLF lines', () => {
		const fullText = '`alpha\r\nbeta`';
		const operation = insertionOperation(fullText, 'alpha\r\nbeta', 'after', { operation: 4 });
		expect(findMarkdownEditViolation(fullText, [operation])).toEqual({
			code: 'inline-code-range',
			operation: 4,
			operationType: 'insert',
			field: 'anchor',
			line: 2,
		});
	});
});

describe('Markdown container identity regressions', () => {
	it('tracks table bodies across optional blockquote whitespace variations', () => {
		for (const fullText of [
			'> | Alpha | Beta |\n> | --- | --- |\n>| one | two |',
			'> > | Alpha | Beta |\n>> | --- | --- |\n> >| one | two |',
		]) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, '| one | two |'),
			])).toMatchObject({ code: 'table-structure-edit', line: 3 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'two', { operationType: 'replace', replacement: 'safe' }),
			])).toBeUndefined();
		}
	});

	it('accepts structurally equivalent container prefixes on fence rows and closers', () => {
		for (const fullText of [
			'> ~~~\n> alpha\n>~~~\nAfter',
			'> > ~~~\n>> alpha\n> >~~~\nAfter',
			'-\t~~~\n\talpha\n\t~~~\nAfter',
		]) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'alpha'),
			])).toMatchObject({ code: 'fenced-code-edit', line: 2 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'After'),
			])).toBeUndefined();
		}
	});

	it('ends an unclosed container fence when its container ends', () => {
		for (const fullText of [
			'> ~~~\n> alpha\nAfter',
			'> > ~~~\n>> alpha\nAfter',
		]) {
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'alpha'),
			])).toMatchObject({ code: 'fenced-code-edit', line: 2 });
			expect(findMarkdownEditViolation(fullText, [
				targetOperation(fullText, 'After'),
			])).toBeUndefined();
		}
	});

	it.each([
		'- Alpha | Beta\n> | --- | --- |\nAfter',
		'> Alpha | Beta\n- | --- | --- |\nAfter',
		'> - Alpha | Beta\n> | --- | --- |\nAfter',
	])('does not invent a table from different containers: %s', (fullText) => {
		expect(findMarkdownEditViolation(fullText, [
			targetOperation(fullText, 'Alpha | Beta', {
				operationType: 'replace',
				replacement: 'Changed | text',
			}),
			targetOperation(fullText, 'After', { operation: 2 }),
		])).toBeUndefined();
	});
});

describe('violation ordering', () => {
	it('returns the first unsafe operation in request order', () => {
		const fullText = '`alpha`\n\n| A | B |\n| - | - |\n| c | d |';
		const operations = [
			targetOperation(fullText, 'c', { operation: 1, operationType: 'replace', replacement: 'safe' }),
			targetOperation(fullText, 'alpha', { operation: 2 }),
			targetOperation(fullText, 'A | B', { operation: 3 }),
		];
		expect(findMarkdownEditViolation(fullText, operations)).toEqual({
			code: 'inline-code-range',
			operation: 2,
			operationType: 'remove',
			field: 'target',
			line: 1,
		});
	});
});
