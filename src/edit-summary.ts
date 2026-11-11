import type { EditSummaryItem } from './edit-strategy';

const MAX_ITEMS_WITHOUT_AGGREGATE = 8;
const INDIVIDUAL_BULLETS_WITH_AGGREGATE = 7;

const AGGREGATE_ORDER = ['insert', 'remove', 'replace', 'comment'] as const;

const AGGREGATE_NOUNS: Record<EditSummaryItem['type'], readonly [string, string]> = {
	insert: ['insertion', 'insertions'],
	remove: ['removal', 'removals'],
	replace: ['replacement', 'replacements'],
	comment: ['comment', 'comments'],
};

const TARGET_LABELS = {
	'full-note': 'Full note',
	selection: 'Selection',
} as const;

export interface EditSummaryOptions {
	target: 'full-note' | 'selection';
	summary?: string;
}

export function formatEditSummary(
	changeCount: number,
	items: readonly EditSummaryItem[],
	fullText: string,
	sourceOffset: number,
	options: EditSummaryOptions,
): string {
	const parts = [
		`Edit applied — ${changeCount} changes tracked. Review in Track Changes.`,
		`Target: ${TARGET_LABELS[options.target]}.`,
	];
	const summary = options.summary?.trim();
	if (summary) {
		parts.push('', summary);
	}
	if (items.length > 0) {
		const bullets = items.length <= MAX_ITEMS_WITHOUT_AGGREGATE
			? items.map((item) => formatItemBullet(item, fullText, sourceOffset))
			: [
				...items
					.slice(0, INDIVIDUAL_BULLETS_WITH_AGGREGATE)
					.map((item) => formatItemBullet(item, fullText, sourceOffset)),
				formatAggregateBullet(items.slice(INDIVIDUAL_BULLETS_WITH_AGGREGATE)),
			];
		parts.push('', ...bullets);
	}
	return parts.join('\n');
}

export function formatNoChangeSummary(summary?: string): string {
	const trimmed = summary?.trim();
	return trimmed ? `No changes were needed.\n\n${trimmed}` : 'No changes were needed.';
}

function formatItemBullet(
	item: EditSummaryItem,
	fullText: string,
	sourceOffset: number,
): string {
	const start = item.start + sourceOffset;
	if (item.type === 'insert') {
		const point = (item.insertionPoint ?? item.start) + sourceOffset;
		const position = (item.insertionPoint ?? item.start) === item.start ? 'before' : 'after';
		return `- Inserted text ${position} line ${lineAt(fullText, point)}.`;
	}
	const first = lineAt(fullText, start);
	const end = item.end + sourceOffset;
	const last = end > start ? lineAt(fullText, end - 1) : first;
	switch (item.type) {
		case 'remove':
			return rangeBullet('Removed', first, last);
		case 'replace':
			return rangeBullet('Replaced', first, last);
		case 'comment':
			return rangeBullet('Commented on', first, last);
	}
}

function rangeBullet(verb: string, first: number, last: number): string {
	return first === last
		? `- ${verb} line ${first}.`
		: `- ${verb} lines ${first}–${last}.`;
}

function formatAggregateBullet(items: readonly EditSummaryItem[]): string {
	const counts: Record<EditSummaryItem['type'], number> = {
		insert: 0,
		remove: 0,
		replace: 0,
		comment: 0,
	};
	for (const item of items) {
		counts[item.type] += 1;
	}
	const parts = AGGREGATE_ORDER.flatMap((type) => {
		const count = counts[type];
		if (count === 0) {
			return [];
		}
		const [singular, plural] = AGGREGATE_NOUNS[type];
		return [`${count} more ${count === 1 ? singular : plural}`];
	});
	return `- And ${parts.join(', ')}.`;
}

function lineAt(fullText: string, offset: number): number {
	const limit = Math.min(Math.max(offset, 0), fullText.length);
	let line = 1;
	for (let index = 0; index < limit; index += 1) {
		if (fullText.charAt(index) === '\n') {
			line += 1;
		}
	}
	return line;
}
