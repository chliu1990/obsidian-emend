import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	containsCriticMarkupDelimiter,
	createEmendCriticMarkupToken,
	parseCriticMarkup,
	prepareCriticMarkupEdit,
	toRejectView,
} from '../src/critic-markup';
import type { EmendMarkupTokenType } from '../src/critic-markup';
import type { EditPreparation, EditSummaryItem } from '../src/edit-strategy';

function tokenSummary(text: string) {
	return parseCriticMarkup(text).map((token) => ({
		type: token.type,
		raw: token.raw,
		content: token.content,
	}));
}

describe('CriticMarkup parser', () => {
	it('parses an insertion with its exact raw source and offsets', () => {
		const text = 'Before {++new text++} after';
		expect(parseCriticMarkup(text)).toEqual([
			{
				type: 'insertion',
				raw: '{++new text++}',
				content: 'new text',
				start: 7,
				end: 21,
			},
		]);
	});

	it('parses deletions, comments, and highlights', () => {
		expect(tokenSummary('{--old--}{>>note<<}{==important==}')).toEqual([
			{ type: 'deletion', raw: '{--old--}', content: 'old' },
			{ type: 'comment', raw: '{>>note<<}', content: 'note' },
			{ type: 'highlight', raw: '{==important==}', content: 'important' },
		]);
	});

	it('parses both sides of a substitution', () => {
		expect(parseCriticMarkup('{~~old text~>new text~~}')).toEqual([
			{
				type: 'substitution',
				raw: '{~~old text~>new text~~}',
				content: 'old text~>new text',
				oldText: 'old text',
				newText: 'new text',
				start: 0,
				end: 24,
			},
		]);
	});

	it('parses multiline tokens without changing their contents', () => {
		const text = '{++first\nsecond++}\n{~~old\nlines~>new\nlines~~}';
		expect(tokenSummary(text)).toEqual([
			{ type: 'insertion', raw: '{++first\nsecond++}', content: 'first\nsecond' },
			{
				type: 'substitution',
				raw: '{~~old\nlines~>new\nlines~~}',
				content: 'old\nlines~>new\nlines',
			},
		]);
	});

	it('parses adjacent tokens independently', () => {
		expect(tokenSummary('{++a++}{--b--}{~~c~>d~~}')).toEqual([
			{ type: 'insertion', raw: '{++a++}', content: 'a' },
			{ type: 'deletion', raw: '{--b--}', content: 'b' },
			{ type: 'substitution', raw: '{~~c~>d~~}', content: 'c~>d' },
		]);
	});

	it('leaves ordinary braces and punctuation unparsed', () => {
		const text = 'Objects {like: true}, { + }, ~>, and } are ordinary.';
		expect(parseCriticMarkup(text)).toEqual([]);
		expect(toRejectView(text)).toBe(text);
	});

	it.each([
		'{++unclosed insertion',
		'{--unclosed deletion',
		'{~~old~>new',
		'{>>unclosed comment',
		'{==unclosed highlight',
	])('rejects an unmatched opening delimiter: %s', (text) => {
		expect(() => parseCriticMarkup(text)).toThrow(/unclosed/i);
	});

	it.each(['++}', '--}', '~~}', '<<}', '==}'])(
		'rejects an unmatched closing delimiter: %s',
		(text) => {
			expect(() => parseCriticMarkup(text)).toThrow(/unexpected/i);
		},
	);

	it.each([
		'{++outer {--inner--} outer++}',
		'{--outer {++inner++} outer--}',
		'{~~old {>>inner<<}~>new~~}',
		'{>>outer {==inner==} outer<<}',
		'{==outer {++inner++} outer==}',
	])('rejects nested markup: %s', (text) => {
		expect(() => parseCriticMarkup(text)).toThrow(/nested/i);
	});

	it('rejects a substitution without its separator', () => {
		expect(() => parseCriticMarkup('{~~old and new~~}')).toThrow(/separator/i);
	});

	it('rejects a substitution with multiple separators', () => {
		expect(() => parseCriticMarkup('{~~old~>middle~>new~~}')).toThrow(/separator/i);
	});

	it('rejects a mismatched closing delimiter inside a token', () => {
		expect(() => parseCriticMarkup('{++insertion--}')).toThrow(/unclosed|mismatched/i);
	});
});

