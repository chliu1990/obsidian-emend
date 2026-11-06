import { describe, expect, it } from 'vitest';
import { parseCriticMarkup, toRejectView } from '../src/critic-markup';
import { createReplacementCompiler } from '../src/replacement-diff';

function toAcceptView(text: string): string {
	const tokens = parseCriticMarkup(text);
	let result = '';
	let cursor = 0;
	for (const token of tokens) {
		result += text.slice(cursor, token.start);
		switch (token.type) {
			case 'insertion':
			case 'highlight':
				result += token.content;
				break;
			case 'deletion':
			case 'comment':
				break;
			case 'substitution':
				result += token.newText ?? '';
				break;
		}
		cursor = token.end;
	}
	return result + text.slice(cursor);
}

function expectReconstruction(markup: string, target: string, replacement: string): void {
	expect(toRejectView(markup)).toBe(target);
	expect(toAcceptView(markup)).toBe(replacement);
}

function largeBoundaryPair() {
	const common = 'a '.repeat(249);
	const oldMiddle = `!${common}?`;
	const newMiddle = `?${common}!`;
	return {
		common,
		oldMiddle,
		newMiddle,
		target: `=${oldMiddle}=`,
		replacement: `=${newMiddle}=`,
		minimal: `={~~!~>?~~}${common}{~~?~>!~~}=`,
		fallback: `={~~${oldMiddle}~>${newMiddle}~~}=`,
	};
}

