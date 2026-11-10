import { measureWebContent } from './web-content-measurement';

export interface WebExtractionDocument {
	sourceId: string;
	title: string;
	url: string;
	snippet?: string;
	canonicalText: string;
}

export interface WebExtractionResult {
	sourceId: string;
	evidence: string[];
}

export type WebExtractionOutcome = {
	outcome: 'evidence';
	results: WebExtractionResult[];
} | {
	outcome: 'no_relevant_evidence';
	results: [];
};

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

const LOCAL_TOOL_RESULT_CAP = 4000;
const MAX_GREP_MATCHES = 8;
const GREP_CONTEXT_CHARACTERS = 120;
const MAX_READ_CHARACTERS = 3500;

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
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('Web extraction output must be valid JSON.');
	}
	if (!isRecord(parsed) || !hasExactKeys(parsed, ['outcome', 'results']) || !Array.isArray(parsed.results)) {
		throw new Error('Web extraction output has an invalid shape.');
	}
	if (parsed.outcome === 'no_relevant_evidence') {
		if (parsed.results.length !== 0) {
			throw new Error('No-evidence extraction output cannot contain results.');
		}
		return { outcome: 'no_relevant_evidence', results: [] };
	}
	if (parsed.outcome !== 'evidence' || parsed.results.length === 0) {
		throw new Error('Evidence extraction output must contain results.');
	}

	const documentsById = new Map(documents.map((document) => [document.sourceId, document]));
	const seenSourceIds = new Set<string>();
	const results: WebExtractionResult[] = parsed.results.map((candidate: unknown) => {
		if (!isRecord(candidate) || !hasExactKeys(candidate, ['sourceId', 'evidence'])) {
			throw new Error('Web extraction result has an invalid shape.');
		}
		if (typeof candidate.sourceId !== 'string' || seenSourceIds.has(candidate.sourceId)) {
			throw new Error('Web extraction source IDs must be unique.');
		}
		const document = documentsById.get(candidate.sourceId);
		if (!document) {
			throw new Error(`Unknown extraction source: ${candidate.sourceId}`);
		}
		if (!isNonemptyStringArray(candidate.evidence)) {
			throw new Error('Extraction evidence must be a nonempty string array.');
		}
		if (candidate.evidence.some((evidence) => !document.canonicalText.includes(evidence))) {
			throw new Error('Extraction evidence must be verbatim source text.');
		}
		seenSourceIds.add(candidate.sourceId);
		return {
			sourceId: candidate.sourceId,
			evidence: [...candidate.evidence],
		};
	});
	return { outcome: 'evidence', results };
}

export function buildWebExtractionToolPayload(
	outcome: WebExtractionOutcome,
	documents: readonly WebExtractionDocument[],
	idByTemporaryId: ReadonlyMap<string, string>,
): string {
	const documentsById = new Map(documents.map((document) => [document.sourceId, document]));
	const results = outcome.results.map((result) => {
		const document = documentsById.get(result.sourceId);
		const sourceId = idByTemporaryId.get(result.sourceId);
		if (!document || sourceId === undefined) {
			throw new Error(`Cannot map extraction source: ${result.sourceId}`);
		}
		return {
			sourceId,
			title: document.title,
			url: document.url,
			evidence: result.evidence,
		};
	});
	return JSON.stringify({
		extraction: 'ai-reader',
		outcome: outcome.outcome,
		results,
	});
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actualKeys = Object.keys(value);
	return actualKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonemptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.length > 0
		&& value.every((item) => typeof item === 'string' && item.trim().length > 0);
}
