import {
	isMarkdownBlockStart,
	isMarkdownEscaped,
	markdownBacktickRunEnd,
	markdownLineNumberAt,
	scanMarkdown,
	scanMarkdownEditStructure,
	type MarkdownLine,
} from './markdown-scanner';
import type { EditOperation } from './types';

interface SourceRange {
	start: number;
	end: number;
}

type SourceLine = Pick<MarkdownLine, 'start' | 'end' | 'contentEnd' | 'text'>;

type TableCell = SourceRange;

interface TableRow extends SourceRange {
	contentStart: number;
	contentEnd: number;
	cells: TableCell[];
}

interface MarkdownTable extends SourceRange {
	header: TableRow;
	delimiter: SourceRange;
	body: TableRow[];
}

export interface GuardedMarkdownOperation extends SourceRange {
	operation: number;
	operationType: EditOperation['type'];
	insertionPoint?: number;
	text?: string;
	replacement?: string;
	comment?: string;
	compiledText?: string;
}

export interface MarkdownEditViolation {
	code: 'inline-code-range' | 'fenced-code-edit' | 'table-structure-edit';
	operation: number;
	operationType: EditOperation['type'];
	field: 'anchor' | 'target' | 'text' | 'replacement' | 'comment';
	line: number;
}

export function findMarkdownEditViolation(
	fullText: string,
	operations: readonly GuardedMarkdownOperation[],
): MarkdownEditViolation | undefined {
	const scan = scanMarkdown(fullText);
	const { lines, semanticFences: fences, reviewFenceRanges } = scan;
	const { inlineCodeSpans: inlineSpans } = scanMarkdownEditStructure(scan);
	const tables = scanTables(lines, fences);

	for (const operation of operations) {
		const field: MarkdownEditViolation['field'] = operation.operationType === 'insert' ? 'anchor' : 'target';
		const line = markdownLineNumberAt(
			lines,
			operation.operationType === 'insert'
				? operation.insertionPoint ?? operation.start
				: operation.start,
		);
		const violation = (
			code: MarkdownEditViolation['code'],
			violationField: MarkdownEditViolation['field'] = field,
		): MarkdownEditViolation => ({
			code,
			operation: operation.operation,
			operationType: operation.operationType,
			field: violationField,
			line,
		});

		if (operation.operationType === 'insert') {
			if (fences.some((fence) =>
				strictlyInside(operation.insertionPoint, fence) ||
				(!fence.closed && !fence.containerEnded && operation.insertionPoint === fence.end && operation.insertionPoint > fence.start)
			)) {
				return violation('fenced-code-edit');
			}
			const insertedText = operation.text ?? '';
			if (fences.some((fence) =>
				((operation.insertionPoint === fence.start || operation.insertionPoint === fence.openingStart) && !hasTrailingLineBreak(insertedText)) ||
				operation.insertionPoint === fence.closingContentEnd
			)) {
				return violation('fenced-code-edit');
			}
			const semanticOpening = fences.find((fence) =>
				operation.insertionPoint === fence.start || operation.insertionPoint === fence.openingStart
			);
			if (reviewFenceRanges.some((range) => {
				const sameOpening = semanticOpening !== undefined && range.openingStart === semanticOpening.start;
				return !sameOpening && (
					strictlyInside(operation.insertionPoint, range) ||
					(!range.closed && operation.insertionPoint === range.end && operation.insertionPoint > range.start)
				);
			})) {
				return violation('fenced-code-edit');
			}
		} else if (
			fences.some((fence) => intersects(operation, fence)) ||
			reviewFenceRanges.some((range) => intersects(operation, range))
		) {
			return violation('fenced-code-edit');
		}

		if (operation.operationType === 'insert') {
			if (inlineSpans.some((span) => strictlyInside(operation.insertionPoint, span))) {
				return violation('inline-code-range');
			}
			const insertedText = operation.text ?? '';
			if (inlineSpans.some((span) =>
				(operation.insertionPoint === span.start && insertedText.endsWith('`')) ||
				(operation.insertionPoint === span.end && insertedText.startsWith('`'))
			)) {
				return violation('inline-code-range');
			}
		} else if (inlineSpans.some((span) =>
			intersects(operation, span) && !contains(operation, span)
		)) {
			return violation('inline-code-range');
		}

		for (const table of tables) {
			if (operation.operationType === 'insert') {
				if (intersects(operation, table.delimiter) || inside(operation.insertionPoint, table.delimiter)) {
					return violation('table-structure-edit');
				}
			} else if (intersects(operation, table.delimiter)) {
				return violation('table-structure-edit');
			}

			const rows = [table.header, ...table.body];
			const affectedRow = rows.find((row) =>
				row.cells.some((cell) => contains(cell, operation))
			);
			const anchorCell = affectedRow?.cells.find((cell) => contains(cell, operation));
			const touchesTable = intersects(operation, table) ||
				(operation.insertionPoint !== undefined && inside(operation.insertionPoint, table));
			if (!touchesTable) {
				continue;
			}
			if (!affectedRow || !anchorCell) {
				return violation('table-structure-edit');
			}
			if (
				operation.operationType === 'insert' &&
				(operation.insertionPoint === undefined || !inside(operation.insertionPoint, anchorCell))
			) {
				return violation('table-structure-edit');
			}

			const payloadField = operation.operationType === 'insert'
				? 'text'
				: operation.operationType === 'replace'
					? 'replacement'
					: operation.operationType === 'comment'
						? 'comment'
						: undefined;
			if (payloadField && hasTableStructureCharacters(operation[payloadField] ?? '')) {
				return violation('table-structure-edit', payloadField);
			}
			if (!preservesTableRowStructure(
				fullText,
				affectedRow,
				operations.filter((candidate) =>
					affectedRow.cells.some((cell) => contains(cell, candidate))
				),
			)) {
				return violation('table-structure-edit', payloadField ?? field);
			}
		}
	}
	return undefined;
}

