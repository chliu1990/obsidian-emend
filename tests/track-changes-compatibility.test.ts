import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	parseCriticMarkup,
	prepareCriticMarkupEdit,
	toRejectView,
} from '../src/critic-markup';
import {
	findMarkdownEditViolation,
	type GuardedMarkdownOperation,
} from '../src/markdown-edit-guards';

type FixtureDisposition = 'selected' | 'rejected-alternative';

interface TrackChangesCompatibilityFixture {
	id: string;
	family:
		| 'legacy'
		| 'table-cell'
		| 'table-row'
		| 'table-column'
		| 'table-delimiter'
		| 'table-cross-cell'
		| 'list'
		| 'blockquote';
	disposition: FixtureDisposition;
	limitation?: string;
	original: string;
	bareAnnotated: string;
	emendAnnotated: string;
	accepted: string;
	rejected: string;
	changeCount: number;
}

type FixtureFamily = TrackChangesCompatibilityFixture['family'];

const fixtureFamilies = [
	'legacy',
	'table-cell',
	'table-row',
	'table-column',
	'table-delimiter',
	'table-cross-cell',
	'list',
	'blockquote',
] as const satisfies readonly FixtureFamily[];
const fixtureDispositions = [
	'selected',
	'rejected-alternative',
] as const satisfies readonly FixtureDisposition[];
const expectedSourceConstants = {
	H2: '| A | B |',
	D2: '| --- | --- |',
	R1: '| one | two |',
	R2: '| keep | last |',
	TABLE: '| A | B |\n| --- | --- |\n| one | two |\n',
	H3: '| A | B | C |',
	D3: '| --- | --- | --- |',
	R3: '| one | two | three |',
	TABLE3: '| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n',
	ESCAPED_OLD: 'one \\| two',
	ESCAPED_NEW: 'first \\| second',
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function readString(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	if (typeof value !== 'string') {
		throw new Error(`Fixture ${field} must be a string.`);
	}
	return value;
}

function readEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
): T {
	if (typeof value !== 'string') {
		throw new Error(`Fixture ${field} must be a string.`);
	}
	const match = allowed.find((candidate) => candidate === value);
	if (match === undefined) {
		throw new Error(`Fixture ${field} has an unsupported value.`);
	}
	return match;
}

function parseFixture(value: unknown): TrackChangesCompatibilityFixture {
	if (!isPlainRecord(value)) {
		throw new Error('Fixture must be a plain record.');
	}
	const id = readString(value, 'id');
	if (id.length === 0) {
		throw new Error('Fixture ID must be nonempty.');
	}
	const family = readEnum(value.family, fixtureFamilies, 'family');
	const disposition = readEnum(value.disposition, fixtureDispositions, 'disposition');
	const original = readString(value, 'original');
	const bareAnnotated = readString(value, 'bareAnnotated');
	const emendAnnotated = readString(value, 'emendAnnotated');
	const accepted = readString(value, 'accepted');
	const rejected = readString(value, 'rejected');
	const changeCount = value.changeCount;
	if (
		typeof changeCount !== 'number' ||
		!Number.isInteger(changeCount) ||
		changeCount < 0
	) {
		throw new Error('Fixture changeCount must be a nonnegative integer.');
	}
	if (rejected !== original) {
		throw new Error(`Fixture ${id} rejected bytes must equal its original bytes.`);
	}
	const limitation = value.limitation;
	if (limitation !== undefined && typeof limitation !== 'string') {
		throw new Error(`Fixture ${id} limitation must be a string when present.`);
	}
	if (disposition === 'selected' && limitation !== undefined) {
		throw new Error(`Selected fixture ${id} must not have a limitation.`);
	}
	if (
		disposition === 'rejected-alternative' &&
		(typeof limitation !== 'string' || limitation.trim().length === 0)
	) {
		throw new Error(`Rejected alternative ${id} requires a nonempty limitation.`);
	}
	return {
		id,
		family,
		disposition,
		...(limitation === undefined ? {} : { limitation }),
		original,
		bareAnnotated,
		emendAnnotated,
		accepted,
		rejected,
		changeCount,
	};
}