describe('CriticMarkup reject view', () => {
	it.each([
		['insertions', 'a {++new++}b', 'a b'],
		['deletions', 'a {--old--}b', 'a oldb'],
		['substitutions', 'a {~~old~>new~~}b', 'a oldb'],
		['comments', 'a {>>explanation<<}b', 'a b'],
		['highlights', 'a {==important==}b', 'a importantb'],
	])('removes or unwraps %s according to reject semantics', (_name, text, expected) => {
		expect(toRejectView(text)).toBe(expected);
	});

	it('preserves all ordinary text and newlines exactly', () => {
		const text = '# Title\n\nKeep  spacing\tand trailing newlines.\n\n';
		expect(toRejectView(text)).toBe(text);
	});
});

describe('CriticMarkup edit validation', () => {
	it('accepts every text-changing token while preserving the annotated response', () => {
		const original = 'alpha beta gamma delta';
		const response = '{++inserted ++}alpha {--beta--} {~~gamma~>Gamma~~} {==delta==}';

		expect(prepareCriticMarkupEdit(original, response)).toEqual({
			annotatedMarkdown: response,
			changeCount: 4,
		});
	});

	it('accepts a new comment-only token without counting it as a text change', () => {
		const original = 'Keep this text.';
		const response = 'Keep {>>A comment only.<<}this text.';
		expect(prepareCriticMarkupEdit(original, response)).toEqual({
			annotatedMarkdown: response,
			changeCount: 0,
		});
	});

	it('returns an identical response as a no-op even with existing markup', () => {
		const original = 'Keep {++existing++} {--tracked--} {>>comment<<} text.';
		expect(prepareCriticMarkupEdit(original, original)).toEqual({
			annotatedMarkdown: original,
			changeCount: 0,
		});
	});

	it('requires exact reject-view equality for a valid response', () => {
		const original = '---\ntitle: Example\ntags: [one]\n---\n\n# Heading\n\nKeep  this.\n';
		const response = '---\ntitle: Example\ntags: [one]\n---\n\n# Heading\n\nKeep  {++and preserve ++}this.\n';
		expect(toRejectView(response)).toBe(toRejectView(original));
		expect(prepareCriticMarkupEdit(original, response).annotatedMarkdown).toBe(response);
	});

	it('rejects arbitrary prose', () => {
		expect(() => prepareCriticMarkupEdit('Original note.', 'Here is my answer.')).toThrow();
	});

	it('rejects a different response with no new markup', () => {
		expect(() => prepareCriticMarkupEdit('Original note.', 'Original note!')).toThrow();
	});

	it('rejects code-fenced output', () => {
		const original = '# Title\n\nBody.';
		const response = `\`\`\`markdown\n${original}\n\`\`\``;
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow();
	});

	it.each(['', '   ', '\n\n'])('rejects empty output: %j', (response) => {
		expect(() => prepareCriticMarkupEdit('Original note.', response)).toThrow(/empty/i);
	});

	it('rejects dropped original content even when new markup is present', () => {
		const original = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
		const response = '# Title\n\nFirst paragraph.\n\n{++Replacement.++}\n';
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/reject view/i);
	});

	it('rejects unmarked altered YAML', () => {
		const original = '---\ntitle: Original\n---\nBody\n';
		const response = '---\ntitle: Altered\n---\nBody\n';
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/reject view/i);
	});

	it('rejects malformed response markup', () => {
		expect(() => prepareCriticMarkupEdit('Body', '{++Body')).toThrow(/unclosed/i);
	});

	it('rejects nested response markup', () => {
		expect(() => prepareCriticMarkupEdit('Body', '{=={++Body++}==}')).toThrow(/nested/i);
	});

	it('rejects a removed trailing newline', () => {
		expect(() => prepareCriticMarkupEdit('Body\n', 'Body')).toThrow(/reject view/i);
	});

	it('rejects an unmarked whitespace change', () => {
		expect(() => prepareCriticMarkupEdit('Two  spaces', 'Two spaces')).toThrow(/reject view/i);
	});
});

