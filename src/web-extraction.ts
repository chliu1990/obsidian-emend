import { measureWebContent } from './web-content-measurement';

export interface WebExtractionDocument {
	sourceId: string;
	title: string;
	url: string;
	snippet?: string;
	canonicalText: string;
}

export interface WebExtractionClaim {
	text: string;
	evidence: string[];
}

export interface WebExtractionResult {
	sourceId: string;
	claims: WebExtractionClaim[];
	evidence: string[];
	truncated?: boolean;
}

export type WebExtractionOutcome = {
	outcome: 'evidence';
	results: WebExtractionResult[];
} | {
	outcome: 'no_relevant_evidence';
	results: [];
};

export interface WebExtractionFitResult {
	outcome: WebExtractionOutcome;
	payload: string;
}

export class WebExtractionParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WebExtractionParseError';
	}
}

interface SearchExtractionResult {
	title: string;
	url: string;
	snippet: string;
	summary: string;
	content: string;
}

interface GrepMatch {
	sourceId: string;
	start: number;
	end: number;
	contextStart: number;
	contextEnd: number;
	context: string;
}

interface PayloadResult {
	sourceId: string;
	mappedId: string;
	title: string;
	url: string;
	claims: WebExtractionClaim[];
	evidence: string[];
	truncated?: boolean;
}

const LOCAL_TOOL_RESULT_CAP = 4000;
const MAX_GREP_MATCHES = 8;
const GREP_CONTEXT_CHARACTERS = 120;
const MAX_READ_CHARACTERS = 3500;
const MAX_CLAIM_TEXT_CODE_POINTS = 500;
const MAX_CLAIM_QUOTES = 4;
const MAX_QUOTE_CODE_POINTS = 1500;
const MAX_CLAIMS_PER_SOURCE = 8;
const MAX_TOTAL_CLAIMS = 24;

export function buildSearchExtractionDocuments(
	results: readonly SearchExtractionResult[],
): WebExtractionDocument[] {
	return results.map((result, index) => ({
		sourceId: `R${index + 1}`,
		title: result.title,
		url: result.url,
		snippet: result.snippet,
		canonicalText: canonicalText(result.title, result.snippet, result.summary, result.content),
	}));
}

export function buildFetchExtractionDocument(
	page: { title: string; content: string },
	url: string,
): WebExtractionDocument[] {
	return [{
		sourceId: 'R1',
		title: page.title,
		url,
		canonicalText: canonicalText(page.title, '', '', page.content),
	}];
}

export function grepRetrievalDocuments(
	documents: readonly WebExtractionDocument[],
	options: { query: string; sourceId?: string },
): string {
	if (typeof options.query !== 'string' || options.query.length === 0 || options.query.length > 256) {
		throw new Error('Retrieval grep query must contain 1 to 256 characters.');
	}
	const selectedDocuments = options.sourceId === undefined
		? documents
		: documents.filter((document) => document.sourceId === options.sourceId);
	if (options.sourceId !== undefined && selectedDocuments.length === 0) {
		throw new Error(`Unknown retrieval source: ${options.sourceId}`);
	}

	const foldedQuery = options.query.toLowerCase();
	const matches: GrepMatch[] = [];
	let truncated = false;
	for (const document of selectedDocuments) {
		const text = document.canonicalText;
		let offset = 0;
		while (offset + options.query.length <= text.length) {
			if (text.slice(offset, offset + options.query.length).toLowerCase() !== foldedQuery) {
				offset += 1;
				continue;
			}
			if (matches.length === MAX_GREP_MATCHES) {
				truncated = true;
				break;
			}
			const end = offset + options.query.length;
			const contextStart = Math.max(0, offset - GREP_CONTEXT_CHARACTERS);
			const contextEnd = Math.min(text.length, end + GREP_CONTEXT_CHARACTERS);
			matches.push({
				sourceId: document.sourceId,
				start: offset,
				end,
				contextStart,
				contextEnd,
				context: text.slice(contextStart, contextEnd),
			});
			offset = end;
		}
		if (truncated) {
			break;
		}
	}

	let serialized = JSON.stringify({ matches, truncated });
	while (serialized.length > LOCAL_TOOL_RESULT_CAP && matches.length > 0) {
		matches.pop();
		truncated = true;
		serialized = JSON.stringify({ matches, truncated });
	}
	if (serialized.length > LOCAL_TOOL_RESULT_CAP) {
		throw new Error('Retrieval grep result exceeds 4000 characters.');
	}
	return serialized;
}