export function findPayloadStructureViolation(
	fullText: string,
	operations: readonly GuardedMarkdownOperation[],
): MarkdownEditViolation | undefined {
	const sourceLines = scanMarkdown(fullText).lines;
	for (const operation of operations) {
		const wrapped = wrapOperationPayload(fullText, operation);
		if (!wrapped) {
			continue;
		}
		if (isPayloadStructureBalanced(wrapped)) {
			continue;
		}
		return {
			code: 'fenced-code-edit',
			operation: operation.operation,
			operationType: operation.operationType,
			field: wrapped.field,
			line: markdownLineNumberAt(
				sourceLines,
				operation.operationType === 'insert'
					? operation.insertionPoint ?? operation.start
					: operation.start,
			),
		};
	}
	return undefined;
}

interface WrappedOperationPayload {
	text: string;
	payloadStart: number;
	field: 'text' | 'replacement' | 'comment';
}

function wrapOperationPayload(
	fullText: string,
	operation: GuardedMarkdownOperation,
): WrappedOperationPayload | undefined {
	switch (operation.operationType) {
		case 'insert': {
			const prefix = '{++';
			return {
				text: `${prefix}${operation.text ?? ''}++}`,
				payloadStart: prefix.length,
				field: 'text',
			};
		}
		case 'replace': {
			const prefix = `{~~${fullText.slice(operation.start, operation.end)}~>`;
			return {
				text: `${prefix}${operation.replacement ?? ''}~~}`,
				payloadStart: prefix.length,
				field: 'replacement',
			};
		}
		case 'comment': {
			const prefix = '{>>';
			return {
				text: `${prefix}${operation.comment ?? ''}<<}`,
				payloadStart: prefix.length,
				field: 'comment',
			};
		}
		case 'remove':
			return undefined;
	}
}

function isPayloadStructureBalanced(wrapped: WrappedOperationPayload): boolean {
	const scan = scanMarkdown(wrapped.text);
	if (scan.payloadFenceRanges.some((fence) => !fence.closed)) {
		return false;
	}
	return hasPairedBacktickRuns(wrapped.text, scan.payloadFenceRanges, wrapped.payloadStart);
}

function hasPairedBacktickRuns(
	payload: string,
	fences: readonly SourceRange[],
	payloadStart: number,
): boolean {
	const runs: Array<{ start: number; length: number }> = [];
	let index = 0;
	while (index < payload.length) {
		const fence = fences.find((range) => index >= range.start && index < range.end);
		if (fence) {
			index = fence.end;
			continue;
		}
		if (payload[index] !== '`' || isMarkdownEscaped(payload, index)) {
			index += 1;
			continue;
		}
		const end = markdownBacktickRunEnd(payload, index);
		if (index >= payloadStart) {
			runs.push({ start: index, length: end - index });
		}
		index = end;
	}

	const paired = new Set<number>();
	for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
		if (paired.has(runIndex)) {
			continue;
		}
		const run = runs[runIndex];
		if (!run) {
			continue;
		}
		const partner = runs.findIndex((candidate, candidateIndex) =>
			candidateIndex > runIndex &&
			!paired.has(candidateIndex) &&
			candidate.length === run.length
		);
		if (partner === -1) {
			return false;
		}
		for (let between = runIndex; between <= partner; between += 1) {
			paired.add(between);
		}
	}
	return true;
}

type ContainerSegment =
	| { type: 'quote' }
	| { type: 'indent'; width: number };

interface ContainerOpening {
	contentStart: number;
	segments: ContainerSegment[];
}