describe('sequential CriticMarkup edits', () => {
	const existingInsertion = '{++old insertion++}';
	const existingDeletion = '{--old deletion--}';
	const original = `Before ${existingInsertion} middle ${existingDeletion} after.`;

	it('preserves every original token exactly and in order while allowing new tokens outside them', () => {
		const response = `Before ${existingInsertion} {++new insertion++}middle ${existingDeletion} {~~after.~>after!~~}`;
		const preparation = prepareCriticMarkupEdit(original, response);

		expect(preparation).toEqual({ annotatedMarkdown: response, changeCount: 2 });
		const responseTokens = parseCriticMarkup(response).map((token) => token.raw);
		expect(responseTokens).toEqual([
			existingInsertion,
			'{++new insertion++}',
			existingDeletion,
			'{~~after.~>after!~~}',
		]);
	});

	it('allows ordinary content and comments between existing tokens', () => {
		const response = `Before ${existingInsertion} middle{>>new comment<<} ${existingDeletion} after.`;
		expect(prepareCriticMarkupEdit(original, response)).toEqual({
			annotatedMarkdown: response,
			changeCount: 0,
		});
	});

	it('keeps old tracked changes intact through a second edit', () => {
		const firstResponse = `Before ${existingInsertion} {++new insertion++}middle ${existingDeletion} {~~after.~>after!~~}`;
		const secondResponse = `Before ${existingInsertion} {++new insertion++}middle ${existingDeletion} {~~after.~>after!~~}{>>Second edit.<<}`;

		expect(prepareCriticMarkupEdit(firstResponse, secondResponse)).toEqual({
			annotatedMarkdown: secondResponse,
			changeCount: 0,
		});
		expect(parseCriticMarkup(secondResponse).map((token) => token.raw)).toEqual(
			parseCriticMarkup(firstResponse).map((token) => token.raw).concat('{>>Second edit.<<}'),
		);
	});

	it('counts only newly introduced text changes on a second edit', () => {
		const firstResponse = `Before ${existingInsertion} middle ${existingDeletion} after.`;
		const secondResponse = `Before ${existingInsertion} middle ${existingDeletion} {==after.==}`;
		expect(prepareCriticMarkupEdit(firstResponse, secondResponse).changeCount).toBe(1);
	});

	it('rejects a rewritten original token even when its reject view is unchanged', () => {
		const response = `Before {++rewritten insertion++} middle ${existingDeletion} after.`;
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/original token/i);
	});

	it('rejects a dropped original comment even when its reject view is unchanged', () => {
		const originalWithComment = '{>>Keep this comment<<}Body';
		const response = '{++New text++}Body';
		expect(() => prepareCriticMarkupEdit(originalWithComment, response)).toThrow(/original token/i);
	});

	it('rejects reordered original comments even when their reject view is unchanged', () => {
		const originalWithComments = '{>>First<<}{>>Second<<}Body';
		const response = '{>>Second<<}{>>First<<}Body';
		expect(() => prepareCriticMarkupEdit(originalWithComments, response)).toThrow(/original token/i);
	});

	it('rejects relocating an existing insertion without new markup', () => {
		const originalWithInsertion = '{++existing++}Body';
		const response = 'Body{++existing++}';
		expect(() => prepareCriticMarkupEdit(originalWithInsertion, response)).toThrow(
			/new markup/i,
		);
	});

	it('rejects relocating an existing comment without new markup', () => {
		const originalWithComment = '{>>existing<<}Body';
		const response = 'Body{>>existing<<}';
		expect(() => prepareCriticMarkupEdit(originalWithComment, response)).toThrow(
			/new markup/i,
		);
	});

	it('rejects nesting an old token inside a new token', () => {
		const response = `{==Before ${existingInsertion} middle ${existingDeletion} after.==}`;
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/nested/i);
	});
});

