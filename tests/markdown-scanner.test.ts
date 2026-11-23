import { describe, expect, it } from 'vitest';
import {
	isMarkdownBlockStart,
	isMarkdownEscaped,
	markdownBacktickRunEnd,
	markdownLineNumberAt,
	scanMarkdown,
	scanMarkdownContext,
	scanMarkdownEditStructure,
} from '../src/markdown-scanner';

describe('scanMarkdownContext', () => {
	describe('context lines', () => {
		const cases = [
			{
				name: 'empty input',
				source: '',
				lines: [],
			},
			{
				name: 'single unterminated line',
				source: 'alpha',
				lines: [{ start: 0, end: 5, text: 'alpha' }],
			},
			{
				name: 'trailing newline without a synthetic final line',
				source: 'alpha\n',
				lines: [{ start: 0, end: 5, text: 'alpha' }],
			},
			{
				name: 'one empty line before a newline',
				source: '\n',
				lines: [{ start: 0, end: 0, text: '' }],
			},
			{
				name: 'CRLF with carriage returns retained in line text',
				source: 'alpha\r\nbeta\r\n',
				lines: [
					{ start: 0, end: 6, text: 'alpha\r' },
					{ start: 7, end: 12, text: 'beta\r' },
				],
			},
			{
				name: 'lone carriage returns retained as literal text',
				source: 'alpha\rbeta\r',
				lines: [{ start: 0, end: 11, text: 'alpha\rbeta\r' }],
			},
			{
				name: 'mixed LF, CRLF, and lone CR endings',
				source: 'a\r\nb\rc\n\n',
				lines: [
					{ start: 0, end: 2, text: 'a\r' },
					{ start: 3, end: 6, text: 'b\rc' },
					{ start: 7, end: 7, text: '' },
				],
			},
		];

		it.each(cases)('$name', ({ source, lines }) => {
			const scan = scanMarkdownContext(source);

			expect(scan).toEqual({
				source,
				contextLines: lines,
				contextFences: [],
			});
			for (const line of scan.contextLines) {
				expect(source.slice(line.start, line.end)).toBe(line.text);
			}
		});
	});

	describe('context frontmatter', () => {
		it('returns a closed dash-delimited range and the following line index', () => {
			const source = '---\ntitle: Note\n---\nbody';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFrontmatter).toEqual({
				start: 0,
				end: 19,
				closed: true,
				nextLine: 3,
			});
			expect(source.slice(0, 19)).toBe('---\ntitle: Note\n---');
			expect(scan.contextLines[3]).toEqual({
				start: 20,
				end: 24,
				text: 'body',
			});
			expect(scan.contextFences).toEqual([]);
		});

		it('trims the opener and dot closer without changing source ranges', () => {
			const source = '  ---  \ntitle: Note\n\t...  \nbody';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFrontmatter).toEqual({
				start: 0,
				end: 26,
				closed: true,
				nextLine: 3,
			});
			expect(source.slice(0, 26)).toBe('  ---  \ntitle: Note\n\t...  ');
			expect(scan.contextLines[3]).toEqual({
				start: 27,
				end: 31,
				text: 'body',
			});
		});

		it('extends unclosed frontmatter through EOF', () => {
			const source = '---\ntitle: Note\n\nbody';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFrontmatter).toEqual({
				start: 0,
				end: 21,
				closed: false,
				nextLine: 4,
			});
			expect(source.slice(0, 21)).toBe(source);
			expect(scan.contextFences).toEqual([]);
		});
	});

	describe('context fences', () => {
		it('returns a closed range and the line after its closer', () => {
			const source = 'Before\n\n```ts\nconst x = 1;\n```\nAfter';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFrontmatter).toBeUndefined();
			expect(scan.contextFences).toEqual([
				{
					start: 8,
					end: 30,
					closed: true,
					openingLine: 2,
					nextLine: 5,
				},
			]);
			expect(source.slice(8, 30)).toBe('```ts\nconst x = 1;\n```');
		});

		it('recognizes backticks in a backtick fence info string', () => {
			const source = '```ts`legacy\nTARGET\n```';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFences).toEqual([
				{
					start: 0,
					end: 23,
					closed: true,
					openingLine: 0,
					nextLine: 3,
				},
			]);
			expect(source.slice(0, 23)).toBe(source);
		});

		it('trims closing indentation and retains internal blank lines', () => {
			const source = '~~~\nfirst\n\nTARGET\n        ~~~   \nAfter';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFences).toEqual([
				{
					start: 0,
					end: 32,
					closed: true,
					openingLine: 0,
					nextLine: 5,
				},
			]);
			expect(source.slice(0, 32)).toBe(
				'~~~\nfirst\n\nTARGET\n        ~~~   ',
			);
		});

		it('extends an unclosed range through the last non-synthetic line', () => {
			const source = '```\nfirst\n\nTARGET\n\n';

			const scan = scanMarkdownContext(source);

			expect(scan.contextFences).toEqual([
				{
					start: 0,
					end: 18,
					closed: false,
					openingLine: 0,
					nextLine: 5,
				},
			]);
			expect(source.slice(0, 18)).toBe('```\nfirst\n\nTARGET\n');
			expect(scan.contextLines).toHaveLength(5);
		});
	});

	it('uses UTF-16 code-unit offsets after Unicode text', () => {
		const source = '前🙂e\u0301漢\n\n```\n値🙂\n```';

		const scan = scanMarkdownContext(source);

		expect(scan.contextLines).toEqual([
			{ start: 0, end: 6, text: '前🙂e\u0301漢' },
			{ start: 7, end: 7, text: '' },
			{ start: 8, end: 11, text: '```' },
			{ start: 12, end: 15, text: '値🙂' },
			{ start: 16, end: 19, text: '```' },
		]);
		expect(scan.contextFences).toEqual([
			{
				start: 8,
				end: 19,
				closed: true,
				openingLine: 2,
				nextLine: 5,
			},
		]);
		expect(source.slice(8, 19)).toBe('```\n値🙂\n```');
	});
});


