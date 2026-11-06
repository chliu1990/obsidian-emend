import type { EditOperation } from './types';

export type EditResponseValidationCode =
	| 'invalid-json'
	| 'invalid-response-shape'
	| 'invalid-operation'
	| 'missing-anchor'
	| 'missing-target'
	| 'ambiguous-anchor'
	| 'ambiguous-target'
	| 'occurrence-out-of-range'
	| 'overlapping-targets'
	| 'ambiguous-insertion'
	| 'inline-code-range'
	| 'fenced-code-edit'
	| 'table-structure-edit'
	| 'compiled-markup-rejected';

export interface EditResponseValidationDetails {
	operation?: number;
	relatedOperation?: number;
	operationType?: EditOperation['type'];
	field?: string;
	matchCount?: number;
	occurrence?: number;
	matchLines?: number[];
	line?: number;
}

export class EditResponseValidationError extends Error {
	readonly code: EditResponseValidationCode;
	readonly operation?: number;
	readonly relatedOperation?: number;
	readonly operationType?: EditOperation['type'];
	readonly field?: string;
	readonly matchCount?: number;
	readonly occurrence?: number;
	readonly matchLines?: number[];
	readonly line?: number;

	constructor(
		code: EditResponseValidationCode,
		message: string,
		details: EditResponseValidationDetails = {},
	) {
		super(message);
		this.name = 'EditResponseValidationError';
		this.code = code;
		this.operation = details.operation;
		this.relatedOperation = details.relatedOperation;
		this.operationType = details.operationType;
		this.field = details.field;
		this.matchCount = details.matchCount;
		this.occurrence = details.occurrence;
		this.matchLines = details.matchLines?.slice(0, 8);
		this.line = details.line;
	}
}

export class EditSourceValidationError extends Error {
	constructor() {
		super('The original snapshot contains invalid CriticMarkup; fix the existing markup before requesting edits.');
		this.name = 'EditSourceValidationError';
	}
}

const RETRY_INSTRUCTION = 'Return only a new complete bare JSON array of operations against the unchanged original snapshot.';

export function formatEditValidationFeedback(error: EditResponseValidationError): string {
	const diagnostic: Record<string, string | number | number[]> = { code: error.code };
	if (error.operation !== undefined) {
		diagnostic.operation = error.operation;
	}
	if (error.relatedOperation !== undefined) {
		diagnostic.relatedOperation = error.relatedOperation;
	}
	if (error.operationType !== undefined) {
		diagnostic.operationType = error.operationType;
	}
	if (error.field !== undefined) {
		diagnostic.field = ['type', 'anchor', 'position', 'text', 'occurrence', 'target', 'replacement', 'comment'].includes(error.field)
			? error.field
			: 'unknown';
	}
	if (error.matchCount !== undefined) {
		diagnostic.matchCount = error.matchCount;
	}
	if (error.occurrence !== undefined) {
		diagnostic.occurrence = error.occurrence;
	}
	if (error.matchLines !== undefined) {
		diagnostic.matchLines = error.matchLines.slice(0, 8);
	}
	if (error.line !== undefined) {
		diagnostic.line = error.line;
	}
	return `${RETRY_INSTRUCTION}\n${JSON.stringify(diagnostic)}`;
}