describe('edit preparation contract', () => {
	it('retains the validated CriticMarkup preparation shape', () => {
		expectTypeOf<ReturnType<typeof prepareCriticMarkupEdit>>().toEqualTypeOf<{
			annotatedMarkdown: string;
			changeCount: number;
		}>();
	});

	it('requires operation summary metadata on the full EditPreparation', () => {
		expectTypeOf<EditPreparation['summaryItems']>().toEqualTypeOf<
			readonly EditSummaryItem[]
		>();
	});

	it('pins the exact full EditPreparation shape', () => {
		expectTypeOf<EditPreparation>().toEqualTypeOf<{
			annotatedMarkdown: string;
			changeCount: number;
			summaryItems: readonly EditSummaryItem[];
			summary?: string;
		}>();
	});
});

describe('attributed CriticMarkup parser', () => {
	it('parses an attributed insertion with exact metadata and offsets', () => {
		expect(parseCriticMarkup('a{author="Alice"++new++}b')).toEqual([
			{
				type: 'insertion',
				raw: '{author="Alice"++new++}',
				content: 'new',
				start: 1,
				end: 24,
				metadata: {
					raw: 'author="Alice"',
					attributes: { author: 'Alice' },
					author: 'Alice',
				},
			},
		]);
	});

	it.each([
		{
			text: '{author="Alice"--old--}',
			expected: {
				type: 'deletion',
				raw: '{author="Alice"--old--}',
				content: 'old',
				start: 0,
				end: 23,
				metadata: {
					raw: 'author="Alice"',
					attributes: { author: 'Alice' },
					author: 'Alice',
				},
			},
		},
		{
			text: '{author="Alice"~~old~>new~~}',
			expected: {
				type: 'substitution',
				raw: '{author="Alice"~~old~>new~~}',
				content: 'old~>new',
				oldText: 'old',
				newText: 'new',
				start: 0,
				end: 28,
				metadata: {
					raw: 'author="Alice"',
					attributes: { author: 'Alice' },
					author: 'Alice',
				},
			},
		},
		{
			text: '{author="Alice">>note<<}',
			expected: {
				type: 'comment',
				raw: '{author="Alice">>note<<}',
				content: 'note',
				start: 0,
				end: 24,
				metadata: {
					raw: 'author="Alice"',
					attributes: { author: 'Alice' },
					author: 'Alice',
				},
			},
		},
		{
			text: '{author="Alice"==important==}',
			expected: {
				type: 'highlight',
				raw: '{author="Alice"==important==}',
				content: 'important',
				start: 0,
				end: 29,
				metadata: {
					raw: 'author="Alice"',
					attributes: { author: 'Alice' },
					author: 'Alice',
				},
			},
		},
	])('parses an attributed $expected.type', ({ text, expected }) => {
		expect(parseCriticMarkup(text)).toEqual([expected]);
	});

	it('preserves multiple attributes and trailing whitespace exactly', () => {
		const text = 'a{author=" Alice " date="2026-11-25" reviewer="A B" ++new++}b';
		expect(parseCriticMarkup(text)).toEqual([
			{
				type: 'insertion',
				raw: '{author=" Alice " date="2026-11-25" reviewer="A B" ++new++}',
				content: 'new',
				start: 1,
				end: 60,
				metadata: {
					raw: 'author=" Alice " date="2026-11-25" reviewer="A B" ',
					attributes: {
						author: 'Alice',
						date: '2026-11-25',
						reviewer: 'A B',
					},
					author: 'Alice',
					date: '2026-11-25',
				},
			},
		]);
	});

	it('normalizes keys and keeps the first nonempty duplicate value', () => {
		const text = '{AUTHOR=" Alice " author="Bob" DATE="" date="2026-11-25" REVIEWER=" \t" ++new++}';
		const [token] = parseCriticMarkup(text);
		expect(token?.metadata).toEqual({
			raw: 'AUTHOR=" Alice " author="Bob" DATE="" date="2026-11-25" REVIEWER=" \t" ',
			attributes: { author: 'Alice', date: '2026-11-25' },
			author: 'Alice',
			date: '2026-11-25',
		});
	});

	it('stores valid prototype-related keys as harmless own data', () => {
		const [token] = parseCriticMarkup(
			'{constructor="safe" hasOwnProperty="value" ++new++}',
		);
		const attributes = token?.metadata?.attributes;
		if (!attributes) {
			throw new Error('Expected parsed attributes.');
		}
		expect(Object.getPrototypeOf(attributes)).toBeNull();
		expect(Object.prototype.hasOwnProperty.call(attributes, 'constructor')).toBe(true);
		expect(Object.prototype.hasOwnProperty.call(attributes, 'hasownproperty')).toBe(true);
		expect(attributes.constructor).toBe('safe');
		expect(attributes.hasownproperty).toBe('value');
		expect({}.constructor).toBe(Object);
	});

	it('preserves a lone CR in an attribute value', () => {
		const text = '{author="Ali\rce"++new++}';
		expect(parseCriticMarkup(text)).toEqual([
			{
				type: 'insertion',
				raw: text,
				content: 'new',
				start: 0,
				end: 24,
				metadata: {
					raw: 'author="Ali\rce"',
					attributes: { author: 'Ali\rce' },
					author: 'Ali\rce',
				},
			},
		]);
	});

	it.each([
		['digit-led key', '{1author="Alice"++new++}', 21],
		['underscore-led key', '{_author="Alice"++new++}', 21],
		['prototype key with a leading underscore', '{__proto__="safe"++new++}', 22],
		['whitespace around equals', '{author = "Alice"++new++}', 22],
		['whitespace after equals', '{author= "Alice"++new++}', 21],
		['missing quotes', '{author=Alice++new++}', 18],
		['unterminated quote', '{author="Alice++new++}', 19],
		['quote inside a value', '{author="Ali"ce"++new++}', 21],
		['opening brace inside a value', '{author="Ali{ce"++new++}', 21],
		['closing brace inside a value', '{author="Ali}ce"++new++}', 21],
		['LF inside a value', '{author="Ali\nce"++new++}', 21],
		['whitespace without an attribute', '{ ++new++}', 7],
	])('retains bare closer scanning for a malformed %s', (_name, text, offset) => {
		expect(() => parseCriticMarkup(text)).toThrow(
			new Error(`Unexpected CriticMarkup closing delimiter at offset ${offset}.`),
		);
	});

	it.each([
		'{1author="Alice"++new++}',
		'{_author="Alice"++new++}',
		'{__proto__="safe"++new++}',
		'{author = "Alice"++new++}',
		'{author= "Alice"++new++}',
		'{author=Alice++new++}',
		'{author="Alice++new++}',
		'{author="Ali"ce"++new++}',
		'{author="Ali{ce"++new++}',
		'{author="Ali}ce"++new++}',
		'{author="Ali\nce"++new++}',
		'{ ++new++}',
	])('does not manufacture a token from malformed attributes without a closer: %j', (text) => {
		const withoutCloser = text.slice(0, -3);
		expect(parseCriticMarkup(withoutCloser)).toEqual([]);
		expect(toRejectView(withoutCloser)).toBe(withoutCloser);
	});

	it.each([
		['insertion', '++'],
		['deletion', '--'],
		['substitution', '~~'],
		['comment', '>>'],
		['highlight', '=='],
	])('reports an unclosed attributed %s without exposing metadata', (type, marker) => {
		const text = `x{author="SecretAlice"${marker}content`;
		expect(() => parseCriticMarkup(text)).toThrow(
			new Error(`Unclosed ${type} at offset 1.`),
		);
	});

	it('rejects nested attributed openers', () => {
		const text = '{author="Outer"++outer {author="Inner"--inner--} outer++}';
		expect(() => parseCriticMarkup(text)).toThrow(
			new Error('Nested CriticMarkup token inside token at offset 0.'),
		);
	});
});