describe('scanMarkdown', () => {
	describe('strict lines', () => {
		it.each([
			{ name: 'empty input', source: '', lines: [] },
			{
				name: 'unterminated LF content',
				source: 'alpha',
				lines: [{ start: 0, contentEnd: 5, end: 5, text: 'alpha', ending: '' }],
			},
			{
				name: 'LF without a synthetic final line',
				source: 'alpha\n',
				lines: [{ start: 0, contentEnd: 5, end: 6, text: 'alpha', ending: '\n' }],
			},
			{
				name: 'CRLF',
				source: 'alpha\r\nbeta',
				lines: [
					{ start: 0, contentEnd: 5, end: 7, text: 'alpha', ending: '\r\n' },
					{ start: 7, contentEnd: 11, end: 11, text: 'beta', ending: '' },
				],
			},
			{
				name: 'lone CR',
				source: 'alpha\rbeta\r',
				lines: [
					{ start: 0, contentEnd: 5, end: 6, text: 'alpha', ending: '\r' },
					{ start: 6, contentEnd: 10, end: 11, text: 'beta', ending: '\r' },
				],
			},
			{
				name: 'mixed endings and an empty line',
				source: 'a\r\nb\rc\n\n',
				lines: [
					{ start: 0, contentEnd: 1, end: 3, text: 'a', ending: '\r\n' },
					{ start: 3, contentEnd: 4, end: 5, text: 'b', ending: '\r' },
					{ start: 5, contentEnd: 6, end: 7, text: 'c', ending: '\n' },
					{ start: 7, contentEnd: 7, end: 8, text: '', ending: '\n' },
				],
			},
		])('partitions $name losslessly', ({ source, lines }) => {
			const scan = scanMarkdown(source);

			expect(scan.lines.map((line) => ({
				start: line.start,
				contentEnd: line.contentEnd,
				end: line.end,
				text: line.text,
				ending: line.ending,
			}))).toEqual(lines);
			expect(scan.lines.map((line) => line.text + line.ending).join('')).toBe(source);
			for (let index = 0; index < scan.lines.length; index += 1) {
				const line = scan.lines[index];
				expect(line).toBeDefined();
				if (!line) {
					continue;
				}
				expect(source.slice(line.start, line.contentEnd)).toBe(line.text);
				expect(source.slice(line.contentEnd, line.end)).toBe(line.ending);
				if (index > 0) {
					expect(scan.lines[index - 1]?.end).toBe(line.start);
				}
			}
		});

		it('uses UTF-16 offsets without normalizing Unicode', () => {
			const scan = scanMarkdown('前🙂e\u0301\r\n值🙂');

			expect(scan.lines.map((line) => [line.start, line.contentEnd, line.end, line.text, line.ending])).toEqual([
				[0, 5, 7, '前🙂e\u0301', '\r\n'],
				[7, 10, 10, '值🙂', ''],
			]);
		});
	});

	describe('containers', () => {
		it.each([
			{
				name: 'quote and list nesting',
				text: '> - ~~~',
				container: { contentStart: 4, segments: [{ type: 'quote' }, { type: 'indent', width: 2 }] },
			},
			{
				name: 'adjacent quotes and a tab-terminated ordered list',
				text: '>>\t1)\t```',
				container: {
					contentStart: 6,
					segments: [{ type: 'quote' }, { type: 'quote' }, { type: 'indent', width: 4 }],
				},
			},
			{
				name: 'tab visual width',
				text: '-\t~~~',
				container: { contentStart: 2, segments: [{ type: 'indent', width: 4 }] },
			},
			{
				name: 'up to three spaces before containers',
				text: '   >  > 2. item',
				container: {
					contentStart: 11,
					segments: [{ type: 'quote' }, { type: 'quote' }, { type: 'indent', width: 3 }],
				},
			},
			{ name: 'four-space quote prefix', text: '    > ~~~', container: { contentStart: 0, segments: [] } },
			{ name: 'list marker without whitespace', text: '-item', container: { contentStart: 0, segments: [] } },
			{ name: 'ten-digit list marker', text: '1234567890. item', container: { contentStart: 0, segments: [] } },
		])('reads $name', ({ text, container }) => {
			expect(scanMarkdown(text).lines[0]?.container).toEqual(container);
		});

		it('matches structurally equivalent quote and tab-list prefixes', () => {
			const quote = scanMarkdown('> > ~~~\n>> alpha\n> >~~~\nAfter');
			expect(quote.semanticFences).toEqual([{
				start: 0,
				end: 24,
				closed: true,
				containerEnded: false,
				openingStart: 4,
				closingContentEnd: 23,
			}]);

			const list = scanMarkdown('-\t~~~\n\talpha\n\t~~~\nAfter');
			expect(list.semanticFences).toEqual([{
				start: 0,
				end: 18,
				closed: true,
				containerEnded: false,
				openingStart: 2,
				closingContentEnd: 17,
			}]);
		});
	});

	describe('semantic and review fences', () => {
		it('reports exact opening and closing offsets', () => {
			const scan = scanMarkdown('Before\n```js\nconst x = 1;\n```\nAfter');

			expect(scan.semanticFences).toEqual([{
				start: 7,
				end: 30,
				closed: true,
				containerEnded: false,
				openingStart: 7,
				closingContentEnd: 29,
			}]);
			expect(scan.reviewFenceRanges).toEqual([{
				start: 6,
				end: 29,
				closed: true,
				openingStart: 7,
			}]);
		});

		it('ends an unclosed container fence before following prose', () => {
			const scan = scanMarkdown('> ~~~\n> alpha\nAfter');

			expect(scan.semanticFences).toEqual([{
				start: 0,
				end: 14,
				closed: false,
				containerEnded: true,
				openingStart: 2,
			}]);
		});

		it('extends an unclosed top-level fence through EOF', () => {
			const source = 'Before\n  ~~~~ info\ninside\nAfter';
			const scan = scanMarkdown(source);

			expect(scan.semanticFences).toEqual([{
				start: 7,
				end: source.length,
				closed: false,
				containerEnded: false,
				openingStart: 9,
			}]);
		});

		it('does not accept a backtick fence opener with backticks in its info string', () => {
			const scan = scanMarkdown('```alpha```\ninside\n```');

			expect(scan.semanticFences).toEqual([{
				start: 19,
				end: 22,
				closed: false,
				containerEnded: false,
				openingStart: 19,
			}]);
			expect(scan.reviewFenceRanges).toEqual([{
				start: 0,
				end: 22,
				closed: true,
				openingStart: 0,
			}]);
		});

		it('keeps semantic longer closers distinct from exact review shadow closers', () => {
			const source = 'Before\n~~~\ninside\n~~~~   \nAfter';
			const scan = scanMarkdown(source);

			expect(scan.semanticFences).toEqual([{
				start: 7,
				end: 26,
				closed: true,
				containerEnded: false,
				openingStart: 7,
				closingContentEnd: 25,
			}]);
			expect(scan.reviewFenceRanges).toEqual([{
				start: 6,
				end: source.length,
				closed: false,
				openingStart: 7,
			}]);
		});
	});

	describe('payload fences', () => {
		it('returns no ranges without an opener', () => {
			expect(scanMarkdown('plain `code`').payloadFenceRanges).toEqual([]);
		});

		it('extends an EOF-unclosed opener to source length', () => {
			const source = '```\ncode';
			expect(scanMarkdown(source).payloadFenceRanges).toEqual([{
				start: 0,
				end: source.length,
				closed: false,
			}]);
		});

		it('rejects a closer sharing the wrapper final line', () => {
			const source = '{++\n```\ncode\n```++}';
			expect(scanMarkdown(source).payloadFenceRanges).toEqual([{
				start: 4,
				end: source.length,
				closed: false,
			}]);
		});

		it('accepts a newline-terminated closer inside the wrapper', () => {
			const source = '{++\n```\ncode\n```\n++}';
			expect(scanMarkdown(source).payloadFenceRanges).toEqual([{
				start: 4,
				end: 17,
				closed: true,
			}]);
			expect(source.slice(13, 17)).toBe('```\n');
		});

		it('pairs sequential fences and skips openers inside a closed range', () => {
			const sequential = scanMarkdown('```\na\n```\n~~~\nb\n~~~\n');
			expect(sequential.payloadFenceRanges).toEqual([
				{ start: 0, end: 10, closed: true },
				{ start: 10, end: 20, closed: true },
			]);
			expect(scanMarkdown('```\n~~~\n```\n').payloadFenceRanges).toEqual([
				{ start: 0, end: 12, closed: true },
			]);
		});

		it('retains a later unclosed opener after an earlier pair', () => {
			const source = '```\na\n```\n~~~\nb\n';
			expect(scanMarkdown(source).payloadFenceRanges).toEqual([
				{ start: 0, end: 10, closed: true },
				{ start: 10, end: source.length, closed: false },
			]);
		});
	});
});

