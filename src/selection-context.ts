export interface SelectionContext {
	from: number;
	to: number;
	selectedText: string;
	contextText: string;
}

interface TextLine {
	start: number;
	end: number;
}

interface TextBlock {
	start: number;
	end: number;
}

interface Fence {
	character: '`' | '~';
	length: number;
}

export function buildSmartSelectionContext(
	fullText: string,
	from: number,
	to: number,
	maxCharacters: number,
): SelectionContext {
	const selectedText = fullText.slice(from, to);
	if (fullText.length <= maxCharacters) {
		return { from, to, selectedText, contextText: fullText };
	}

	const blocks = getTextBlocks(fullText);
	const containing = getContainingBlocks(blocks, from, to);
	let start = containing.start;
	let end = containing.end;

	if (end - start > maxCharacters) {
		({ start, end } = getBoundedRange(
			fullText,
			from,
			to,
			maxCharacters,
			start,
			end,
		));
	} else {
		({ start, end } = expandAdjacentBlocks(
			blocks,
			containing,
			maxCharacters,
		));
	}

	const prefix = start > 0 ? '[...]\n' : '';
	const suffix = end < fullText.length ? '\n[...]' : '';
	return {
		from,
		to,
		selectedText,
		contextText: `${prefix}${fullText.slice(start, end)}${suffix}`,
	};
}

function getTextBlocks(fullText: string): TextBlock[] {
	const lines = getLines(fullText);
	const blocks: TextBlock[] = [];
	let index = 0;

	if (lines[0] && lineText(fullText, lines[0]).trim() === '---') {
		index = lines.length;
		let endIndex = lines.length - 1;
		for (let candidate = 1; candidate < lines.length; candidate++) {
			const line = lines[candidate];
			if (!line) {
				continue;
			}
			const text = lineText(fullText, line).trim();
			if (text === '---' || text === '...') {
				endIndex = candidate;
				index = candidate + 1;
				break;
			}
		}
		const first = lines[0];
		const last = lines[endIndex];
		if (first && last) {
			blocks.push({ start: first.start, end: last.end });
		}
	}

	while (index < lines.length) {
		const line = lines[index];
		if (!line || isBlankLine(fullText, line)) {
			index++;
			continue;
		}

		const fence = getFenceOpening(lineText(fullText, line));
		if (fence) {
			const start = line.start;
			let end = line.end;
			index++;
			while (index < lines.length) {
				const candidate = lines[index];
				if (!candidate) {
					break;
				}
				end = candidate.end;
				const closed = isFenceClosing(
					lineText(fullText, candidate),
					fence,
				);
				index++;
				if (closed) {
					break;
				}
			}
			blocks.push({ start, end });
			continue;
		}

		const start = line.start;
		let end = line.end;
		index++;
		while (index < lines.length) {
			const candidate = lines[index];
			if (
				!candidate ||
				isBlankLine(fullText, candidate) ||
				getFenceOpening(lineText(fullText, candidate))
			) {
				break;
			}
			end = candidate.end;
			index++;
		}
		blocks.push({ start, end });
	}

	return blocks;
}

function getLines(fullText: string): TextLine[] {
	const lines: TextLine[] = [];
	let start = 0;
	while (start < fullText.length) {
		const newline = fullText.indexOf('\n', start);
		const end = newline === -1 ? fullText.length : newline;
		lines.push({ start, end });
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return lines;
}

function lineText(fullText: string, line: TextLine) {
	return fullText.slice(line.start, line.end);
}

function isBlankLine(fullText: string, line: TextLine) {
	return /^\s*$/.test(lineText(fullText, line));
}

function getFenceOpening(text: string): Fence | null {
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

function isFenceClosing(text: string, fence: Fence) {
	const trimmed = text.trim();
	let markerLength = 0;
	while (trimmed[markerLength] === fence.character) {
		markerLength++;
	}
	return (
		markerLength >= fence.length &&
		trimmed.slice(markerLength).trim().length === 0
	);
}

function getContainingBlocks(
	blocks: TextBlock[],
	from: number,
	to: number,
): { first: number; last: number; start: number; end: number } {
	let first = -1;
	let last = -1;
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		if (block && block.start < to && block.end > from) {
			if (first === -1) {
				first = index;
			}
			last = index;
		}
	}

	const firstBlock = blocks[first];
	const lastBlock = blocks[last];
	if (!firstBlock || !lastBlock) {
		throw new Error('Selection must intersect note text.');
	}
	return { first, last, start: firstBlock.start, end: lastBlock.end };
}

function expandAdjacentBlocks(
	blocks: TextBlock[],
	containing: { first: number; last: number; start: number; end: number },
	maxCharacters: number,
) {
	let { start, end } = containing;
	let first = containing.first;
	let last = containing.last;
	let canExpandBefore = true;
	let canExpandAfter = true;

	while (canExpandBefore || canExpandAfter) {
		if (canExpandBefore) {
			const previous = blocks[first - 1];
			if (previous && end - previous.start <= maxCharacters) {
				start = previous.start;
				first--;
			} else {
				canExpandBefore = false;
			}
		}
		if (canExpandAfter) {
			const next = blocks[last + 1];
			if (next && next.end - start <= maxCharacters) {
				end = next.end;
				last++;
			} else {
				canExpandAfter = false;
			}
		}
	}

	return { start, end };
}

function getBoundedRange(
	fullText: string,
	from: number,
	to: number,
	maxCharacters: number,
	minimumStart: number,
	maximumEnd: number,
) {
	const selectedText = fullText.slice(from, to);
	const remainingCharacters = Math.max(
		maxCharacters - selectedText.length,
		0,
	);
	const beforeBudget = Math.floor(remainingCharacters / 2);
	const afterBudget = remainingCharacters - beforeBudget;
	let start = Math.max(minimumStart, from - beforeBudget);
	let end = Math.min(maximumEnd, to + afterBudget);

	const unusedBeforeBudget = beforeBudget - (from - start);
	if (unusedBeforeBudget > 0) {
		end = Math.min(maximumEnd, end + unusedBeforeBudget);
	}
	const unusedAfterBudget = afterBudget - (end - to);
	if (unusedAfterBudget > 0) {
		start = Math.max(minimumStart, start - unusedAfterBudget);
	}
	return { start, end };
}