function parseFixtureCatalog(value: unknown): TrackChangesCompatibilityFixture[] {
	if (!isPlainRecord(value) || !Array.isArray(value.fixtures)) {
		throw new Error('Fixture catalog must be a plain record with a fixtures array.');
	}
	const fixtures = value.fixtures.map((fixture) => parseFixture(fixture));
	const ids = new Set<string>();
	for (const fixture of fixtures) {
		if (ids.has(fixture.id)) {
			throw new Error(`Duplicate fixture ID: ${fixture.id}`);
		}
		ids.add(fixture.id);
	}
	return fixtures;
}

const raw: unknown = JSON.parse(readFileSync(
	new URL('./fixtures/track-changes-compatibility.json', import.meta.url),
	'utf8',
));
const fixtures = parseFixtureCatalog(raw);
const selectedFixtureIds = fixtures
	.filter((fixture) => fixture.disposition === 'selected')
	.map((fixture) => fixture.id);

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

function validFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'example',
		family: 'legacy',
		disposition: 'selected',
		original: 'before\n',
		bareAnnotated: '{~~before~>after~~}\n',
		emendAnnotated: '{author="Emend"~~before~>after~~}\n',
		accepted: 'after\n',
		rejected: 'before\n',
		changeCount: 1,
		...overrides,
	};
}

function expectExactSourceConstants(value: unknown): void {
	expect(value).toEqual(expectedSourceConstants);
}

function expectOnlyEmendAttributionDifference(fixture: {
	bareAnnotated: string;
	emendAnnotated: string;
}): void {
	expect(fixture.emendAnnotated.replaceAll('{author="Emend"', '{')).toBe(fixture.bareAnnotated);
}

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