describe('scanMarkdownEditStructure', () => {
	function inlineSpans(source: string) {
		return scanMarkdownEditStructure(scanMarkdown(source)).inlineCodeSpans;
	}

	it('returns complete and adjacent spans', () => {
		expect(inlineSpans('`one` `two`')).toEqual([
			{ start: 0, end: 5 },
			{ start: 6, end: 11 },
		]);
	});

	it('returns multiline spans and nested unequal runs', () => {
		expect(inlineSpans('Before\n``alpha\nbeta``\nafter')).toEqual([{ start: 7, end: 21 }]);
		expect(inlineSpans('``a`b``')).toEqual([{ start: 0, end: 7 }]);
	});

	it('does not pair unequal or unmatched runs', () => {
		expect(inlineSpans('Before ``alpha` after')).toEqual([]);
		expect(inlineSpans('Before `alpha`` after')).toEqual([]);
		expect(inlineSpans('Before `alpha after')).toEqual([]);
	});

	it('skips escaped openers but treats closing runs as delimiters after either backslash parity', () => {
		expect(inlineSpans('\\`alpha`')).toEqual([]);
		expect(inlineSpans('`alpha\\`')).toEqual([{ start: 0, end: 8 }]);
		expect(inlineSpans('`alpha\\\\`')).toEqual([{ start: 0, end: 9 }]);
		expect(inlineSpans('\\\\`alpha`')).toEqual([{ start: 2, end: 9 }]);
	});

	it.each([
		['lazy continuation', '`alpha\nordinary\nbeta`', [{ start: 0, end: 21 }]],
		['heading', '`alpha\n# heading\nbeta`', []],
		['HTML block', '`alpha\n<div>\nbeta`', []],
		['blank line', '`alpha\n\nbeta`', []],
	])('honors $name boundaries', (_name, source, spans) => {
		expect(inlineSpans(source)).toEqual(spans);
	});

	it('honors matching containers and lazy continuations after a container mismatch', () => {
		expect(inlineSpans('> `alpha\n> beta`')).toEqual([{ start: 2, end: 16 }]);
		expect(inlineSpans('> `alpha\nbeta`')).toEqual([{ start: 2, end: 14 }]);
		expect(inlineSpans('> `alpha\n# heading`')).toEqual([]);
	});

	it('excludes semantic fences while retaining backtick-info inline spans', () => {
		expect(inlineSpans('```\n`alpha`\n```')).toEqual([]);
		expect(inlineSpans('```alpha```')).toEqual([{ start: 0, end: 11 }]);
	});

	it('preserves UTF-16 offsets around inline spans', () => {
		expect(inlineSpans('🙂 前 `café 值` 后')).toEqual([{ start: 5, end: 13 }]);
	});
});

