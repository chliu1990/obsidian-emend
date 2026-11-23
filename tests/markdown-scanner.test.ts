import { describe, expect, it } from 'vitest';
import { scanMarkdownContext } from '../src/markdown-scanner';

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
