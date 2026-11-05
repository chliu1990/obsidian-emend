import { describe, expect, it } from 'vitest';
import type { ProviderToolCall } from '../src/provider-stream';
import {
	normalizeWebUrl,
	parseWebToolCall,
	supportsDeepSeekWeb,
} from '../src/web-search';

function raw(name: string, args: unknown): ProviderToolCall {
	return {
		id: 'call-1',
		name,
		arguments: typeof args === 'string' ? args : JSON.stringify(args),
	};
}

describe('parseWebToolCall', () => {
	it('parses and trims a valid search query', () => {
		expect(parseWebToolCall(raw('web_search', { query: '  DeepSeek API  ' }))).toEqual({
			id: 'call-1',
			name: 'web_search',
			query: 'DeepSeek API',
		});
	});

	it('accepts 128 Unicode characters and rejects 129', () => {
		const query = '🔍'.repeat(128);
		expect(parseWebToolCall(raw('web_search', { query }))).toEqual({
			id: 'call-1',
			name: 'web_search',
			query,
		});
		expect(() => parseWebToolCall(raw('web_search', { query: `${query}🔍` }))).toThrow(
			'1 to 128',
		);
	});

	it.each([
		['unknown tool', raw('other_tool', { query: 'Emend' })],
		['blank query', raw('web_search', { query: '  ' })],
		['multiline query', raw('web_search', { query: 'one\ntwo' })],
		['extra search field', raw('web_search', { query: 'Emend', count: 50 })],
		['missing query', raw('web_search', {})],
		['invalid JSON', raw('web_search', '{')],
	])('rejects %s', (_label, call) => {
		expect(() => parseWebToolCall(call)).toThrow();
	});

	it('normalizes a valid fetch URL', () => {
		expect(parseWebToolCall(raw('web_fetch', { url: ' https://example.test/docs ' }))).toEqual({
			id: 'call-1',
			name: 'web_fetch',
			url: 'https://example.test/docs',
		});
	});

	it.each([
		'ftp://example.test/docs',
		'https://user:secret@example.test/docs',
		'not a URL',
		`https://example.test/${'x'.repeat(8192)}`,
	])('rejects unsafe fetch URL %s', (url) => {
		expect(() => parseWebToolCall(raw('web_fetch', { url }))).toThrow();
	});
});

describe('web capability and URL validation', () => {
	it('declares only supported DeepSeek models without discovery', () => {
		expect(supportsDeepSeekWeb('deepseek', 'deepseek-flash')).toBe(true);
		expect(supportsDeepSeekWeb('deepseek', 'deepseek-v4-pro')).toBe(true);
		expect(supportsDeepSeekWeb('deepseek', 'other-model')).toBe(false);
		expect(supportsDeepSeekWeb('kimi', 'k3.1-pro')).toBe(false);
		expect(supportsDeepSeekWeb('custom', 'deepseek-flash')).toBe(false);
	});

	it('accepts only credentialess HTTP(S) URLs for citations', () => {
		expect(normalizeWebUrl('http://example.test/source')).toBe('http://example.test/source');
		expect(normalizeWebUrl('https://user@example.test/source')).toBeUndefined();
		expect(normalizeWebUrl('javascript:alert(1)')).toBeUndefined();
	});
});