function readContainerOpening(text: string): ContainerOpening {
	let contentStart = 0;
	const segments: ContainerSegment[] = [];
	while (contentStart < text.length) {
		const remaining = text.slice(contentStart);
		const quote = /^ {0,3}>[ \t]?/.exec(remaining)?.[0];
		if (quote) {
			contentStart += quote.length;
			segments.push({ type: 'quote' });
			continue;
		}
		const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(remaining)?.[0];
		if (!list) {
			break;
		}
		contentStart += list.length;
		segments.push({ type: 'indent', width: visualWidth(list) });
	}
	return { contentStart, segments };
}

function matchContainer(text: string, segments: readonly ContainerSegment[]): number | undefined {
	let contentStart = 0;
	for (const segment of segments) {
		if (segment.type === 'quote') {
			const quote = /^ {0,3}>[ \t]?/.exec(text.slice(contentStart))?.[0];
			if (!quote) {
				return undefined;
			}
			contentStart += quote.length;
			continue;
		}
		let width = 0;
		while (width < segment.width) {
			const character = text[contentStart];
			if (character === ' ') {
				width += 1;
			} else if (character === '\t') {
				width += 4 - (width % 4);
			} else {
				return undefined;
			}
			contentStart += 1;
		}
	}
	return contentStart;
}

function visualWidth(text: string): number {
	let width = 0;
	for (const character of text) {
		width = character === '\t' ? width + 4 - (width % 4) : width + 1;
	}
	return width;
}

function scanTables(lines: readonly SourceLine[], fences: readonly SourceRange[]): MarkdownTable[] {
	const tables: MarkdownTable[] = [];
	for (let index = 0; index + 1 < lines.length; index += 1) {
		const headerLine = lines[index];
		const delimiterLine = lines[index + 1];
		if (!headerLine || !delimiterLine || inAnyRange(headerLine, fences) || inAnyRange(delimiterLine, fences)) {
			continue;
		}
		const container = readContainerOpening(headerLine.text);
		if (!hasUnescapedPipe(headerLine.text.slice(container.contentStart))) {
			continue;
		}
		const delimiterStart = matchContainer(delimiterLine.text, container.segments);
		if (delimiterStart === undefined || !isDelimiterRow(delimiterLine, delimiterStart)) {
			continue;
		}

		const header = tableRow(headerLine, container.contentStart);
		const body: TableRow[] = [];
		let end = delimiterLine.end;
		let bodyIndex = index + 2;
		for (; bodyIndex < lines.length; bodyIndex += 1) {
			const line = lines[bodyIndex];
			if (!line || line.text.trim().length === 0 || inAnyRange(line, fences)) {
				break;
			}
			const contentStart = matchContainer(line.text, container.segments);
			if (contentStart === undefined || isTableBodyTerminator(line.text.slice(contentStart))) {
				break;
			}
			body.push(tableRow(line, contentStart));
			end = line.end;
		}
		tables.push({
			start: headerLine.start,
			end,
			header,
			delimiter: { start: delimiterLine.start, end: delimiterLine.end },
			body,
		});
		index = bodyIndex - 1;
	}
	return tables;
}

function isDelimiterRow(line: SourceLine, contentStart: number): boolean {
	const cells = splitTableRow(line, contentStart);
	return cells.length > 0 && cells.every((cell) =>
		/^:?-+:?$/.test(line.text.slice(cell.start, cell.end).trim())
	);
}

function isTableBodyTerminator(text: string): boolean {
	return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(text) ||
		/^ {0,3}>/.test(text) ||
		/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(text) ||
		/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
}

function tableRow(line: SourceLine, contentStart = 0): TableRow {
	return {
		start: line.start,
		end: line.end,
		contentStart: line.start + contentStart,
		contentEnd: line.contentEnd,
		cells: splitTableRow(line, contentStart).map((cell) => ({
			start: line.start + cell.start,
			end: line.start + cell.end,
		})),
	};
}

function preservesTableRowStructure(
	fullText: string,
	row: TableRow,
	operations: readonly GuardedMarkdownOperation[],
): boolean {
	const original = fullText.slice(row.start, row.contentEnd);
	let annotated = original;
	let accepted = original;
	const ordered = operations.slice().sort((left, right) =>
		compiledOperationStart(right) - compiledOperationStart(left) || right.operation - left.operation
	);
	for (const operation of ordered) {
		const start = compiledOperationStart(operation) - row.start;
		const end = operation.operationType === 'insert' ? start : operation.end - row.start;
		const target = original.slice(start, end);
		const compiledText = operation.compiledText ?? fallbackCompiledText(operation, target);
		annotated = `${annotated.slice(0, start)}${compiledText}${annotated.slice(end)}`;
		const acceptedText = operation.operationType === 'insert'
			? operation.text ?? ''
			: operation.operationType === 'replace'
				? operation.replacement ?? ''
				: operation.operationType === 'comment'
					? target
					: '';
		accepted = `${accepted.slice(0, start)}${acceptedText}${accepted.slice(end)}`;
	}
	const contentStart = row.contentStart - row.start;
	const originalSignature = tableRowViewSignature(original, contentStart);
	return [annotated, accepted, original].every((candidate) =>
		tableRowViewSignature(candidate, contentStart) === originalSignature
	);
}

