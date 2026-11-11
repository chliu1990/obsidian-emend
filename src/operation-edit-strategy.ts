import { prepareCriticMarkupEdit } from './critic-markup';
import type {
	EditSourceContext,
	EditStrategy,
	EditSummaryItem,
} from './edit-strategy';
import {
	EditResponseValidationError,
	EditSourceValidationError,
} from './edit-validation';
import {
	findMarkdownEditViolation,
	type GuardedMarkdownOperation,
	type MarkdownEditViolation,
} from './markdown-edit-guards';
import { appendInstructions, HISTORY_PERMISSION_PROMPT } from './mode';
import { createReplacementCompiler } from './replacement-diff';
import type { EditOperation, InstructionPromptParts } from './types';

const CRITIC_MARKUP_DELIMITERS = [
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
];

const OPERATION_FIELDS: Record<EditOperation['type'], readonly string[]> = {
	insert: ['type', 'anchor', 'position', 'text', 'occurrence'],
	remove: ['type', 'target', 'occurrence'],
	replace: ['type', 'target', 'replacement', 'occurrence'],
	comment: ['type', 'target', 'comment', 'occurrence'],
};

interface OriginalRange {
	start: number;
	end: number;
}

interface ResolvedOperation {
	operation: EditOperation;
	anchorRange: OriginalRange;
	order: number;
}

interface CompiledRange extends OriginalRange {
	text: string;
	order: number;
}

interface CompiledEditOperations {
	compiledMarkdown: string;
	summaryItems: readonly EditSummaryItem[];
	summary?: string;
}

interface ParsedEditResponse {
	operations: unknown[];
	summary?: string;
}

const SUMMARY_MAX_CHARACTERS = 2000;
const RESPONSE_FIELD_KEYS = ['operations', 'summary'];

const MINIMAL_TARGET_PROMPT = 'For every edit, use the smallest complete semantic target that contains the change. Put independent edits in separate nonoverlapping operations instead of broadening one target. Use insert for pure additions and remove for pure deletions. When text repeats, keep the target minimal and use occurrence rather than broadening the target.';
const MARKDOWN_STRUCTURE_PROMPT = 'Do not target or insert inside fenced code. Inline code targets must include the complete backtick-delimited span. Tables allow only text edits within one existing header or body cell; do not edit rows, columns, or delimiter rows, and do not insert newlines or unescaped | separators.';

const FULL_NOTE_PROMPT = `You are Emend, an AI editor for an Obsidian note. Return only JSON against the complete original note in one of two accepted forms: a bare JSON array of edit operations, or an envelope object {"summary":"optional short note","operations":[...]}. Do not return a rewritten document, prose, Markdown, or a code fence.
The optional "summary" is a short note to the user about what changed and why. It is shown in chat and never written into the note.
The closed command union is:
- {"type":"insert","anchor":"exact original text","position":"before"|"after","text":"nonempty inserted text","occurrence":1}
- {"type":"remove","target":"exact original text","occurrence":1}
- {"type":"replace","target":"exact original text","replacement":"nonempty replacement","occurrence":1}
- {"type":"comment","target":"exact original text","comment":"nonempty comment","occurrence":1}
The occurrence field is optional. Omit it only when the anchor or target occurs exactly once; otherwise use a one-based positive integer. Use no other commands or fields. Return [] when no change is needed. Never include CriticMarkup delimiters in operation strings.
${MINIMAL_TARGET_PROMPT}
${MARKDOWN_STRUCTURE_PROMPT}

${HISTORY_PERMISSION_PROMPT}`;

