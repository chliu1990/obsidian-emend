import type { EditOperation } from './types';

interface SourceRange {
	start: number;
	end: number;
}

interface SourceLine extends SourceRange {
	contentEnd: number;
	text: string;
}

type TableCell = SourceRange;

interface TableRow extends SourceRange {
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
	const lines = scanLines(fullText);
	const fences = scanFences(lines);
	const inlineSpans = scanInlineCode(fullText, fences);
	const tables = scanTables(lines, fences);

	for (const operation of operations) {
		const field: MarkdownEditViolation['field'] = operation.operationType === 'insert' ? 'anchor' : 'target';
		const line = sourceLineAt(
			fullText,
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
		} else if (fences.some((fence) => intersects(operation, fence))) {
			return violation('fenced-code-edit');
		}

		if (operation.operationType === 'insert') {
			if (inlineSpans.some((span) => strictlyInside(operation.insertionPoint, span))) {
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
			const anchorCell = rows.flatMap((row) => row.cells).find((cell) => contains(cell, operation));
			const touchesTable = intersects(operation, table) ||
				(operation.insertionPoint !== undefined && inside(operation.insertionPoint, table));
			if (!touchesTable) {
				continue;
			}
			if (!anchorCell) {
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
		}
	}
	return undefined;
}

function scanLines(fullText: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let start = 0;
	while (start < fullText.length) {
		let contentEnd = start;
		while (contentEnd < fullText.length && fullText[contentEnd] !== '\n' && fullText[contentEnd] !== '\r') {
			contentEnd += 1;
		}
		let end = contentEnd;
		if (fullText[end] === '\r' && fullText[end + 1] === '\n') {
			end += 2;
		} else if (end < fullText.length) {
			end += 1;
		}
		lines.push({ start, contentEnd, end, text: fullText.slice(start, contentEnd) });
		start = end;
	}
	return lines;
}

interface FenceRange extends SourceRange {
	closed: boolean;
	containerEnded: boolean;
}

type ContainerSegment =
	| { type: 'quote' }
	| { type: 'indent'; width: number };

interface ContainerOpening {
	contentStart: number;
	segments: ContainerSegment[];
}

function scanFences(lines: readonly SourceLine[]): FenceRange[] {
	const fences: FenceRange[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const container = readContainerOpening(line.text);
		const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(
			line.text.slice(container.contentStart),
		);
		const run = opening?.[1];
		if (!run || (run[0] === '`' && opening?.[2]?.includes('`'))) {
			continue;
		}
		const character = run[0];
		let end = line.end;
		let closingIndex = index;
		let closed = false;
		let containerEnded = false;
		for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
			const candidateLine = lines[candidate];
			if (!candidateLine) {
				continue;
			}
			const contentStart = matchContainer(candidateLine.text, container.segments);
			if (contentStart === undefined) {
				containerEnded = true;
				closingIndex = candidate - 1;
				break;
			}
			end = candidateLine.end;
			closingIndex = candidate;
			if (isFenceClose(candidateLine.text.slice(contentStart), character ?? '', run.length)) {
				closed = true;
				break;
			}
		}
		fences.push({ start: line.start, end, closed, containerEnded });
		index = closingIndex;
	}
	return fences;
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

function isFenceClose(text: string, character: string, minimumLength: number): boolean {
	const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(text);
	const run = match?.[1];
	return run !== undefined && run[0] === character && run.length >= minimumLength;
}

function scanInlineCode(fullText: string, fences: readonly SourceRange[]): SourceRange[] {
	const spans: SourceRange[] = [];
	let index = 0;
	while (index < fullText.length) {
		const fence = fences.find((range) => index >= range.start && index < range.end);
		if (fence) {
			index = fence.end;
			continue;
		}
		if (fullText[index] !== '`' || isEscaped(fullText, index)) {
			index += 1;
			continue;
		}
		const openingEnd = backtickRunEnd(fullText, index);
		const runLength = openingEnd - index;
		let cursor = openingEnd;
		let closingEnd: number | undefined;
		while (cursor < fullText.length) {
			const crossingFence = fences.find((range) => range.start >= index && range.start < cursor);
			if (crossingFence) {
				break;
			}
			const containingFence = fences.find((range) => inside(cursor, range));
			if (containingFence) {
				break;
			}
			if (fullText[cursor] !== '`') {
				cursor += 1;
				continue;
			}
			const runEnd = backtickRunEnd(fullText, cursor);
			if (runEnd - cursor === runLength) {
				closingEnd = runEnd;
				break;
			}
			cursor = runEnd;
		}
		if (closingEnd === undefined) {
			index = openingEnd;
			continue;
		}
		spans.push({ start: index, end: closingEnd });
		index = closingEnd;
	}
	return spans;
}

function backtickRunEnd(fullText: string, start: number): number {
	let end = start;
	while (fullText[end] === '`') {
		end += 1;
	}
	return end;
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
		cells: splitTableRow(line, contentStart).map((cell) => ({
			start: line.start + cell.start,
			end: line.start + cell.end,
		})),
	};
}

function splitTableRow(line: SourceLine, contentStart = 0): SourceRange[] {
	const pipes: number[] = [];
	for (let index = contentStart; index < line.text.length; index += 1) {
		if (line.text[index] === '|' && !isEscaped(line.text, index)) {
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
		if (text[index] === '|' && !isEscaped(text, index)) {
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

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
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

function sourceLineAt(fullText: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index += 1) {
		if (fullText[index] === '\n' || (fullText[index] === '\r' && fullText[index + 1] !== '\n')) {
			line += 1;
		}
	}
	return line;
}