describe('attributed CriticMarkup projections and preservation', () => {
	it.each([
		['insertions', 'a {author="Alice"++new++}b', 'a {++new++}b', 'a b'],
		['deletions', 'a {author="Alice"--old--}b', 'a {--old--}b', 'a oldb'],
		[
			'substitutions',
			'a {author="Alice"~~old~>new~~}b',
			'a {~~old~>new~~}b',
			'a oldb',
		],
		['comments', 'a {author="Alice">>note<<}b', 'a {>>note<<}b', 'a b'],
		[
			'highlights',
			'a {author="Alice"==important==}b',
			'a {==important==}b',
			'a importantb',
		],
	])('gives attributed %s their bare reject view', (_name, attributed, bare, expected) => {
		expect(toRejectView(attributed)).toBe(expected);
		expect(toRejectView(attributed)).toBe(toRejectView(bare));
	});

	it('preserves bare and attributed originals while counting only new non-comment tokens', () => {
		const original =
			'Before {++bare++} {author="Alice"--old--} {author="Alice">>keep<<} after.';
		const response =
			'Before {++bare++}{author="Emend"++new++} {author="Alice"--old--} {author="Alice">>keep<<}{author="Emend">>new comment<<} after.';
		expect(prepareCriticMarkupEdit(original, response)).toEqual({
			annotatedMarkdown: response,
			changeCount: 1,
		});
	});

	it.each([
		['rewritten', '{author="Bob"++existing++}Body'],
		['dropped', '{++existing++}Body'],
	])('rejects %s attribution even when the reject view matches', (_name, response) => {
		const original = '{author="Alice"++existing++}Body';
		expect(toRejectView(response)).toBe(toRejectView(original));
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/original token/i);
	});

	it('rejects nesting an attributed token in a new token during edit validation', () => {
		expect(() =>
			prepareCriticMarkupEdit(
				'Body',
				'{==outer {author="Alice"++Body++} outer==}',
			),
		).toThrow(/nested|mismatched/i);
	});

	it('rejects an unclosed attributed token during edit validation', () => {
		expect(() => prepareCriticMarkupEdit('Body', '{author="Alice"++Body')).toThrow(
			/unclosed insertion/i,
		);
	});

	it('keeps legacy comment-prefix text in attributed comment content', () => {
		const [token] = parseCriticMarkup('{author="Alice">>Alice: legacy note<<}');
		expect(token?.content).toBe('Alice: legacy note');
	});
});