const SELECTION_PROMPT = `You are Emend, an AI editor for a selected portion of an Obsidian note. Return only JSON against the selected portion in one of two accepted forms: a bare JSON array of edit operations, or an envelope object {"summary":"optional short note","operations":[...]}. Do not return the full note, a rewritten document, prose, Markdown, or a code fence. Every anchor and target must be inside the selection.
The optional "summary" is a short note to the user about what changed and why. It is shown in chat and never written into the note.
The closed command union is:
- {"type":"insert","anchor":"exact original text","position":"before"|"after","text":"nonempty inserted text","occurrence":1}
- {"type":"remove","target":"exact original text","occurrence":1}
- {"type":"replace","target":"exact original text","replacement":"nonempty replacement","occurrence":1}
- {"type":"comment","target":"exact original text","comment":"nonempty comment","occurrence":1}
The occurrence field is optional. Omit it only when the anchor or target occurs exactly once; otherwise use a one-based positive integer. Use no other commands or fields. Return [] when no change is needed. Never include CriticMarkup delimiters in operation strings.
${MINIMAL_TARGET_PROMPT}
${MARKDOWN_STRUCTURE_PROMPT}
${HISTORY_PERMISSION_PROMPT}`;

export const operationEditStrategy: EditStrategy = {
	id: 'operations',
	getFullNotePrompt: (instructions?: InstructionPromptParts) =>
		appendInstructions(FULL_NOTE_PROMPT, instructions),
	getSelectionPrompt: (instructions?: InstructionPromptParts) =>
		appendInstructions(SELECTION_PROMPT, instructions),
	prepareEdit: (original, response, sourceContext) => {
		try {
			prepareCriticMarkupEdit(original, original);
		} catch {
			throw new EditSourceValidationError();
		}

		let compiled: CompiledEditOperations;
		try {
			compiled = compileEditOperationsWithSummary(original, response, sourceContext);
		} catch (error) {
			if (error instanceof EditResponseValidationError) {
				throw error;
			}
			throw new EditResponseValidationError(
				'invalid-operation',
				'Operations could not be compiled against the unchanged original snapshot.',
			);
		}

		try {
			const preparation = prepareCriticMarkupEdit(original, compiled.compiledMarkdown);
			return {
				...preparation,
				summaryItems: compiled.summaryItems,
				...(compiled.summary ? { summary: compiled.summary } : {}),
			};
		} catch {
			throw new EditResponseValidationError(
				'compiled-markup-rejected',
				'Compiled operations were rejected by CriticMarkup validation; revise the operations to preserve existing markup and reject-view content.',
			);
		}
	},
};

export function compileEditOperations(
	original: string,
	response: string,
	sourceContext?: EditSourceContext,
): string {
	return compileEditOperationsWithSummary(original, response, sourceContext).compiledMarkdown;
}

function compileEditOperationsWithSummary(
	original: string,
	response: string,
	sourceContext?: EditSourceContext,
): CompiledEditOperations {
	const parsed = parseEditResponse(response);

	const resolved = parsed.operations.map((value, order) =>
		resolveOperation(original, parseOperation(value, order), order),
	);
	validateRangeIsolation(resolved);
	const compileReplacement = createReplacementCompiler();

	const changes: CompiledRange[] = resolved.map(({ operation, anchorRange, order }) => {
		switch (operation.type) {
			case 'insert': {
				const start = operation.position === 'before'
					? anchorRange.start
					: anchorRange.end;
				return { start, end: start, text: `{++${operation.text}++}`, order };
			}
			case 'remove':
				return { ...anchorRange, text: `{--${operation.target}--}`, order };
			case 'replace':
				return {
					...anchorRange,
					text: compileReplacement(operation.target, operation.replacement),
					order,
				};
			case 'comment':
				return {
					...anchorRange,
					text: `${operation.target}{>>${operation.comment}<<}`,
					order,
				};
		}
	});
	validateMarkdownStructure(resolved, sourceContext ?? {
		fullText: original,
		from: 0,
		to: original.length,
	}, changes);

	const summaryItems = resolved
		.filter(({ operation }) => !isUnchangedReplacement(operation))
		.map(summaryItemFor);

	changes.sort((left, right) => right.start - left.start || right.order - left.order);
	let compiled = original;
	for (const change of changes) {
		compiled = `${compiled.slice(0, change.start)}${change.text}${compiled.slice(change.end)}`;
	}
	return {
		compiledMarkdown: compiled,
		summaryItems,
		...(parsed.summary ? { summary: parsed.summary } : {}),
	};
}