export function readRetrievalDocument(
	documents: readonly WebExtractionDocument[],
	options: { sourceId: string; offset: number; length: number },
): string {
	const document = documents.find((candidate) => candidate.sourceId === options.sourceId);
	if (!document) {
		throw new Error(`Unknown retrieval source: ${options.sourceId}`);
	}
	if (!Number.isInteger(options.offset) || options.offset < 0 || options.offset > document.canonicalText.length) {
		throw new Error('Retrieval read offset is outside the document.');
	}
	if (!Number.isInteger(options.length) || options.length < 1 || options.length > MAX_READ_CHARACTERS) {
		throw new Error('Retrieval read length must be an integer from 1 to 3500.');
	}

	const start = options.offset;
	let end = Math.min(document.canonicalText.length, start + options.length);
	let result = readResult(document, start, end);
	let serialized = JSON.stringify(result);
	while (serialized.length > LOCAL_TOOL_RESULT_CAP && end > start) {
		end -= 1;
		result = readResult(document, start, end);
		serialized = JSON.stringify(result);
	}
	if (serialized.length > LOCAL_TOOL_RESULT_CAP) {
		throw new Error('Retrieval read result exceeds 4000 characters.');
	}
	return serialized;
}

export function parseWebExtractionOutcome(
	content: string,
	documents: readonly WebExtractionDocument[],
): WebExtractionOutcome {
	const parsed = parseJsonObject(content);
	if (parsed.outcome === 'no_relevant_evidence') {
		return { outcome: 'no_relevant_evidence', results: [] };
	}
	if (parsed.outcome !== 'evidence') {
		throw new WebExtractionParseError(
			'Web extraction output must use the evidence or no_relevant_evidence outcome.',
		);
	}
	if (!Array.isArray(parsed.results)) {
		throw new WebExtractionParseError('Evidence extraction output must contain a results array.');
	}

	const documentsById = new Map(documents.map((document) => [document.sourceId, document]));
	const resultsBySourceId = new Map<string, WebExtractionResult>();
	const claimTextsBySourceId = new Map<string, Set<string>>();
	let totalClaims = 0;
	for (const candidate of parsed.results) {
		if (!isRecord(candidate) || typeof candidate.sourceId !== 'string') {
			continue;
		}
		const document = documentsById.get(candidate.sourceId);
		if (!document) {
			continue;
		}
		const result = resultsBySourceId.get(candidate.sourceId) ?? {
			sourceId: candidate.sourceId,
			claims: [],
			evidence: [],
		};
		const claimTexts = claimTextsBySourceId.get(candidate.sourceId) ?? new Set<string>();
		const fallbackQuotes = new Set(result.evidence);
		if (Array.isArray(candidate.claims)) {
			for (const rawClaim of candidate.claims) {
				if (totalClaims >= MAX_TOTAL_CLAIMS || result.claims.length >= MAX_CLAIMS_PER_SOURCE) {
					break;
				}
				if (!isRecord(rawClaim)) {
					continue;
				}
				const quotes = collectQuotes(rawClaim.evidence, document);
				for (const quote of quotes) {
					fallbackQuotes.add(quote);
				}
				if (typeof rawClaim.text !== 'string') {
					continue;
				}
				const text = rawClaim.text.trim();
				if (codePointLength(text) === 0 || codePointLength(text) > MAX_CLAIM_TEXT_CODE_POINTS) {
					continue;
				}
				if (quotes.length === 0) {
					continue;
				}
				const normalizedText = normalizeClaimText(text);
				if (claimTexts.has(normalizedText)) {
					continue;
				}
				claimTexts.add(normalizedText);
				result.claims.push({
					text,
					evidence: quotes.slice(0, MAX_CLAIM_QUOTES),
				});
				totalClaims += 1;
			}
		}
		for (const quote of collectQuotes(candidate.evidence, document)) {
			fallbackQuotes.add(quote);
		}
		result.evidence = [...fallbackQuotes];
		resultsBySourceId.set(candidate.sourceId, result);
		claimTextsBySourceId.set(candidate.sourceId, claimTexts);
	}

	const results = [...resultsBySourceId.values()].filter(
		(result) => result.claims.length > 0 || result.evidence.length > 0,
	);
	if (results.length === 0) {
		return { outcome: 'no_relevant_evidence', results: [] };
	}
	return { outcome: 'evidence', results };
}

