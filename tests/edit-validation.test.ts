import { describe, expect, it } from 'vitest';
import {
	EditResponseValidationError,
	EditSourceValidationError,
	formatEditValidationFeedback,
} from '../src/edit-validation';
import {
	compileEditOperations,
	operationEditStrategy,
} from '../src/operation-edit-strategy';

function captureError(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error('Expected validation to fail.');
}

describe('edit validation feedback', () => {
	it('returns the fixed retry instruction and one compact JSON diagnostic', () => {
		const error = captureError(() => compileEditOperations(
			'PRIVATE SOURCE EXCERPT',
			JSON.stringify([{
				type: 'replace',
				target: 'SENTINEL TARGET',
				replacement: 'SENTINEL REPLACEMENT',
			}]),
		));
		expect(error).toBeInstanceOf(EditResponseValidationError);
		if (!(error instanceof EditResponseValidationError)) {
			throw new Error('Expected a response validation error.');
		}

		const feedback = formatEditValidationFeedback(error);
		const lines = feedback.split('\n');
		expect(lines[0]).toBe('Return only a new complete bare JSON array of operations against the unchanged original snapshot.');
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1] ?? '')).toEqual({
			code: 'missing-target',
			operation: 1,
			operationType: 'replace',
			field: 'target',
			matchCount: 0,
			matchLines: [],
		});
		expect(feedback).not.toContain('SENTINEL TARGET');
		expect(feedback).not.toContain('SENTINEL REPLACEMENT');
		expect(feedback).not.toContain('PRIVATE SOURCE EXCERPT');
		expect(feedback).not.toContain('note.md');
		expect(feedback.length).toBeLessThan(4000);
	});

	it('bounds diagnostics even when an unknown field name is oversized', () => {
		const unknownField = `SENTINEL SOURCE ${'x'.repeat(5000)}`;
		const error = captureError(() => compileEditOperations(
			'Alpha',
			JSON.stringify([{ type: 'remove', target: 'Alpha', [unknownField]: true }]),
		));
		expect(error).toBeInstanceOf(EditResponseValidationError);
		if (!(error instanceof EditResponseValidationError)) {
			throw new Error('Expected a response validation error.');
		}

		const feedback = formatEditValidationFeedback(error);
		expect(feedback.length).toBeLessThan(4000);
		expect(feedback).not.toContain(unknownField);
		expect(feedback).not.toContain('SENTINEL SOURCE');
	});

	it('maps a short alphanumeric unknown field to unknown without leaking source text', () => {
		const error = captureError(() => compileEditOperations(
			'SECRET',
			JSON.stringify([{ type: 'remove', target: 'SECRET', SECRET: true }]),
		));
		expect(error).toBeInstanceOf(EditResponseValidationError);
		if (!(error instanceof EditResponseValidationError)) {
			throw new Error('Expected a response validation error.');
		}
		expect(error.field).toBe('SECRET');

		const feedback = formatEditValidationFeedback(error);
		expect(JSON.parse(feedback.split('\n')[1] ?? '')).toMatchObject({
			code: 'invalid-operation',
			field: 'unknown',
		});
		expect(feedback).not.toContain('SECRET');
	});

	it.each(['inline-code-range', 'fenced-code-edit', 'table-structure-edit'] as const)(
		'serializes only allowlisted structural diagnostics for %s',
		(code) => {
			const error = new EditResponseValidationError(
				code,
				'PRIVATE SOURCE TARGET REPLACEMENT COMMENT',
				{ operation: 2, operationType: 'replace', field: 'target', line: 7 },
			);

			const feedback = formatEditValidationFeedback(error);
			expect(JSON.parse(feedback.split('\n')[1] ?? '')).toEqual({
				code,
				operation: 2,
				operationType: 'replace',
				field: 'target',
				line: 7,
			});
			expect(feedback).not.toContain('PRIVATE SOURCE TARGET REPLACEMENT COMMENT');
		},
	);

	it('classifies malformed original markup as a terminal source error', () => {
		const error = captureError(() => operationEditStrategy.prepareEdit(
			'{--UNCLOSED PRIVATE SOURCE',
			'not json',
		));

		expect(error).toBeInstanceOf(EditSourceValidationError);
		expect(error).not.toBeInstanceOf(EditResponseValidationError);
		expect((error as Error).message).not.toContain('UNCLOSED PRIVATE SOURCE');
	});

	it('classifies final Stage 07 candidate rejection as a retryable response error', () => {
		const error = captureError(() => operationEditStrategy.prepareEdit(
			'{--alpha--}',
			JSON.stringify([{ type: 'comment', target: 'alpha', comment: 'nested' }]),
		));

		expect(error).toBeInstanceOf(EditResponseValidationError);
		expect(error).toMatchObject({
			name: 'EditResponseValidationError',
			code: 'compiled-markup-rejected',
		});
		expect((error as Error).message).not.toContain('Nested CriticMarkup');
	});
});