function parseEditResponse(response: string): ParsedEditResponse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(response);
	} catch {
		throw new EditResponseValidationError(
			'invalid-json',
			'Operation edit response must be a bare JSON array of operations or an envelope object with operations and an optional summary.',
		);
	}
	if (Array.isArray(parsed)) {
		return { operations: parsed };
	}
	if (!isRecord(parsed)) {
		throw invalidResponseShape(
			'Edit response must be a bare JSON array of operations or an envelope object with operations and an optional summary.',
		);
	}

	const unknownKey = Object.keys(parsed).find((key) => !RESPONSE_FIELD_KEYS.includes(key));
	if (unknownKey !== undefined) {
		throw invalidResponseShape(
			`Envelope response contains an unknown field ${JSON.stringify(unknownKey).slice(0, 80)}; use only operations and summary.`,
		);
	}
	const operations = parsed.operations;
	if (!Object.prototype.hasOwnProperty.call(parsed, 'operations') || !Array.isArray(operations)) {
		throw invalidResponseShape(
			'Envelope response requires an operations array.',
		);
	}
	return {
		operations,
		...(parsed.summary === undefined ? {} : { summary: parseSummary(parsed.summary) }),
	};
}

function parseSummary(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		throw invalidResponseShape('Envelope summary must be a string when present.');
	}
	const summary = value.trim();
	if (summary.length === 0) {
		return undefined;
	}
	if (summary.length <= SUMMARY_MAX_CHARACTERS) {
		return summary;
	}
	return `${truncateSummary(summary)}…`;
}

function truncateSummary(summary: string): string {
	const capped = summary.slice(0, SUMMARY_MAX_CHARACTERS);
	for (let index = capped.length - 1; index >= 0; index -= 1) {
		if (/\s/.test(capped[index] ?? '')) {
			return withoutTrailingHighSurrogate(capped.slice(0, index).trimEnd());
		}
	}
	return withoutTrailingHighSurrogate(capped);
}