describe('Markdown lookup and literal helpers', () => {
	it('looks up one-based lines at every strict line-ending boundary', () => {
		const lines = scanMarkdown('a\r\nb\rc\n').lines;
		expect([0, 1, 2, 3, 4, 5, 6, 7].map((offset) => markdownLineNumberAt(lines, offset))).toEqual([
			1, 1, 1, 2, 2, 3, 3, 4,
		]);
		expect(markdownLineNumberAt(scanMarkdown('a\nb').lines, 1)).toBe(1);
		expect(markdownLineNumberAt(scanMarkdown('a\nb').lines, 2)).toBe(2);
		expect(markdownLineNumberAt(scanMarkdown('a\nb').lines, 3)).toBe(2);
		expect(markdownLineNumberAt([], 0)).toBe(1);
	});

	it('uses odd/even backslash parity for literal escapes', () => {
		expect(isMarkdownEscaped('\\|', 1)).toBe(true);
		expect(isMarkdownEscaped('\\\\|', 2)).toBe(false);
		expect(isMarkdownEscaped('abc', 0)).toBe(false);
	});

	it('returns exact backtick run ends', () => {
		expect(markdownBacktickRunEnd('``alpha```', 0)).toBe(2);
		expect(markdownBacktickRunEnd('``alpha```', 7)).toBe(10);
		expect(markdownBacktickRunEnd('alpha', 2)).toBe(2);
	});

	it('distinguishes block starts from prose and inline backtick runs', () => {
		expect(isMarkdownBlockStart('# Heading')).toBe(true);
		expect(isMarkdownBlockStart('```ts')).toBe(true);
		expect(isMarkdownBlockStart('<div>')).toBe(true);
		expect(isMarkdownBlockStart('```alpha```')).toBe(false);
		expect(isMarkdownBlockStart('ordinary prose')).toBe(false);
	});
});