export function parseJsonObject(content: string): Record<string, unknown> {
	const candidates = [content.trim()];
	const fenced = content.match(/```[A-Za-z0-9_-]*\s*\n?([\s\S]*?)```/);
	if (fenced?.[1] !== undefined) {
		candidates.push(fenced[1].trim());
	}
	for (const candidate of candidates) {
		try {
			const value: unknown = JSON.parse(candidate);
			if (isRecord(value)) {
				return value;
			}
		} catch {
			// Fall through to the balanced-object scan.
		}
	}

	let searchFrom = 0;
	while (true) {
		const start = content.indexOf('{', searchFrom);
		if (start === -1) {
			break;
		}
		const end = findJsonObjectEnd(content, start);
		if (end !== -1) {
			try {
				const value: unknown = JSON.parse(content.slice(start, end + 1));
				if (isRecord(value)) {
					return value;
				}
			} catch {
				// Try the next brace.
			}
		}
		searchFrom = start + 1;
	}
	throw new WebExtractionParseError('Reader output must contain a parseable JSON object.');
}

export function buildWebExtractionToolPayload(
	outcome: WebExtractionOutcome,
	documents: readonly WebExtractionDocument[],
	idByTemporaryId: ReadonlyMap<string, string>,
): string {
	const payload = outcome.results.map((result) => {
		const document = documents.find((candidate) => candidate.sourceId === result.sourceId);
		const sourceId = idByTemporaryId.get(result.sourceId);
		if (!document || sourceId === undefined) {
			throw new Error(`Cannot map extraction source: ${result.sourceId}`);
		}
		return serializeResult({
			sourceId: result.sourceId,
			mappedId: sourceId,
			title: document.title,
			url: document.url,
			claims: result.claims,
			evidence: result.evidence,
			truncated: result.truncated,
		});
	});
	if (payload.length === 0) {
		return JSON.stringify({ extraction: 'ai-reader', outcome: 'no_relevant_evidence', results: [] });
	}
	return JSON.stringify({
		extraction: 'ai-reader',
		outcome: outcome.outcome,
		results: payload,
	});
}

export function fitWebExtractionToolPayload(
	outcome: WebExtractionOutcome,
	documents: readonly WebExtractionDocument[],
	idByTemporaryId: ReadonlyMap<string, string>,
	cap: number,
): WebExtractionFitResult {
	if (!Number.isInteger(cap) || cap < 0) {
		throw new Error('Web extraction cap must be a nonnegative integer.');
	}
	const working: PayloadResult[] = [];
	for (const result of outcome.results) {
		const document = documents.find((candidate) => candidate.sourceId === result.sourceId);
		const mappedId = idByTemporaryId.get(result.sourceId);
		if (!document || mappedId === undefined) {
			throw new Error(`Cannot map extraction source: ${result.sourceId}`);
		}
		working.push({
			sourceId: result.sourceId,
			mappedId,
			title: document.title,
			url: document.url,
			claims: result.claims.map((claim) => ({ text: claim.text, evidence: [...claim.evidence] })),
			evidence: [...result.evidence],
			...(result.truncated ? { truncated: true } : {}),
		});
	}

	const serialize = () => serializePayload(working);
	const measure = (payload: string) => measureWebContent(payload).value;
	while (measure(serialize()) > cap) {
		const claimIndex = findLastIndex(working, (result) => result.claims.length > 0);
		if (claimIndex !== -1) {
			const target = working[claimIndex]!;
			target.claims.pop();
			if (target.claims.length === 0 && target.evidence.length === 0) {
				working.splice(claimIndex, 1);
			}
			continue;
		}

		const quoteCount = working.reduce(
			(sum, result) => sum + (result.claims.length === 0 ? result.evidence.length : 0),
			0,
		);
		if (quoteCount > 1) {
			const evidenceIndex = findLastIndex(
				working,
				(result) => result.claims.length === 0 && result.evidence.length > 0,
			);
			const target = working[evidenceIndex]!;
			target.evidence.pop();
			if (target.evidence.length === 0) {
				working.splice(evidenceIndex, 1);
			}
			continue;
		}

		const lastIndex = findLastIndex(
			working,
			(result) => result.claims.length === 0 && result.evidence.length > 0,
		);
		if (lastIndex !== -1) {
			const target = working[lastIndex]!;
			const quote = target.evidence[0]!;
			const codePoints = Array.from(quote);
			const fitsPrefix = (length: number) => {
				target.evidence = [codePoints.slice(0, length).join('')];
				const fits = measure(serialize()) <= cap;
				target.evidence = [quote];
				return fits;
			};
			let low = 1;
			let high = codePoints.length - 1;
			let best = 0;
			while (low <= high) {
				const middle = Math.floor((low + high) / 2);
				if (fitsPrefix(middle)) {
					best = middle;
					low = middle + 1;
				} else {
					high = middle - 1;
				}
			}
			if (best > 0) {
				target.evidence = [codePoints.slice(0, best).join('')];
				target.truncated = true;
				continue;
			}
			target.evidence = [];
			working.splice(lastIndex, 1);
			continue;
		}

		const floor = serializePayload([]);
		if (measure(floor) > cap) {
			throw new Error(`Web extraction payload cannot fit within the ${cap}-character cap.`);
		}
		return { outcome: { outcome: 'no_relevant_evidence', results: [] }, payload: floor };
	}

	return { outcome: toOutcome(working), payload: serialize() };
}