describe('Emend CriticMarkup renderer', () => {
	it.each([
		['insertion', 'new', '{author="Emend"++new++}'],
		['deletion', 'old', '{author="Emend"--old--}'],
		['substitution', 'old~>new', '{author="Emend"~~old~>new~~}'],
		['comment', 'note', '{author="Emend">>note<<}'],
	] as const)('renders an exact attributed %s without a date', (type, content, expected) => {
		const rendered = createEmendCriticMarkupToken(type, content);
		expect(rendered).toBe(expected);
		expect(rendered).not.toContain('date=');
	});

	it('excludes highlights from the renderer type parameter', () => {
		expectTypeOf<EmendMarkupTokenType>().toEqualTypeOf<
			'insertion' | 'deletion' | 'substitution' | 'comment'
		>();
		expectTypeOf<Parameters<typeof createEmendCriticMarkupToken>[0]>().toEqualTypeOf<
			EmendMarkupTokenType
		>();
	});
});

describe('CriticMarkup delimiter classification', () => {
	it.each([
		'{++',
		'++}',
		'{--',
		'--}',
		'{~~',
		'~~}',
		'~>',
		'{>>',
		'<<}',
		'{==',
		'==}',
		'{author="Alice"++',
		'{author="Alice" date="2026-11-25" --',
		'{author="Ali\rce"~~',
	])('recognizes the delimiter or valid attributed opener %j', (text) => {
		expect(containsCriticMarkupDelimiter(text)).toBe(true);
	});

	it.each([
		'{like: true}',
		'author="Alice"',
		'{author = "Alice"++new',
		'{_author="Alice"++new',
		'{ ++new',
		'ordinary prose',
	])('does not classify ordinary or malformed text as a delimiter: %j', (text) => {
		expect(containsCriticMarkupDelimiter(text)).toBe(false);
	});
});