function withoutTrailingHighSurrogate(text: string): string {
	const last = text.charCodeAt(text.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

function invalidResponseShape(message: string): EditResponseValidationError {
	return new EditResponseValidationError('invalid-response-shape', message);
}

function isUnchangedReplacement(operation: EditOperation): boolean {
	return operation.type === 'replace' && operation.target === operation.replacement;
}

function summaryItemFor({ operation, anchorRange }: ResolvedOperation): EditSummaryItem {
	if (operation.type === 'insert') {
		return {
			type: operation.type,
			start: anchorRange.start,
			end: anchorRange.end,
			insertionPoint: operation.position === 'before'
				? anchorRange.start
				: anchorRange.end,
		};
	}
	return {
		type: operation.type,
		start: anchorRange.start,
		end: anchorRange.end,
	};
}

function validateMarkdownStructure(
	resolved: readonly ResolvedOperation[],
	sourceContext: EditSourceContext,
	changes: readonly CompiledRange[],
): void {
	const operations: GuardedMarkdownOperation[] = resolved.map(({ operation, anchorRange, order }) => {
		const base = {
			operation: order + 1,
			operationType: operation.type,
			start: sourceContext.from + anchorRange.start,
			end: sourceContext.from + anchorRange.end,
			compiledText: changes[order]?.text,
		};
		switch (operation.type) {
			case 'insert':
				return {
					...base,
					insertionPoint: sourceContext.from + (operation.position === 'before'
						? anchorRange.start
						: anchorRange.end),
					text: operation.text,
				};
			case 'remove':
				return base;
			case 'replace':
				return { ...base, replacement: operation.replacement };
			case 'comment':
				return { ...base, comment: operation.comment };
		}
	});
	const violation = findMarkdownEditViolation(sourceContext.fullText, operations);
	if (violation) {
		throw markdownEditValidationError(violation);
	}
}

function markdownEditValidationError(
	violation: MarkdownEditViolation,
): EditResponseValidationError {
	const { operation, operationType, field, line } = violation;
	const details = { operation, operationType, field, line };
	if (violation.code === 'inline-code-range') {
		const message = operationType === 'insert'
			? `Operation ${operation} insertion is inside an inline code span at line ${line}; insert before or after the complete span instead. No edits were applied.`
			: `Operation ${operation} target intersects an inline code span without containing it completely at line ${line}; target the complete span including backtick delimiters or text wholly outside it. No edits were applied.`;
		return new EditResponseValidationError(violation.code, message, details);
	}
	if (violation.code === 'fenced-code-edit') {
		return new EditResponseValidationError(
			violation.code,
			`Operation ${operation} edits fenced code at line ${line}; Track Changes cannot review fenced-code edits. Choose text outside the fenced block. No edits were applied.`,
			details,
		);
	}
	return new EditResponseValidationError(
		violation.code,
		`Operation ${operation} changes table structure at line ${line}; edit only text within one existing header or body cell and preserve rows, columns, delimiter rows, and unescaped | separators. No edits were applied.`,
		details,
	);
}

function parseOperation(value: unknown, index: number): EditOperation {
	if (
		!isRecord(value) ||
		typeof value.type !== 'string' ||
		!Object.prototype.hasOwnProperty.call(OPERATION_FIELDS, value.type)
	) {
		throw new EditResponseValidationError(
			'invalid-operation',
			`Operation ${index + 1} has an unknown type or malformed value.`,
			{ operation: index + 1, field: 'type' },
		);
	}
	const type = value.type as EditOperation['type'];
	const allowedFields = OPERATION_FIELDS[type];
	const unknownField = Object.keys(value).find((field) => !allowedFields.includes(field));
	if (unknownField !== undefined) {
		throw new EditResponseValidationError(
			'invalid-operation',
			`Operation ${index + 1} contains unknown fields; use only the fields allowed for ${type}.`,
			{ operation: index + 1, operationType: type, field: unknownField },
		);
	}
	const occurrence = parseOccurrence(value.occurrence, index, type);
	switch (type) {
		case 'insert': {
			const anchor = requiredString(value, 'anchor', index, type);
			const text = requiredString(value, 'text', index, type);
			if (value.position !== 'before' && value.position !== 'after') {
				throw new EditResponseValidationError(
					'invalid-operation',
					`Insert operation ${index + 1} has an invalid position; use before or after.`,
					{ operation: index + 1, operationType: type, field: 'position' },
				);
			}
			return { type, anchor, position: value.position, text, occurrence };
		}
		case 'remove':
			return { type, target: requiredString(value, 'target', index, type), occurrence };
		case 'replace':
			return {
				type,
				target: requiredString(value, 'target', index, type),
				replacement: requiredString(value, 'replacement', index, type),
				occurrence,
			};
		case 'comment':
			return {
				type,
				target: requiredString(value, 'target', index, type),
				comment: requiredString(value, 'comment', index, type),
				occurrence,
			};
	}
}

function requiredString(
	value: Record<string, unknown>,
	field: 'anchor' | 'target' | 'text' | 'replacement' | 'comment',
	index: number,
	operationType: EditOperation['type'],
): string {
	const text = value[field];
	if (typeof text !== 'string' || text.length === 0) {
		const code = field === 'anchor'
			? 'missing-anchor'
			: field === 'target'
				? 'missing-target'
				: 'invalid-operation';
		throw new EditResponseValidationError(
			code,
			`Operation ${index + 1} requires a nonempty ${field} string.`,
			{ operation: index + 1, operationType, field },
		);
	}
	if (CRITIC_MARKUP_DELIMITERS.some((delimiter) => text.includes(delimiter))) {
		throw new EditResponseValidationError(
			'invalid-operation',
			`Operation ${index + 1} contains a CriticMarkup delimiter in ${field}; remove the delimiter.`,
			{ operation: index + 1, operationType, field },
		);
	}
	return text;
}

function parseOccurrence(
	value: unknown,
	index: number,
	operationType: EditOperation['type'],
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new EditResponseValidationError(
			'invalid-operation',
			`Operation ${index + 1} has an invalid occurrence; use a one-based positive integer.`,
			{ operation: index + 1, operationType, field: 'occurrence' },
		);
	}
	return value;
}

function resolveOperation(
	original: string,
	operation: EditOperation,
	order: number,
): ResolvedOperation {
	const text = operation.type === 'insert' ? operation.anchor : operation.target;
	const anchorRange = findOriginalRange(
		original,
		text,
		operation.occurrence,
		order,
		operation.type,
	);
	return { operation, anchorRange, order };
}

function findOriginalRange(
	original: string,
	text: string,
	occurrence: number | undefined,
	index: number,
	operationType: EditOperation['type'],
): OriginalRange {
	const matches: OriginalRange[] = [];
	let fromIndex = 0;
	while (fromIndex <= original.length - text.length) {
		const start = original.indexOf(text, fromIndex);
		if (start === -1) {
			break;
		}
		matches.push({ start, end: start + text.length });
		fromIndex = start + 1;
	}

	const field = operationType === 'insert' ? 'anchor' : 'target';
	const matchCount = matches.length;
	const matchLines = matches.slice(0, 8).map((match) => sourceLineAt(original, match.start));
	const details = { operation: index + 1, operationType, field, matchCount, matchLines };
	if (matches.length === 0) {
		const code = field === 'anchor' ? 'missing-anchor' : 'missing-target';
		throw new EditResponseValidationError(
			code,
			`Operation ${index + 1} ${field} was not found in the unchanged original snapshot; use exact original text.`,
			details,
		);
	}
	if (occurrence === undefined) {
		if (matches.length !== 1) {
			const code = field === 'anchor' ? 'ambiguous-anchor' : 'ambiguous-target';
			throw new EditResponseValidationError(
				code,
				`Operation ${index + 1} ${field} is ambiguous: ${matchCount} matches at lines ${matchLines.join(', ')}; specify occurrence from 1 to ${matchCount}.`,
				details,
			);
		}
		const onlyMatch = matches[0];
		if (!onlyMatch) {
			throw new EditResponseValidationError(
				'invalid-operation',
				`Operation ${index + 1} has no original match.`,
				details,
			);
		}
		return onlyMatch;
	}
	const match = matches[occurrence - 1];
	if (!match) {
		throw new EditResponseValidationError(
			'occurrence-out-of-range',
			`Operation ${index + 1} occurrence ${occurrence} is out of range: ${matchCount} matches are available; use an occurrence from 1 to ${matchCount}.`,
			{ ...details, occurrence },
		);
	}
	return match;
}

function sourceLineAt(original: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index += 1) {
		if (original[index] === '\n') {
			line += 1;
		}
	}
	return line;
}