describe('Track Changes compatibility fixture catalog', () => {
	it('validates the fixture catalog and required structural families', () => {
		expect(fixtures.map((fixture) => ({
			id: fixture.id,
			family: fixture.family,
			disposition: fixture.disposition,
			changeCount: fixture.changeCount,
		}))).toEqual([
			{ id: 'legacy-prose', family: 'legacy', disposition: 'selected', changeCount: 2 },
			{ id: 'table-cell-escaped-pipe-whole-cell', family: 'table-cell', disposition: 'rejected-alternative', changeCount: 1 },
			{ id: 'table-cell-escaped-pipe-minimized', family: 'table-cell', disposition: 'selected', changeCount: 2 },
			{ id: 'table-row-insert-append', family: 'table-row', disposition: 'selected', changeCount: 1 },
			{ id: 'table-row-insert-interior', family: 'table-row', disposition: 'selected', changeCount: 1 },
			{ id: 'table-row-delete', family: 'table-row', disposition: 'selected', changeCount: 1 },
			{ id: 'table-row-replace', family: 'table-row', disposition: 'selected', changeCount: 1 },
			{ id: 'table-column-add-whole-table', family: 'table-column', disposition: 'rejected-alternative', changeCount: 1 },
			{ id: 'table-column-add-per-row', family: 'table-column', disposition: 'selected', changeCount: 3 },
			{ id: 'table-column-delete-whole-table', family: 'table-column', disposition: 'rejected-alternative', changeCount: 1 },
			{ id: 'table-column-delete-per-row', family: 'table-column', disposition: 'selected', changeCount: 3 },
			{ id: 'table-delimiter-replace', family: 'table-delimiter', disposition: 'selected', changeCount: 1 },
			{ id: 'table-cross-cell-replace', family: 'table-cross-cell', disposition: 'selected', changeCount: 1 },
			{ id: 'table-crlf-row-replace', family: 'table-row', disposition: 'selected', changeCount: 1 },
			{ id: 'list-item-insert', family: 'list', disposition: 'selected', changeCount: 1 },
			{ id: 'list-item-delete', family: 'list', disposition: 'selected', changeCount: 1 },
			{ id: 'blockquote-line-replace', family: 'blockquote', disposition: 'selected', changeCount: 1 },
		]);
		expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(fixtures.length);
		for (const fixture of fixtures) {
			expect(fixture.rejected).toBe(fixture.original);
			expect(fixture.bareAnnotated).not.toContain('author=');
			expect(fixture.emendAnnotated).toContain('{author="Emend"');
			expectOnlyEmendAttributionDifference(fixture);
			expect(parseCriticMarkup(fixture.bareAnnotated).length).toBeGreaterThan(0);
			expect(parseCriticMarkup(fixture.emendAnnotated).length).toBeGreaterThan(0);
		}
	});

	it('validates the exact sourceConstants record', () => {
		if (!isPlainRecord(raw)) {
			throw new Error('Fixture catalog must be a plain record.');
		}
		expectExactSourceConstants(raw.sourceConstants);
	});

	it('detects source constant and non-attribution fixture drift', () => {
		for (const sourceConstants of [
			{ ...expectedSourceConstants, H2: '| Changed | B |' },
			Object.fromEntries(Object.entries(expectedSourceConstants)
				.filter(([key]) => key !== 'ESCAPED_OLD')),
		]) {
			expect(() => expectExactSourceConstants(sourceConstants)).toThrow();
		}
		const valid = {
			bareAnnotated: '{~~before~>after~~}\n',
			emendAnnotated: '{author="Emend"~~before~>after~~}\n',
		};
		expectOnlyEmendAttributionDifference(valid);
		for (const fixture of [
			{ ...valid, bareAnnotated: '{~~before~>changed~~}\n' },
			{ ...valid, emendAnnotated: '{author="Reviewer"~~before~>after~~}\n' },
		]) {
			expect(() => expectOnlyEmendAttributionDifference(fixture)).toThrow();
		}
	});

	it('validates unknown fixture data without a TypeScript JSON import', () => {
		const valid = validFixture();
		expect(parseFixtureCatalog({ fixtures: [valid] })).toEqual([valid]);
		for (const value of [
			null,
			42,
			'catalog',
			[],
			{},
			{ fixtures: null },
			{ fixtures: [null] },
			{ fixtures: [[]] },
		]) {
			expect(() => parseFixtureCatalog(value)).toThrow();
		}
		for (const overrides of [
			{ id: '' },
			{ id: 1 },
			{ family: 'table' },
			{ disposition: 'alternative' },
			{ original: 1 },
			{ bareAnnotated: 1 },
			{ emendAnnotated: 1 },
			{ accepted: 1 },
			{ rejected: 1 },
			{ rejected: 'different\n' },
			{ changeCount: -1 },
			{ changeCount: 1.5 },
			{ changeCount: Number.NaN },
			{ limitation: 1 },
		]) {
			expect(() => parseFixtureCatalog({ fixtures: [validFixture(overrides)] })).toThrow();
		}
		expect(() => parseFixtureCatalog({
			fixtures: [validFixture(), validFixture()],
		})).toThrow(/duplicate/i);
	});

	it('requires a documented limitation for every rejected alternative', () => {
		expect(fixtures
			.filter((fixture) => fixture.disposition === 'rejected-alternative')
			.map((fixture) => ({ id: fixture.id, limitation: fixture.limitation })))
			.toEqual([
				{
					id: 'table-cell-escaped-pipe-whole-cell',
					limitation: 'Synthetic whole-cell control; actual minimized Emend output uses two substitutions around the escaped pipe.',
				},
				{
					id: 'table-column-add-whole-table',
					limitation: 'Whole-table substitution replaces unaffected rows; retained as an alternative to the per-row encoding.',
				},
				{
					id: 'table-column-delete-whole-table',
					limitation: 'Whole-table substitution replaces unaffected rows; retained as an alternative to the per-row encoding.',
				},
			]);
		for (const limitation of [undefined, '', '   ']) {
			expect(() => parseFixtureCatalog({
				fixtures: [validFixture({ disposition: 'rejected-alternative', limitation })],
			})).toThrow(/limitation/i);
		}
	});

	it.each([
		{ kind: 'nonempty', limitation: 'Selected fixtures must not document a limitation.' },
		{ kind: 'empty', limitation: '' },
	])('rejects a $kind limitation on a selected fixture', ({ limitation }) => {
		expect(() => parseFixtureCatalog({
			fixtures: [validFixture({ limitation })],
		})).toThrow(/selected fixture.*limitation/i);
	});

	it('exposes only selected fixtures to PR 09 selectedFixtureIds', () => {
		expect(selectedFixtureIds).toEqual([
			'legacy-prose',
			'table-cell-escaped-pipe-minimized',
			'table-row-insert-append',
			'table-row-insert-interior',
			'table-row-delete',
			'table-row-replace',
			'table-column-add-per-row',
			'table-column-delete-per-row',
			'table-delimiter-replace',
			'table-cross-cell-replace',
			'table-crlf-row-replace',
			'list-item-insert',
			'list-item-delete',
			'blockquote-line-replace',
		]);
	});

	it('keeps every required structural family represented by a selected encoding', () => {
		const selectedFamilies = new Set(fixtures
			.filter((fixture) => fixture.disposition === 'selected')
			.map((fixture) => fixture.family));
		expect(selectedFamilies).toEqual(new Set([
			'legacy',
			'table-cell',
			'table-row',
			'table-column',
			'table-delimiter',
			'table-cross-cell',
			'list',
			'blockquote',
		]));
	});

	it.each(fixtures)('$id reconstructs exact bare accept and reject bytes', (fixture) => {
		expect(toAcceptView(fixture.bareAnnotated)).toBe(fixture.accepted);
		expect(toRejectView(fixture.bareAnnotated)).toBe(fixture.rejected);
	});

	it.each(fixtures)('$id reconstructs exact Emend-attributed accept and reject bytes', (fixture) => {
		expect(toAcceptView(fixture.emendAnnotated)).toBe(fixture.accepted);
		expect(toRejectView(fixture.emendAnnotated)).toBe(fixture.rejected);
	});

	it.each(fixtures)('$id preserves reject-view equality and expected change counts', (fixture) => {
		for (const annotated of [fixture.bareAnnotated, fixture.emendAnnotated]) {
			expect(toRejectView(annotated)).toBe(fixture.original);
			expect(prepareCriticMarkupEdit(fixture.original, annotated)).toEqual({
				annotatedMarkdown: annotated,
				changeCount: fixture.changeCount,
			});
		}
	});
});

