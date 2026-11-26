import type { EditPreparation } from './edit-strategy';

export type MarkupTokenType =
	| 'insertion'
	| 'deletion'
	| 'substitution'
	| 'comment'
	| 'highlight';

export type EmendMarkupTokenType = Exclude<MarkupTokenType, 'highlight'>;

export interface MarkupTokenMetadata {
	raw: string;
	attributes: Readonly<Record<string, string>>;
	author?: string;
	date?: string;
}

export interface MarkupToken {
	type: MarkupTokenType;
	raw: string;
	content: string;
	start: number;
	end: number;
	oldText?: string;
	newText?: string;
	metadata?: MarkupTokenMetadata;
}

interface MarkupDelimiter {
	type: MarkupTokenType;
	opener: string;
	closer: string;
}

interface MarkupOpenerMatch {
	delimiter: MarkupDelimiter;
	contentStart: number;
	metadata?: MarkupTokenMetadata;
}

const MARKUP_DELIMITERS: MarkupDelimiter[] = [
	{ type: 'insertion', opener: '{++', closer: '++}' },
	{ type: 'deletion', opener: '{--', closer: '--}' },
	{ type: 'substitution', opener: '{~~', closer: '~~}' },
	{ type: 'comment', opener: '{>>', closer: '<<}' },
	{ type: 'highlight', opener: '{==', closer: '==}' },
];

function matchMarkupOpener(text: string, index: number): MarkupOpenerMatch | undefined {
	const bareDelimiter = MARKUP_DELIMITERS.find((candidate) =>
		text.startsWith(candidate.opener, index),
	);
	if (bareDelimiter) {
		return {
			delimiter: bareDelimiter,
			contentStart: index + bareDelimiter.opener.length,
		};
	}
	if (text[index] !== '{') {
		return undefined;
	}

	const attributes = Object.create(null) as Record<string, string>;
	let cursor = index + 1;
	while (cursor < text.length) {
		const keyStart = cursor;
		if (!isAsciiLetter(text[cursor])) {
			return undefined;
		}
		cursor += 1;
		while (isAttributeKeyCharacter(text[cursor])) {
			cursor += 1;
		}
		const key = text.slice(keyStart, cursor).toLowerCase();
		if (text[cursor] !== '=' || text[cursor + 1] !== '"') {
			return undefined;
		}
		cursor += 2;
		const valueStart = cursor;
		while (cursor < text.length && text[cursor] !== '"') {
			const character = text[cursor];
			if (character === '{' || character === '}' || character === '\n') {
				return undefined;
			}
			cursor += 1;
		}
		if (text[cursor] !== '"') {
			return undefined;
		}
		const value = text.slice(valueStart, cursor).trim();
		cursor += 1;
		if (value && !Object.prototype.hasOwnProperty.call(attributes, key)) {
			attributes[key] = value;
		}

		const attributeEnd = cursor;
		while (text[cursor] === ' ' || text[cursor] === '\t') {
			cursor += 1;
		}
		const delimiter = MARKUP_DELIMITERS.find((candidate) =>
			text.startsWith(candidate.opener.slice(1), cursor),
		);
		if (delimiter) {
			const metadata: MarkupTokenMetadata = {
				raw: text.slice(index + 1, cursor),
				attributes,
			};
			if (attributes.author !== undefined) {
				metadata.author = attributes.author;
			}
			if (attributes.date !== undefined) {
				metadata.date = attributes.date;
			}
			return {
				delimiter,
				contentStart: cursor + delimiter.opener.length - 1,
				metadata,
			};
		}
		if (cursor === attributeEnd) {
			return undefined;
		}
	}
	return undefined;
}

function isAsciiLetter(character: string | undefined): boolean {
	return (
		character !== undefined &&
		((character >= 'A' && character <= 'Z') ||
			(character >= 'a' && character <= 'z'))
	);
}

function isAttributeKeyCharacter(character: string | undefined): boolean {
	return (
		isAsciiLetter(character) ||
		(character !== undefined && character >= '0' && character <= '9') ||
		character === '_' ||
		character === '-'
	);
}

export function parseCriticMarkup(text: string): MarkupToken[] {
	const tokens: MarkupToken[] = [];
	let index = 0;

	while (index < text.length) {
		const opener = matchMarkupOpener(text, index);
		if (!opener) {
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

		const { delimiter } = opener;
		const contentEnd = text.indexOf(delimiter.closer, opener.contentStart);
		if (contentEnd === -1) {
			throw new Error(`Unclosed ${delimiter.type} at offset ${index}.`);
		}

		const content = text.slice(opener.contentStart, contentEnd);
		assertNoNestedDelimiters(content, index);
		const end = contentEnd + delimiter.closer.length;
		const token: MarkupToken = {
			type: delimiter.type,
			raw: text.slice(index, end),
			content,
			start: index,
			end,
		};
		if (opener.metadata) {
			token.metadata = opener.metadata;
		}

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

export function createEmendCriticMarkupToken(
	type: EmendMarkupTokenType,
	content: string,
): string {
	const delimiter = MARKUP_DELIMITERS.find((candidate) => candidate.type === type);
	if (!delimiter || delimiter.type === 'highlight') {
		throw new Error('Unsupported CriticMarkup token type.');
	}
	return `{author="Emend"${delimiter.opener.slice(1)}${content}${delimiter.closer}`;
}

export function containsCriticMarkupDelimiter(text: string): boolean {
	if (text.includes('~>')) {
		return true;
	}
	for (let index = 0; index < text.length; index += 1) {
		if (matchMarkupOpener(text, index)) {
			return true;
		}
		if (
			MARKUP_DELIMITERS.some((candidate) => text.startsWith(candidate.closer, index))
		) {
			return true;
		}
	}
	return false;
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
): Omit<EditPreparation, 'summaryItems' | 'summary'> {
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
	let hasAttributedOpener = false;
	for (let index = 0; index < content.length; index += 1) {
		if (matchMarkupOpener(content, index)?.metadata) {
			hasAttributedOpener = true;
			break;
		}
	}
	if (hasAttributedOpener) {
		throw new Error(`Nested CriticMarkup token inside token at offset ${tokenStart}.`);
	}
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
