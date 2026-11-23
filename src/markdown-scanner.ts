export interface MarkdownRange {
	readonly start: number;
	readonly end: number;
}

export interface MarkdownContextLine extends MarkdownRange {
	readonly text: string;
}

export interface MarkdownContextFrontmatter extends MarkdownRange {
	readonly closed: boolean;
	readonly nextLine: number;
}

export interface MarkdownContextFence extends MarkdownRange {
	readonly closed: boolean;
	readonly openingLine: number;
	readonly nextLine: number;
}

export interface MarkdownContextScan {
	readonly source: string;
	readonly contextLines: readonly MarkdownContextLine[];
	readonly contextFrontmatter?: MarkdownContextFrontmatter;
	readonly contextFences: readonly MarkdownContextFence[];
}

export type MarkdownLineEnding = '' | '\n' | '\r' | '\r\n';

export type MarkdownContainerSegment =
	| { readonly type: 'quote' }
	| { readonly type: 'indent'; readonly width: number };

export interface MarkdownContainerOpening {
	readonly contentStart: number;
	readonly segments: readonly MarkdownContainerSegment[];
}

export interface MarkdownLine extends MarkdownRange {
	readonly contentEnd: number;
	readonly text: string;
	readonly ending: MarkdownLineEnding;
	readonly container: MarkdownContainerOpening;
}

export interface MarkdownFenceRange extends MarkdownRange {
	readonly closed: boolean;
	readonly containerEnded: boolean;
	readonly openingStart: number;
	readonly closingContentEnd?: number;
}

export interface MarkdownReviewFenceRange extends MarkdownRange {
	readonly closed: boolean;
	readonly openingStart: number;
}

export interface MarkdownPayloadFenceRange extends MarkdownRange {
	readonly closed: boolean;
}

export interface MarkdownScan {
	readonly source: string;
	readonly lines: readonly MarkdownLine[];
	readonly semanticFences: readonly MarkdownFenceRange[];
	readonly reviewFenceRanges: readonly MarkdownReviewFenceRange[];
	readonly payloadFenceRanges: readonly MarkdownPayloadFenceRange[];
}

export interface MarkdownEditStructure {
	readonly inlineCodeSpans: readonly MarkdownRange[];
}

interface FenceOpening {
	character: '`' | '~';
	length: number;
}

export function scanMarkdownContext(source: string): MarkdownContextScan {
	const contextLines = scanContextLines(source);
	const contextFrontmatter = scanContextFrontmatter(contextLines);
	const contextFences = scanContextFences(
		contextLines,
		contextFrontmatter?.nextLine ?? 0,
	);
	return {
		source,
		contextLines,
		...(contextFrontmatter ? { contextFrontmatter } : {}),
		contextFences,
	};
}

