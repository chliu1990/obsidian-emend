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