export function assertWebExtractionWithinCap(payload: string, cap: number): void {
	if (!Number.isInteger(cap) || cap < 0) {
		throw new Error('Web extraction cap must be a nonnegative integer.');
	}
	const measurement = measureWebContent(payload);
	if (measurement.value > cap) {
		throw new Error(`Web extraction payload is ${measurement.value} ${measurement.unit}; cap is ${cap}.`);
	}
}

function canonicalText(title: string, snippet: string, summary: string, content: string): string {
	return `Title: ${title}\nSnippet: ${snippet}\nSummary: ${summary}\nContent: ${content}`;
}

function readResult(document: WebExtractionDocument, start: number, end: number): {
	sourceId: string;
	start: number;
	end: number;
	content: string;
	truncated: boolean;
	nextOffset: number | null;
} {
	const truncated = end < document.canonicalText.length;
	return {
		sourceId: document.sourceId,
		start,
		end,
		content: document.canonicalText.slice(start, end),
		truncated,
		nextOffset: truncated ? end : null,
	};
}

function collectQuotes(value: unknown, document: WebExtractionDocument): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const quotes: string[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== 'string') {
			continue;
		}
		const quote = candidate.trim();
		const length = codePointLength(quote);
		if (length === 0 || length > MAX_QUOTE_CODE_POINTS) {
			continue;
		}
		if (!document.canonicalText.includes(quote) || seen.has(quote)) {
			continue;
		}
		seen.add(quote);
		quotes.push(quote);
	}
	return quotes;
}

function serializePayload(results: readonly PayloadResult[]): string {
	if (results.length === 0) {
		return JSON.stringify({ extraction: 'ai-reader', outcome: 'no_relevant_evidence', results: [] });
	}
	return JSON.stringify({
		extraction: 'ai-reader',
		outcome: 'evidence',
		results: results.map(serializeResult),
	});
}

function serializeResult(result: PayloadResult): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		sourceId: result.mappedId,
		title: result.title,
		url: result.url,
	};
	if (result.claims.length > 0) {
		payload.claims = result.claims.map((claim) => ({
			text: claim.text,
			evidence: [...claim.evidence],
		}));
	} else {
		payload.evidence = [...result.evidence];
	}
	if (result.truncated) {
		payload.truncated = true;
	}
	return payload;
}

function toOutcome(results: readonly PayloadResult[]): WebExtractionOutcome {
	if (results.length === 0) {
		return { outcome: 'no_relevant_evidence', results: [] };
	}
	return {
		outcome: 'evidence',
		results: results.map((result) => ({
			sourceId: result.sourceId,
			claims: result.claims.map((claim) => ({
				text: claim.text,
				evidence: [...claim.evidence],
			})),
			evidence: [...result.evidence],
			...(result.truncated ? { truncated: true } : {}),
		})),
	};
}

function findJsonObjectEnd(content: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < content.length; index += 1) {
		const character = content[index]!;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}
		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === '{') {
			depth += 1;
		} else if (character === '}') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		if (predicate(values[index]!)) {
			return index;
		}
	}
	return -1;
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}

export function normalizeClaimText(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