function scanContextLines(source: string): MarkdownContextLine[] {
	const lines: MarkdownContextLine[] = [];
	let start = 0;
	while (start < source.length) {
		const newline = source.indexOf('\n', start);
		const end = newline === -1 ? source.length : newline;
		lines.push({ start, end, text: source.slice(start, end) });
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return lines;
}

function scanContextFrontmatter(
	lines: readonly MarkdownContextLine[],
): MarkdownContextFrontmatter | undefined {
	const first = lines[0];
	if (!first || first.text.trim() !== '---') {
		return undefined;
	}

	let closed = false;
	let endIndex = lines.length - 1;
	let nextLine = lines.length;
	for (let candidate = 1; candidate < lines.length; candidate++) {
		const line = lines[candidate];
		if (!line) {
			continue;
		}
		const text = line.text.trim();
		if (text === '---' || text === '...') {
			closed = true;
			endIndex = candidate;
			nextLine = candidate + 1;
			break;
		}
	}

	const last = lines[endIndex] ?? first;
	return {
		start: first.start,
		end: last.end,
		closed,
		nextLine,
	};
}

function scanContextFences(
	lines: readonly MarkdownContextLine[],
	startLine: number,
): MarkdownContextFence[] {
	const fences: MarkdownContextFence[] = [];
	let index = startLine;
	while (index < lines.length) {
		const line = lines[index];
		if (!line) {
			index++;
			continue;
		}
		const opening = getFenceOpening(line.text);
		if (!opening) {
			index++;
			continue;
		}

		let end = line.end;
		let closed = false;
		let nextLine = index + 1;
		while (nextLine < lines.length) {
			const candidate = lines[nextLine];
			if (!candidate) {
				break;
			}
			end = candidate.end;
			const matches = isFenceClosing(candidate.text, opening);
			nextLine++;
			if (matches) {
				closed = true;
				break;
			}
		}
		fences.push({
			start: line.start,
			end,
			closed,
			openingLine: index,
			nextLine,
		});
		index = nextLine;
	}
	return fences;
}

function getFenceOpening(text: string): FenceOpening | null {
	const match = /^ {0,3}(`{3,}|~{3,})/.exec(text);
	const marker = match?.[1];
	if (!marker) {
		return null;
	}
	return {
		character: marker[0] === '~' ? '~' : '`',
		length: marker.length,
	};
}

function isFenceClosing(text: string, opening: FenceOpening) {
	const trimmed = text.trim();
	let markerLength = 0;
	while (trimmed[markerLength] === opening.character) {
		markerLength++;
	}
	return (
		markerLength >= opening.length &&
		trimmed.slice(markerLength).trim().length === 0
	);
}


export function scanMarkdown(source: string): MarkdownScan {
	const lines = scanStrictLines(source);
	return {
		source,
		lines,
		semanticFences: scanSemanticFences(lines),
		reviewFenceRanges: scanReviewFenceRanges(lines, source),
		payloadFenceRanges: scanPayloadFenceRanges(lines, source),
	};
}

export function scanMarkdownEditStructure(scan: MarkdownScan): MarkdownEditStructure {
	return { inlineCodeSpans: scanInlineCode(scan) };
}

export function markdownLineNumberAt(lines: readonly MarkdownLine[], offset: number): number {
	if (lines.length === 0 || offset < 0) {
		return 1;
	}
	let lower = 0;
	let upper = lines.length;
	while (lower < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if ((lines[middle]?.start ?? 0) <= offset) {
			lower = middle + 1;
		} else {
			upper = middle;
		}
	}
	const lineIndex = Math.max(0, lower - 1);
	const last = lines[lines.length - 1];
	if (lineIndex === lines.length - 1 && last && last.ending && offset >= last.end) {
		return lines.length + 1;
	}
	return lineIndex + 1;
}

export function isMarkdownEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

export function markdownBacktickRunEnd(text: string, start: number): number {
	let end = start;
	while (text[end] === '`') {
		end += 1;
	}
	return end;
}

export function isMarkdownBlockStart(text: string): boolean {
	return isTableBodyTerminator(text) ||
		parseFenceOpening(text) !== undefined ||
		isHtmlBlockStart(text);
}

function scanStrictLines(source: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let start = 0;
	while (start < source.length) {
		let contentEnd = start;
		while (contentEnd < source.length && source[contentEnd] !== '\n' && source[contentEnd] !== '\r') {
			contentEnd += 1;
		}
		let end = contentEnd;
		if (source[end] === '\r' && source[end + 1] === '\n') {
			end += 2;
		} else if (end < source.length) {
			end += 1;
		}
		const text = source.slice(start, contentEnd);
		lines.push({
			start,
			contentEnd,
			end,
			text,
			ending: source.slice(contentEnd, end) as MarkdownLineEnding,
			container: readContainerOpening(text),
		});
		start = end;
	}
	return lines;
}

function scanSemanticFences(lines: readonly MarkdownLine[]): MarkdownFenceRange[] {
	const fences: MarkdownFenceRange[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const opening = parseFenceOpening(line.text.slice(line.container.contentStart));
		const run = opening?.run;
		if (!run) {
			continue;
		}
		const character = run[0];
		const openingStart = line.start + line.container.contentStart + opening.start;
		let end = line.end;
		let closingIndex = index;
		let closed = false;
		let containerEnded = false;
		let closingContentEnd: number | undefined;
		for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
			const candidateLine = lines[candidate];
			if (!candidateLine) {
				continue;
			}
			if (line.container.segments.length > 0 && candidateLine.text.trim().length === 0) {
				end = candidateLine.end;
				closingIndex = candidate;
				continue;
			}
			const contentStart = matchContainer(candidateLine.text, line.container.segments);
			if (contentStart === undefined) {
				containerEnded = true;
				closingIndex = candidate - 1;
				break;
			}
			end = candidateLine.end;
			closingIndex = candidate;
			if (isFenceClose(candidateLine.text.slice(contentStart), character ?? '', run.length)) {
				closed = true;
				closingContentEnd = candidateLine.contentEnd;
				break;
			}
		}
		fences.push({
			start: line.start,
			end,
			closed,
			containerEnded,
			openingStart,
			...(closingContentEnd === undefined ? {} : { closingContentEnd }),
		});
		index = closingIndex;
	}
	return fences;
}

function scanReviewFenceRanges(
	lines: readonly MarkdownLine[],
	source: string,
): MarkdownReviewFenceRange[] {
	const ranges: MarkdownReviewFenceRange[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line || source[line.end - 1] !== '\n') {
			continue;
		}
		const run = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)?.[1];
		if (!run) {
			continue;
		}
		let end = source.length;
		let closingIndex = index;
		let closed = false;
		for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
			const candidateLine = lines[candidate];
			if (!candidateLine) {
				continue;
			}
			closingIndex = candidate;
			if (isExactReviewFenceClose(candidateLine.text, run)) {
				end = candidateLine.contentEnd;
				closed = true;
				break;
			}
		}
		ranges.push({
			start: line.start > 0 ? line.start - 1 : 0,
			end,
			closed,
			openingStart: line.start,
		});
		index = closingIndex;
	}
	return ranges;
}