describe('createReplacementCompiler', () => {
	it('minimizes a sentence-internal replacement', () => {
		const compile = createReplacementCompiler();
		const markup = compile('They have a plan.', 'They has a plan.');

		expect(markup).toBe('They {~~have~>has~~} a plan.');
		expectReconstruction(markup, 'They have a plan.', 'They has a plan.');
	});

	it('emits separated hunks within one broad replacement', () => {
		const compile = createReplacementCompiler();
		const target = 'The quick brown fox jumps over the lazy dog.';
		const replacement = 'The quick red fox leaps over the lazy dog.';

		expect(compile(target, replacement)).toBe(
			'The quick {~~brown~>red~~} fox {~~jumps~>leaps~~} over the lazy dog.',
		);
	});

	it('emits an internal insertion without an empty deletion side', () => {
		const compile = createReplacementCompiler();
		const markup = compile('Alpha beta gamma', 'Alpha brave beta gamma');

		expect(markup).toBe('Alpha {++brave ++}beta gamma');
		expectReconstruction(markup, 'Alpha beta gamma', 'Alpha brave beta gamma');
	});

	it('emits an internal deletion without an empty insertion side', () => {
		const compile = createReplacementCompiler();
		const markup = compile('Alpha brave beta gamma', 'Alpha beta gamma');

		expect(markup).toBe('Alpha {--brave --}beta gamma');
		expectReconstruction(markup, 'Alpha brave beta gamma', 'Alpha beta gamma');
	});

	it('returns identical input as unchanged plain text', () => {
		const compile = createReplacementCompiler();
		expect(compile('Same text.\n', 'Same text.\n')).toBe('Same text.\n');
	});

	it('prefers deletion when repeated-token LCS choices tie', () => {
		const compile = createReplacementCompiler();
		expect(compile('!?', '?!')).toBe('{--!--}?{++!++}');
	});

	it('preserves Markdown punctuation and newlines outside the changed token', () => {
		const compile = createReplacementCompiler();
		const target = '# Title\n\n- old item\n- keep\n';
		const replacement = '# Title\n\n- new item\n- keep\n';

		expect(compile(target, replacement)).toBe(
			'# Title\n\n- {~~old~>new~~} item\n- keep\n',
		);
	});

	it.each([
		['我們有一個計畫。', '我們有一份計畫。', '我們有{~~一個~>一份~~}計畫。'],
		['前🙂後', '前🙃後', '前{~~🙂~>🙃~~}後'],
		['Cafe\u0301 noir', 'Café noir', '{~~Cafe\u0301~>Café~~} noir'],
	])('preserves Unicode while minimizing %s', (target, replacement, expected) => {
		const compile = createReplacementCompiler();
		const markup = compile(target, replacement);

		expect(markup).toBe(expected);
		expectReconstruction(markup, target, replacement);
	});

	it('reconstructs both sides exactly for ordinary separated edits', () => {
		const compile = createReplacementCompiler();
		const target = 'Before old middle and stale end after';
		const replacement = 'Before new middle and fresh end after';
		const markup = compile(target, replacement);

		expectReconstruction(markup, target, replacement);
	});

	it('produces deterministic output across repeated calls and compiler instances', () => {
		const compile = createReplacementCompiler();
		const expected = 'They {~~have~>has~~} a plan.';
		for (let index = 0; index < 5; index += 1) {
			expect(compile('They have a plan.', 'They has a plan.')).toBe(expected);
			expect(createReplacementCompiler()('They have a plan.', 'They has a plan.')).toBe(expected);
		}
	});

	it('falls back to one whole-target substitution when segmentation is unavailable', () => {
		const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
		try {
			Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
			const compile = createReplacementCompiler();

			expect(compile('They have a plan.', 'They has a plan.')).toBe(
				'{~~They have a plan.~>They has a plan.~~}',
			);
			expect(compile('', 'add')).toBe('{++add++}');
			expect(compile('remove', '')).toBe('{--remove--}');
			expect(compile('same', 'same')).toBe('same');
		} finally {
			if (descriptor) {
				Object.defineProperty(Intl, 'Segmenter', descriptor);
			} else {
				Reflect.deleteProperty(Intl, 'Segmenter');
			}
		}
	});

	it('keeps exactly 1,000 middle tokens eligible and falls back at 1,001', () => {
		const eligibleOldMiddle = `${'!'.repeat(998)}?#`;
		const eligible = createReplacementCompiler()(
			`=${eligibleOldMiddle}=`,
			'=?@=',
		);
		expect(eligible).toBe(`={--${'!'.repeat(998)}--}?{~~#~>@~~}=`);

		const fallbackOldMiddle = `${'!'.repeat(999)}?#`;
		const fallback = createReplacementCompiler()(
			`=${fallbackOldMiddle}=`,
			'=?@=',
		);
		expect(fallback).toBe(`={~~${fallbackOldMiddle}~>?@~~}=`);
		expectReconstruction(fallback, `=${fallbackOldMiddle}=`, '=?@=');
	});

	it('keeps exactly 250,000 work eligible', () => {
		const fixture = largeBoundaryPair();
		const markup = createReplacementCompiler()(fixture.target, fixture.replacement);

		expect(markup).toBe(fixture.minimal);
		expectReconstruction(markup, fixture.target, fixture.replacement);
	});

	it('falls back at exactly 250,001 work while retaining equal affixes', () => {
		const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
		try {
			Object.defineProperty(Intl, 'Segmenter', {
				configurable: true,
				value: class {
					segment(input: string) {
						return Array.from(input, (segment) => ({ segment }));
					}
				},
			});
			const newMiddle = '?'.repeat(250001);
			const target = '=!=';
			const replacement = `=${newMiddle}=`;
			const markup = createReplacementCompiler()(target, replacement);

			expect(markup).toBe(`={~~!~>${newMiddle}~~}=`);
			expectReconstruction(markup, target, replacement);
		} finally {
			if (descriptor) {
				Object.defineProperty(Intl, 'Segmenter', descriptor);
			} else {
				Reflect.deleteProperty(Intl, 'Segmenter');
			}
		}
	});

	it('keeps every replacement eligible at exactly 1,000,000 accumulated work', () => {
		const fixture = largeBoundaryPair();
		const compile = createReplacementCompiler();
		for (let index = 0; index < 4; index += 1) {
			expect(compile(fixture.target, fixture.replacement)).toBe(fixture.minimal);
		}
	});

	it('falls back at exactly 1,000,001 accumulated response work', () => {
		const fixture = largeBoundaryPair();
		const compile = createReplacementCompiler();
		expect(compile('have', 'has')).toBe('{~~have~>has~~}');
		for (let index = 0; index < 3; index += 1) {
			expect(compile(fixture.target, fixture.replacement)).toBe(fixture.minimal);
		}

		const markup = compile(fixture.target, fixture.replacement);
		expect(markup).toBe(fixture.fallback);
		expectReconstruction(markup, fixture.target, fixture.replacement);
	});
});
