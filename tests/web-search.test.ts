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
	it('parses and trims a valid search query and extraction goal', () => {
		expect(parseWebToolCall(raw('web_search', {
			query: '  DeepSeek API  ',
			extractionGoal: '  Find the streaming request fields.  ',
		}))).toEqual({
			id: 'call-1',
			name: 'web_search',
			query: 'DeepSeek API',
			extractionGoal: 'Find the streaming request fields.',
		});
	});

	it('accepts 128 Unicode characters and rejects 129 in queries', () => {
		const query = '🔍'.repeat(128);
		expect(parseWebToolCall(raw('web_search', { query, extractionGoal: 'Find evidence.' }))).toEqual({
			id: 'call-1',
			name: 'web_search',
			query,
			extractionGoal: 'Find evidence.',
		});
		expect(() => parseWebToolCall(raw('web_search', {
			query: `${query}🔍`,
			extractionGoal: 'Find evidence.',
		}))).toThrow('1 to 128');
	});

	it.each(['web_search', 'web_fetch'] as const)('accepts 1000 and rejects 1001 Unicode code points in %s goals', (name) => {
		const extractionGoal = '🎯'.repeat(1000);
		const target = name === 'web_search'
			? { query: 'Emend' }
			: { url: 'https://example.test/docs' };
		expect(parseWebToolCall(raw(name, { ...target, extractionGoal }))).toMatchObject({
			extractionGoal,
		});
		expect(() => parseWebToolCall(raw(name, {
			...target,
			extractionGoal: `${extractionGoal}🎯`,
		}))).toThrow('1 to 1000');
	});

	it.each([
		['unknown tool', raw('other_tool', { query: 'Emend', extractionGoal: 'Find evidence.' })],
		['blank query', raw('web_search', { query: '  ', extractionGoal: 'Find evidence.' })],
		['multiline query', raw('web_search', { query: 'one\ntwo', extractionGoal: 'Find evidence.' })],
		['wrong-type query', raw('web_search', { query: 42, extractionGoal: 'Find evidence.' })],
		['extra search field', raw('web_search', { query: 'Emend', extractionGoal: 'Find evidence.', count: 50 })],
		['missing query', raw('web_search', { extractionGoal: 'Find evidence.' })],
		['missing search goal', raw('web_search', { query: 'Emend' })],
		['wrong-type search goal', raw('web_search', { query: 'Emend', extractionGoal: 42 })],
		['empty search goal', raw('web_search', { query: 'Emend', extractionGoal: '  ' })],
		['missing fetch goal', raw('web_fetch', { url: 'https://example.test/docs' })],
		['wrong-type fetch goal', raw('web_fetch', { url: 'https://example.test/docs', extractionGoal: null })],
		['empty fetch goal', raw('web_fetch', { url: 'https://example.test/docs', extractionGoal: '' })],
		['extra fetch field', raw('web_fetch', { url: 'https://example.test/docs', extractionGoal: 'Find evidence.', count: 1 })],
		['invalid JSON', raw('web_search', '{')],
	])('rejects %s', (_label, call) => {
		expect(() => parseWebToolCall(call)).toThrow();
	});

	it('normalizes a valid fetch URL and trims its extraction goal', () => {
		expect(parseWebToolCall(raw('web_fetch', {
			url: ' https://example.test/docs ',
			extractionGoal: '  Extract the installation steps.  ',
		}))).toEqual({
			id: 'call-1',
			name: 'web_fetch',
			url: 'https://example.test/docs',
			extractionGoal: 'Extract the installation steps.',
		});
	});

	it.each([
		'ftp://example.test/docs',
		'https://user:secret@example.test/docs',
		'not a URL',
		`https://example.test/${'x'.repeat(8192)}`,
	])('rejects unsafe fetch URL %s', (url) => {
		expect(() => parseWebToolCall(raw('web_fetch', { url, extractionGoal: 'Find evidence.' }))).toThrow();
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
