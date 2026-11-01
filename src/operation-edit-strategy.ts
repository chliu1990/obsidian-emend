import { prepareCriticMarkupEdit } from './critic-markup';
import type { EditStrategy } from './edit-strategy';
import { appendInstructions, HISTORY_PERMISSION_PROMPT } from './mode';
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

const FULL_NOTE_PROMPT = `You are Emend, an AI editor for an Obsidian note. Return only a bare JSON array of edit operations against the complete original note. Do not return a rewritten document, prose, Markdown, or a code fence.
The closed command union is:
- {"type":"insert","anchor":"exact original text","position":"before"|"after","text":"nonempty inserted text","occurrence":1}
- {"type":"remove","target":"exact original text","occurrence":1}
- {"type":"replace","target":"exact original text","replacement":"nonempty replacement","occurrence":1}
- {"type":"comment","target":"exact original text","comment":"nonempty comment","occurrence":1}
The occurrence field is optional. Omit it only when the anchor or target occurs exactly once; otherwise use a one-based positive integer. Use no other commands or fields. Return [] when no change is needed. Never include CriticMarkup delimiters in operation strings.

${HISTORY_PERMISSION_PROMPT}`;

const SELECTION_PROMPT = `You are Emend, an AI editor for a selected portion of an Obsidian note. Return only a bare JSON array of edit operations against the selected portion. Do not return the full note, a rewritten document, prose, Markdown, or a code fence. Every anchor and target must be inside the selection.
The closed command union is:
- {"type":"insert","anchor":"exact original text","position":"before"|"after","text":"nonempty inserted text","occurrence":1}
- {"type":"remove","target":"exact original text","occurrence":1}
- {"type":"replace","target":"exact original text","replacement":"nonempty replacement","occurrence":1}
- {"type":"comment","target":"exact original text","comment":"nonempty comment","occurrence":1}
The occurrence field is optional. Omit it only when the anchor or target occurs exactly once; otherwise use a one-based positive integer. Use no other commands or fields. Return [] when no change is needed. Never include CriticMarkup delimiters in operation strings.`;

export const operationEditStrategy: EditStrategy = {
	id: 'operations',
	getFullNotePrompt: (instructions?: InstructionPromptParts) =>
		appendInstructions(FULL_NOTE_PROMPT, instructions),
	getSelectionPrompt: (instructions?: InstructionPromptParts) =>
		appendInstructions(SELECTION_PROMPT, instructions),
	prepareEdit: (original, response) =>
		prepareCriticMarkupEdit(original, compileEditOperations(original, response)),
};

export function compileEditOperations(original: string, response: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(response);
	} catch {
		throw new Error('Operation edit response must be a bare JSON array.');
	}
	if (!Array.isArray(parsed)) {
		throw new Error('Operation edit response must be a bare JSON array.');
	}

	const resolved = parsed.map((value, order) =>
		resolveOperation(original, parseOperation(value, order), order),
	);
	validateRangeIsolation(resolved);

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
					text: `{~~${operation.target}~>${operation.replacement}~~}`,
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

	changes.sort((left, right) => right.start - left.start || right.order - left.order);
	let compiled = original;
	for (const change of changes) {
		compiled = `${compiled.slice(0, change.start)}${change.text}${compiled.slice(change.end)}`;
	}
	return compiled;
}

function parseOperation(value: unknown, index: number): EditOperation {
	if (
		!isRecord(value) ||
		typeof value.type !== 'string' ||
		!Object.prototype.hasOwnProperty.call(OPERATION_FIELDS, value.type)
	) {
		throw new Error(`Operation ${index + 1} has an unknown type or malformed value.`);
	}
	const type = value.type as EditOperation['type'];
	const allowedFields = OPERATION_FIELDS[type];
	if (Object.keys(value).some((field) => !allowedFields.includes(field))) {
		throw new Error(`Operation ${index + 1} contains unknown fields.`);
	}
	const occurrence = parseOccurrence(value.occurrence, index);
	switch (type) {
		case 'insert': {
			const anchor = requiredString(value, 'anchor', index);
			const text = requiredString(value, 'text', index);
			if (value.position !== 'before' && value.position !== 'after') {
				throw new Error(`Insert operation ${index + 1} has an invalid position.`);
			}
			return { type, anchor, position: value.position, text, occurrence };
		}
		case 'remove':
			return { type, target: requiredString(value, 'target', index), occurrence };
		case 'replace':
			return {
				type,
				target: requiredString(value, 'target', index),
				replacement: requiredString(value, 'replacement', index),
				occurrence,
			};
		case 'comment':
			return {
				type,
				target: requiredString(value, 'target', index),
				comment: requiredString(value, 'comment', index),
				occurrence,
			};
	}
}

function requiredString(
	value: Record<string, unknown>,
	field: string,
	index: number,
): string {
	const text = value[field];
	if (typeof text !== 'string' || text.length === 0) {
		throw new Error(`Operation ${index + 1} requires a nonempty ${field} string.`);
	}
	if (CRITIC_MARKUP_DELIMITERS.some((delimiter) => text.includes(delimiter))) {
		throw new Error(`Operation ${index + 1} contains a CriticMarkup delimiter.`);
	}
	return text;
}

function parseOccurrence(value: unknown, index: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(`Operation ${index + 1} has an invalid occurrence.`);
	}
	return value;
}

function resolveOperation(
	original: string,
	operation: EditOperation,
	order: number,
): ResolvedOperation {
	const text = operation.type === 'insert' ? operation.anchor : operation.target;
	const anchorRange = findOriginalRange(original, text, operation.occurrence, order);
	return { operation, anchorRange, order };
}

function findOriginalRange(
	original: string,
	text: string,
	occurrence: number | undefined,
	index: number,
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
	if (matches.length === 0) {
		throw new Error(`Operation ${index + 1} anchor or target was not found in the original snapshot.`);
	}
	if (occurrence === undefined) {
		if (matches.length !== 1) {
			throw new Error(`Operation ${index + 1} anchor or target is ambiguous; specify occurrence.`);
		}
		const onlyMatch = matches[0];
		if (!onlyMatch) {
			throw new Error(`Operation ${index + 1} has no original match.`);
		}
		return onlyMatch;
	}
	const match = matches[occurrence - 1];
	if (!match) {
		throw new Error(`Operation ${index + 1} occurrence is out of range.`);
	}
	return match;
}

function validateRangeIsolation(resolved: ResolvedOperation[]): void {
	const targets = resolved.filter((item) => item.operation.type !== 'insert');
	for (const [index, left] of targets.entries()) {
		for (const right of targets.slice(index + 1)) {
			if (rangesOverlap(left.anchorRange, right.anchorRange)) {
				throw new Error('Operation target ranges overlap.');
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
		if (targets.some((target) =>
			rangesOverlap(item.anchorRange, target.anchorRange) ||
			(position >= target.anchorRange.start && position <= target.anchorRange.end)
		)) {
			throw new Error('Insertion anchor or position is ambiguous with another operation target.');
		}
	}
}

function rangesOverlap(left: OriginalRange, right: OriginalRange): boolean {
	return left.start < right.end && right.start < left.end;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