describe('current Track Changes compatibility boundaries', () => {
	it('keeps row, column, delimiter, and cross-cell Operations fail-closed', () => {
		const fullText = '| Alpha | Beta |\n| --- | --- |\n| one | two |';
		const operations = [
			targetOperation(fullText, '| one | two |'),
			targetOperation(fullText, '| Beta |'),
			targetOperation(fullText, '| --- | --- |'),
			targetOperation(fullText, 'one | two', {
				operationType: 'replace',
				replacement: 'first | second',
			}),
		];
		const lines = [3, 1, 2, 3];
		for (const [index, operation] of operations.entries()) {
			expect(findMarkdownEditViolation(fullText, [operation])).toEqual({
				code: 'table-structure-edit',
				operation: 1,
				operationType: operation.operationType,
				field: 'target',
				line: lines[index],
			});
		}
	});

	it('preserves legacy other-author metadata byte-for-byte', () => {
		const legacy = '{author="Reviewer" date="2026-11-26T00:00:00Z"~~old~>older~~}';
		const added = '{author="Emend"++!++}';
		const original = `Before ${legacy} after.\n`;
		const response = `Before ${legacy}${added} after.\n`;

		expect(parseCriticMarkup(response).map((token) => ({
			raw: token.raw,
			author: token.metadata?.author,
			date: token.metadata?.date,
		}))).toEqual([
			{ raw: legacy, author: 'Reviewer', date: '2026-11-26T00:00:00Z' },
			{ raw: added, author: 'Emend', date: undefined },
		]);
		expect(prepareCriticMarkupEdit(original, response)).toEqual({
			annotatedMarkdown: response,
			changeCount: 1,
		});
		expect(toAcceptView(original)).toBe('Before older after.\n');
		expect(toAcceptView(response)).toBe('Before older! after.\n');
		expect(toRejectView(original)).toBe('Before old after.\n');
		expect(toRejectView(response)).toBe('Before old after.\n');
	});
});
