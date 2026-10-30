import type { EditPreparation } from './edit-strategy';

export type MarkupTokenType =
	| 'insertion'
	| 'deletion'
	| 'substitution'
	| 'comment'
	| 'highlight';

export interface MarkupToken {
	type: MarkupTokenType;
	raw: string;
	content: string;
	start: number;
	end: number;
	oldText?: string;
	newText?: string;
}

interface MarkupDelimiter {
	type: MarkupTokenType;
	opener: string;
	closer: string;
}

const MARKUP_DELIMITERS: MarkupDelimiter[] = [
	{ type: 'insertion', opener: '{++', closer: '++}' },
	{ type: 'deletion', opener: '{--', closer: '--}' },
	{ type: 'substitution', opener: '{~~', closer: '~~}' },
	{ type: 'comment', opener: '{>>', closer: '<<}' },
	{ type: 'highlight', opener: '{==', closer: '==}' },
];

export function parseCriticMarkup(text: string): MarkupToken[] {
	const tokens: MarkupToken[] = [];
	let index = 0;

	while (index < text.length) {
		const delimiter = MARKUP_DELIMITERS.find((candidate) =>
			text.startsWith(candidate.opener, index),
		);
		if (!delimiter) {
			const unexpectedCloser = MARKUP_DELIMITERS.find((candidate) =>
				text.startsWith(candidate.closer, index),
			);
			if (unexpectedCloser) {
				throw new Error(
					`Unexpected CriticMarkup closing delimiter at offset ${index}.`,
				);
			}
			index += 1;
			continue;
		}

		const contentStart = index + delimiter.opener.length;
		const contentEnd = text.indexOf(delimiter.closer, contentStart);
		if (contentEnd === -1) {
			throw new Error(`Unclosed ${delimiter.type} at offset ${index}.`);
		}

		const content = text.slice(contentStart, contentEnd);
		assertNoNestedDelimiters(content, index);
		const end = contentEnd + delimiter.closer.length;
		const token: MarkupToken = {
			type: delimiter.type,
			raw: text.slice(index, end),
			content,
			start: index,
			end,
		};

		if (delimiter.type === 'substitution') {
			const separatorIndex = content.indexOf('~>');
			if (separatorIndex === -1 || separatorIndex !== content.lastIndexOf('~>')) {
				throw new Error(
					`Substitution at offset ${index} must contain exactly one ~> separator.`,
				);
			}
			token.oldText = content.slice(0, separatorIndex);
			token.newText = content.slice(separatorIndex + 2);
		}

		tokens.push(token);
		index = end;
	}

	return tokens;
}

export function toRejectView(text: string): string {
	const tokens = parseCriticMarkup(text);
	let result = '';
	let cursor = 0;

	for (const token of tokens) {
		result += text.slice(cursor, token.start);
		switch (token.type) {
			case 'insertion':
			case 'comment':
				break;
			case 'deletion':
			case 'highlight':
				result += token.content;
				break;
			case 'substitution':
				result += token.oldText ?? '';
				break;
		}
		cursor = token.end;
	}

	return result + text.slice(cursor);
}

export function prepareCriticMarkupEdit(
	original: string,
	response: string,
): EditPreparation {
	if (response.trim().length === 0) {
		throw new Error('CriticMarkup edit response is empty.');
	}

	const originalTokens = parseCriticMarkup(original);
	const responseTokens = parseCriticMarkup(response);
	const originalTokenMatches = matchOriginalTokens(originalTokens, responseTokens);
	if (!originalTokenMatches) {
		throw new Error('Response does not preserve every original token exactly and in order.');
	}

	if (toRejectView(response) !== toRejectView(original)) {
		throw new Error('Response reject view differs from the original reject view.');
	}

	let changeCount = 0;
	for (const [index, token] of responseTokens.entries()) {
		if (!originalTokenMatches.has(index) && token.type !== 'comment') {
			changeCount += 1;
		}
	}

	if (response !== original && originalTokenMatches.size === responseTokens.length) {
		throw new Error('Changed response must contain new markup.');
	}

	return { annotatedMarkdown: response, changeCount };
}

function assertNoNestedDelimiters(content: string, tokenStart: number): void {
	for (const delimiter of MARKUP_DELIMITERS) {
		if (content.includes(delimiter.opener)) {
			throw new Error(`Nested CriticMarkup token inside token at offset ${tokenStart}.`);
		}
		if (content.includes(delimiter.closer)) {
			throw new Error(`Mismatched CriticMarkup delimiter inside token at offset ${tokenStart}.`);
		}
	}
}

function matchOriginalTokens(
	originalTokens: MarkupToken[],
	responseTokens: MarkupToken[],
): Set<number> | undefined {
	const matches = new Set<number>();
	let responseIndex = 0;

	for (const originalToken of originalTokens) {
		while (
			responseIndex < responseTokens.length &&
			responseTokens[responseIndex]?.raw !== originalToken.raw
		) {
			responseIndex += 1;
		}
		if (responseIndex === responseTokens.length) {
			return undefined;
		}
		matches.add(responseIndex);
		responseIndex += 1;
	}

	return matches;
}
