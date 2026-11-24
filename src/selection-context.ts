import {
	scanMarkdownContext,
	type MarkdownContextScan,
} from './markdown-scanner';

export interface SelectionContext {
	from: number;
	to: number;
	selectedText: string;
	contextText: string;
}

interface TextBlock {
	start: number;
	end: number;
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

	const scan = scanMarkdownContext(fullText);
	const blocks = getTextBlocks(scan);
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

function getTextBlocks(scan: MarkdownContextScan): TextBlock[] {
	const lines = scan.contextLines;
	const blocks: TextBlock[] = [];
	const frontmatter = scan.contextFrontmatter;
	let index = frontmatter?.nextLine ?? 0;
	let fenceIndex = 0;

	if (frontmatter) {
		blocks.push({ start: frontmatter.start, end: frontmatter.end });
	}

	while (index < lines.length) {
		const line = lines[index];
		if (!line || isBlankLine(line.text)) {
			index++;
			continue;
		}

		const fence = scan.contextFences[fenceIndex];
		if (fence?.openingLine === index) {
			blocks.push({ start: fence.start, end: fence.end });
			index = fence.nextLine;
			fenceIndex++;
			continue;
		}

		const start = line.start;
		let end = line.end;
		index++;
		while (index < lines.length) {
			const candidate = lines[index];
			const nextFence = scan.contextFences[fenceIndex];
			if (
				!candidate ||
				isBlankLine(candidate.text) ||
				nextFence?.openingLine === index
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

function isBlankLine(text: string) {
	return /^\s*$/.test(text);
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
