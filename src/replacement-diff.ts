const MAX_MIDDLE_TOKENS = 1000;
const MAX_REPLACEMENT_WORK = 250000;
const MAX_RESPONSE_WORK = 1000001;

interface SegmenterLike {
	segment(input: string): Iterable<{ segment: string }>;
}

type SegmenterConstructor = new (
	locale: string,
	options: { granularity: 'word' },
) => SegmenterLike;

interface Fragment {
	oldText: string;
	newText: string;
}

export function createReplacementCompiler(): (target: string, replacement: string) => string {
	let accumulatedWork = 0;

	return (target, replacement) => {
		if (target === replacement) {
			return target;
		}

		const oldTokens = segment(target);
		const newTokens = segment(replacement);
		if (!oldTokens || !newTokens) {
			return emitEdit(target, replacement);
		}

		let prefixLength = 0;
		while (
			prefixLength < oldTokens.length &&
			prefixLength < newTokens.length &&
			oldTokens[prefixLength] === newTokens[prefixLength]
		) {
			prefixLength += 1;
		}

		let oldSuffixStart = oldTokens.length;
		let newSuffixStart = newTokens.length;
		while (
			oldSuffixStart > prefixLength &&
			newSuffixStart > prefixLength &&
			oldTokens[oldSuffixStart - 1] === newTokens[newSuffixStart - 1]
		) {
			oldSuffixStart -= 1;
			newSuffixStart -= 1;
		}

		const oldMiddle = oldTokens.slice(prefixLength, oldSuffixStart);
		const newMiddle = newTokens.slice(prefixLength, newSuffixStart);
		const work = oldMiddle.length * newMiddle.length;
		accumulatedWork = Math.min(MAX_RESPONSE_WORK, accumulatedWork + work);

		const prefix = oldTokens.slice(0, prefixLength).join('');
		const suffix = oldTokens.slice(oldSuffixStart).join('');
		const shouldFallback =
			oldMiddle.length > MAX_MIDDLE_TOKENS ||
			newMiddle.length > MAX_MIDDLE_TOKENS ||
			work > MAX_REPLACEMENT_WORK ||
			accumulatedWork >= MAX_RESPONSE_WORK;
		const fragments = shouldFallback
			? fallbackFragments(prefix, oldMiddle.join(''), newMiddle.join(''), suffix)
			: lcsFragments(prefix, oldMiddle, newMiddle, suffix);

		return renderVerifiedFragments(target, replacement, fragments);
	};
}

function segment(input: string): string[] | undefined {
	const Constructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
	if (typeof Constructor !== 'function') {
		return undefined;
	}
	try {
		return Array.from(
			new Constructor('und', { granularity: 'word' }).segment(input),
			(part) => part.segment,
		);
	} catch {
		return undefined;
	}
}

function fallbackFragments(
	prefix: string,
	oldMiddle: string,
	newMiddle: string,
	suffix: string,
): Fragment[] {
	return [
		{ oldText: prefix, newText: prefix },
		{ oldText: oldMiddle, newText: newMiddle },
		{ oldText: suffix, newText: suffix },
	];
}

function lcsFragments(
	prefix: string,
	oldMiddle: string[],
	newMiddle: string[],
	suffix: string,
): Fragment[] {
	const columns = newMiddle.length + 1;
	const table = new Uint32Array((oldMiddle.length + 1) * columns);
	for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex -= 1) {
			const cell = oldIndex * columns + newIndex;
			if (oldMiddle[oldIndex] === newMiddle[newIndex]) {
				table[cell] = 1 + (table[(oldIndex + 1) * columns + newIndex + 1] ?? 0);
			} else {
				table[cell] = Math.max(
					table[(oldIndex + 1) * columns + newIndex] ?? 0,
					table[oldIndex * columns + newIndex + 1] ?? 0,
				);
			}
		}
	}

	const fragments: Fragment[] = [{ oldText: prefix, newText: prefix }];
	let pendingOld = '';
	let pendingNew = '';
	const flushEdit = () => {
		if (pendingOld.length > 0 || pendingNew.length > 0) {
			fragments.push({ oldText: pendingOld, newText: pendingNew });
			pendingOld = '';
			pendingNew = '';
		}
	};
	const appendEqual = (text: string) => {
		flushEdit();
		fragments.push({ oldText: text, newText: text });
	};

	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
		if (
			oldIndex < oldMiddle.length &&
			newIndex < newMiddle.length &&
			oldMiddle[oldIndex] === newMiddle[newIndex]
		) {
			appendEqual(oldMiddle[oldIndex] ?? '');
			oldIndex += 1;
			newIndex += 1;
			continue;
		}

		const deletionLength = oldIndex < oldMiddle.length
			? table[(oldIndex + 1) * columns + newIndex] ?? 0
			: -1;
		const insertionLength = newIndex < newMiddle.length
			? table[oldIndex * columns + newIndex + 1] ?? 0
			: -1;
		if (deletionLength >= insertionLength) {
			pendingOld += oldMiddle[oldIndex] ?? '';
			oldIndex += 1;
		} else {
			pendingNew += newMiddle[newIndex] ?? '';
			newIndex += 1;
		}
	}
	flushEdit();
	fragments.push({ oldText: suffix, newText: suffix });
	return fragments;
}

function renderVerifiedFragments(
	target: string,
	replacement: string,
	fragments: Fragment[],
): string {
	let markup = '';
	let oldText = '';
	let newText = '';
	for (const fragment of fragments) {
		oldText += fragment.oldText;
		newText += fragment.newText;
		markup += fragment.oldText === fragment.newText
			? fragment.oldText
			: emitEdit(fragment.oldText, fragment.newText);
	}
	return oldText === target && newText === replacement
		? markup
		: emitEdit(target, replacement);
}

function emitEdit(oldText: string, newText: string): string {
	if (oldText.length === 0) {
		return `{++${newText}++}`;
	}
	if (newText.length === 0) {
		return `{--${oldText}--}`;
	}
	return `{~~${oldText}~>${newText}~~}`;
}