function compiledOperationStart(operation: GuardedMarkdownOperation): number {
	return operation.operationType === 'insert'
		? operation.insertionPoint ?? operation.start
		: operation.start;
}

function fallbackCompiledText(operation: GuardedMarkdownOperation, target: string): string {
	switch (operation.operationType) {
		case 'insert':
			return `{++${operation.text ?? ''}++}`;
		case 'remove':
			return `{--${target}--}`;
		case 'replace':
			return `{~~${target}~>${operation.replacement ?? ''}~~}`;
		case 'comment':
			return `${target}{>>${operation.comment ?? ''}<<}`;
	}
}

function tableRowViewSignature(text: string, contentStart: number): string {
	const line: SourceLine = { start: 0, end: text.length, contentEnd: text.length, text };
	const cellCount = splitTableRow(line, contentStart).length;
	let trimmedStart = contentStart;
	while (text[trimmedStart] === ' ' || text[trimmedStart] === '\t') {
		trimmedStart += 1;
	}
	let trimmedEnd = text.length;
	while (trimmedEnd > trimmedStart && (text[trimmedEnd - 1] === ' ' || text[trimmedEnd - 1] === '\t')) {
		trimmedEnd -= 1;
	}
	const leadingOuterPipe = text[trimmedStart] === '|' && !isMarkdownEscaped(text, trimmedStart);
	const trailingOuterPipe = trimmedEnd > trimmedStart && text[trimmedEnd - 1] === '|' && !isMarkdownEscaped(text, trimmedEnd - 1);
	return JSON.stringify({
		cellCount,
		leadingOuterPipe,
		trailingOuterPipe,
		blockStart: isMarkdownBlockStart(text.slice(contentStart)),
		indentedCodeStart: /^ {4}/.test(text.slice(contentStart)) || text[contentStart] === '\t',
	});
}

function hasTrailingLineBreak(text: string): boolean {
	return text.endsWith('\n') || text.endsWith('\r');
}

function splitTableRow(line: SourceLine, contentStart = 0): SourceRange[] {
	const pipes: number[] = [];
	for (let index = contentStart; index < line.text.length; index += 1) {
		if (line.text[index] === '|' && !isMarkdownEscaped(line.text, index)) {
			pipes.push(index);
		}
	}
	if (pipes.length === 0) {
		return [{ start: contentStart, end: line.text.length }];
	}
	let trimmedStart = contentStart;
	while (line.text[trimmedStart] === ' ' || line.text[trimmedStart] === '\t') {
		trimmedStart += 1;
	}
	let trimmedEnd = line.text.length;
	while (trimmedEnd > trimmedStart && (line.text[trimmedEnd - 1] === ' ' || line.text[trimmedEnd - 1] === '\t')) {
		trimmedEnd -= 1;
	}
	const starts = [contentStart, ...pipes.map((pipe) => pipe + 1)];
	const ends = [...pipes, line.text.length];
	const cells = starts.map((start, index) => ({ start, end: ends[index] ?? line.text.length }));
	if (pipes[0] === trimmedStart) {
		cells.shift();
	}
	if (pipes[pipes.length - 1] === trimmedEnd - 1) {
		cells.pop();
	}
	return cells;
}

function hasUnescapedPipe(text: string): boolean {
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === '|' && !isMarkdownEscaped(text, index)) {
			return true;
		}
	}
	return false;
}

function hasTableStructureCharacters(text: string): boolean {
	if (text.includes('\r') || text.includes('\n')) {
		return true;
	}
	return hasUnescapedPipe(text);
}

function inAnyRange(line: SourceLine, ranges: readonly SourceRange[]): boolean {
	return ranges.some((range) => intersects(line, range));
}

function intersects(left: SourceRange, right: SourceRange): boolean {
	return left.start < right.end && right.start < left.end;
}

function contains(outer: SourceRange, inner: SourceRange): boolean {
	return outer.start <= inner.start && outer.end >= inner.end;
}

function inside(point: number | undefined, range: SourceRange): boolean {
	return point !== undefined && point >= range.start && point <= range.end;
}

function strictlyInside(point: number | undefined, range: SourceRange): boolean {
	return point !== undefined && point > range.start && point < range.end;
}
