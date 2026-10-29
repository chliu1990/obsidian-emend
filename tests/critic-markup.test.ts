import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	parseCriticMarkup,
	prepareCriticMarkupEdit,
	toRejectView,
} from '../src/critic-markup';
import {
	criticMarkupEditStrategy,
	type EditPreparation,
	type EditStrategy,
} from '../src/edit-strategy';
import { getSelectionSystemPrompt, getSystemPrompt } from '../src/mode';
import type { InstructionPromptParts } from '../src/types';

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

	it('accepts comments without counting them as text changes', () => {
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

	it('rejects nesting an old token inside a new token', () => {
		const response = `{==Before ${existingInsertion} middle ${existingDeletion} after.==}`;
		expect(() => prepareCriticMarkupEdit(original, response)).toThrow(/nested/i);
	});
});

describe('CriticMarkup edit strategy', () => {
	it('exposes the strategy boundary contract', () => {
		expectTypeOf<EditPreparation>().toEqualTypeOf<{
			annotatedMarkdown: string;
			changeCount: number;
		}>();
		expectTypeOf(criticMarkupEditStrategy).toExtend<EditStrategy>();
		expect(criticMarkupEditStrategy.id).toBe('critic-markup');
	});

	it('delegates full-note and selection prompts to Stage 03', () => {
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([['skills/editing/SKILL.md', 'Editing skill']]),
		};
		expect(criticMarkupEditStrategy.getFullNotePrompt(instructions)).toBe(
			getSystemPrompt('edit', instructions),
		);
		expect(criticMarkupEditStrategy.getSelectionPrompt(instructions)).toBe(
			getSelectionSystemPrompt(instructions),
		);
	});

	it('delegates preparation to the validating engine', () => {
		const original = 'Old text';
		const response = '{~~Old text~>New text~~}';
		expect(criticMarkupEditStrategy.prepareEdit(original, response)).toEqual(
			prepareCriticMarkupEdit(original, response),
		);
	});
});