function scanPayloadFenceRanges(
	lines: readonly MarkdownLine[],
	source: string,
): MarkdownPayloadFenceRange[] {
	const ranges: MarkdownPayloadFenceRange[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const opening = line ? parseFenceOpening(line.text) : undefined;
		const run = opening?.run;
		if (!line || !run) {
			continue;
		}
		let closingIndex = -1;
		for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
			const candidateLine = lines[candidate];
			if (
				candidateLine &&
				candidateLine.end > candidateLine.contentEnd &&
				isFenceClose(candidateLine.text, run[0] ?? '', run.length)
			) {
				closingIndex = candidate;
				break;
			}
		}
		if (closingIndex === -1) {
			ranges.push({ start: line.start, end: source.length, closed: false });
			break;
		}
		const closingLine = lines[closingIndex];
		if (!closingLine) {
			ranges.push({ start: line.start, end: source.length, closed: false });
			break;
		}
		ranges.push({ start: line.start, end: closingLine.end, closed: true });
		index = closingIndex;
	}
	return ranges;
}

function parseFenceOpening(text: string): { run: string; start: number } | undefined {
	const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
	const run = opening?.[1];
	if (!run || (run[0] === '`' && opening?.[2]?.includes('`'))) {
		return undefined;
	}
	return { run, start: (opening?.index ?? 0) + (opening?.[0].indexOf(run) ?? 0) };
}

function readContainerOpening(text: string): MarkdownContainerOpening {
	let contentStart = 0;
	const segments: MarkdownContainerSegment[] = [];
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

function matchContainer(
	text: string,
	segments: readonly MarkdownContainerSegment[],
): number | undefined {
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

function isExactReviewFenceClose(text: string, run: string): boolean {
	return /^ {0,3}(`+|~+)[ \t]*$/.exec(text)?.[1] === run;
}

function scanInlineCode(scan: MarkdownScan): MarkdownRange[] {
	const { source, lines, semanticFences } = scan;
	const spans: MarkdownRange[] = [];
	const linesByStart = new Map(lines.map((line) => [line.start, line]));
	let fenceIndex = 0;
	let openingLineIndex = 0;
	let index = 0;
	while (index < source.length) {
		let fence = semanticFences[fenceIndex];
		while (fence && index >= fence.end) {
			fenceIndex += 1;
			fence = semanticFences[fenceIndex];
		}
		if (fence && index >= fence.start) {
			index = fence.end;
			continue;
		}
		if (source[index] !== '`' || isMarkdownEscaped(source, index)) {
			index += 1;
			continue;
		}
		while ((lines[openingLineIndex]?.end ?? source.length) <= index) {
			openingLineIndex += 1;
		}
		const openingLine = lines[openingLineIndex];
		const container = openingLine && index >= openingLine.start && index < openingLine.end
			? openingLine.container.segments
			: [];
		const openingEnd = markdownBacktickRunEnd(source, index);
		const runLength = openingEnd - index;
		let cursor = openingEnd;
		let innerFenceIndex = fenceIndex;
		let closingEnd: number | undefined;
		while (cursor < source.length) {
			const boundaryLine = linesByStart.get(cursor);
			if (cursor > index && boundaryLine && isInlineBoundary(boundaryLine, container)) {
				break;
			}
			let crossingFence = semanticFences[innerFenceIndex];
			while (crossingFence && cursor > crossingFence.end) {
				innerFenceIndex += 1;
				crossingFence = semanticFences[innerFenceIndex];
			}
			if (crossingFence && cursor >= crossingFence.start) {
				break;
			}
			if (source[cursor] !== '`') {
				cursor += 1;
				continue;
			}
			const runEnd = markdownBacktickRunEnd(source, cursor);
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

function isInlineBoundary(
	line: MarkdownLine,
	container: readonly MarkdownContainerSegment[],
): boolean {
	if (line.text.slice(line.container.contentStart).trim().length === 0) {
		return true;
	}
	const contentStart = matchContainer(line.text, container);
	return contentStart === undefined
		? isMarkdownBlockStart(line.text)
		: isMarkdownBlockStart(line.text.slice(contentStart));
}

function isTableBodyTerminator(text: string): boolean {
	return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(text) ||
		/^ {0,3}>/.test(text) ||
		/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(text) ||
		/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
}

const HTML_BLOCK_TAGS = new Set([
	'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption',
	'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
	'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2',
	'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li',
	'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option',
	'p', 'param', 'pre', 'script', 'search', 'section', 'style', 'summary', 'table',
	'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

function isHtmlBlockStart(text: string): boolean {
	const tag = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t][^>]*)?\/?\s*>/.exec(text)?.[1]?.toLowerCase();
	return tag !== undefined && HTML_BLOCK_TAGS.has(tag);
}