function validateRangeIsolation(resolved: ResolvedOperation[]): void {
	const targets = resolved.filter((item) => item.operation.type !== 'insert');
	for (const [index, left] of targets.entries()) {
		for (const right of targets.slice(index + 1)) {
			if (rangesOverlap(left.anchorRange, right.anchorRange)) {
				throw new EditResponseValidationError(
					'overlapping-targets',
					`Operation ${left.order + 1} target overlaps operation ${right.order + 1} target; use disjoint original ranges.`,
					{
						operation: left.order + 1,
						relatedOperation: right.order + 1,
						operationType: left.operation.type,
						field: 'target',
					},
				);
			}
		}
	}

	for (const item of resolved) {
		if (item.operation.type !== 'insert') {
			continue;
		}
		const position = item.operation.position === 'before'
			? item.anchorRange.start
			: item.anchorRange.end;
		const conflict = targets.find((target) =>
			rangesOverlap(item.anchorRange, target.anchorRange) ||
			(position >= target.anchorRange.start && position <= target.anchorRange.end)
		);
		if (conflict) {
			throw new EditResponseValidationError(
				'ambiguous-insertion',
				`Operation ${item.order + 1} insertion conflicts with operation ${conflict.order + 1} target; use a nonoverlapping anchor and insertion position.`,
				{
					operation: item.order + 1,
					relatedOperation: conflict.order + 1,
					operationType: item.operation.type,
					field: 'anchor',
				},
			);
		}
	}
}

function rangesOverlap(left: OriginalRange, right: OriginalRange): boolean {
	return left.start < right.end && right.start < left.end;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
