import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverProviderModels } from '../src/model-discovery';
import type { DiscoveredModel } from '../src/types';

const provider = {
	name: 'Test provider',
	baseUrl: 'https://provider.example.test/v1///',
	apiKey: 'test-api-key',
};

function mockJsonResponse(payload: unknown, init?: ResponseInit) {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(payload), init),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function getError(promise: Promise<unknown>) {
	try {
		await promise;
		throw new Error('Expected discovery to reject.');
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('discoverProviderModels', () => {
	it('gets and normalizes models without changing provider order', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			data: [
				{ id: 'model-a', name: 'Model A' },
				{ id: 'model-b', display_name: 'Model B', name: 'Ignored' },
				{ id: 'model-a', display_name: 'Duplicate' },
				{ id: ' ', name: 'Blank' },
				{ name: 'Missing ID' },
			],
		})));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const expected: DiscoveredModel[] = [
			{ id: 'model-a', displayName: 'Model A' },
			{ id: 'model-b', displayName: 'Model B' },
		];

		await expect(discoverProviderModels(provider, controller.signal)).resolves.toEqual(expected);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://provider.example.test/v1/models');
		expect(init).toEqual({
			method: 'GET',
			headers: {
				Authorization: 'Bearer test-api-key',
				Accept: 'application/json',
			},
			signal: controller.signal,
		});
		expect(init).not.toHaveProperty('body');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('trims connection values before constructing the request', async () => {
		const fetchMock = mockJsonResponse({ data: [{ id: 'model-a' }] });

		await discoverProviderModels({
			...provider,
			baseUrl: '  https://provider.example.test/v1///  ',
			apiKey: '  test-api-key  ',
		});

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://provider.example.test/v1/models');
		expect(init.headers).toEqual({
			Authorization: 'Bearer test-api-key',
			Accept: 'application/json',
		});
	});

	it.each([
		['ID when both labels are blank', { id: ' model-a ', display_name: ' ', name: '' }, 'model-a'],
		['ID when both labels are non-strings', { id: 'model-a', display_name: 1, name: null }, 'model-a'],
		['the trimmed name when display_name is blank', { id: 'model-a', display_name: ' ', name: ' Model A ' }, 'Model A'],
	])('falls back to %s', async (_label, entry, displayName) => {
		mockJsonResponse({ data: [entry] });

		await expect(discoverProviderModels(provider)).resolves.toEqual([
			{ id: entry.id.trim(), displayName },
		]);
	});

	it.each([
		['a non-object response', 'null'],
		['a non-array data property', JSON.stringify({ data: {} })],
		['malformed JSON', '{not-json'],
		['no usable models', JSON.stringify({ data: [{ id: ' ' }, { name: 'Missing ID' }, null] })],
	])('rejects %s without retrying', async (_label, responseText) => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(responseText));
		vi.stubGlobal('fetch', fetchMock);

		await expect(discoverProviderModels(provider)).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('uses a specific error when no usable models are returned', async () => {
		mockJsonResponse({ data: [] });

		await expect(discoverProviderModels(provider)).rejects.toThrow(
			'The provider returned no usable models.',
		);
	});

	it.each([
		['blank API key', { apiKey: ' ' }, /API key/i],
		['missing base URL', { baseUrl: ' ' }, /base URL/i],
		['invalid base URL', { baseUrl: 'not a URL' }, /base URL/i],
		['non-HTTP base URL', { baseUrl: 'ftp://provider.example.test/v1' }, /base URL/i],
	])('rejects a %s before fetching', async (_label, override, message) => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			discoverProviderModels({ ...provider, ...override }),
		).rejects.toThrow(message);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('bounds and sanitizes HTTP errors without retrying', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(
			`Authorization: Bearer test-api-key ${'x'.repeat(10000)}`,
			{ status: 401 },
		));
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(discoverProviderModels(provider));
		expect(error.message).toContain('HTTP 401');
		expect(error.message).toContain('[credential redacted]');
		expect(error.message.length).toBeLessThanOrEqual(2000);
		expect(error.message).not.toContain(provider.apiKey);
		expect(error.message).not.toContain('Bearer');
		expect(error.message).not.toContain('Authorization');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('bounds and sanitizes network errors without retrying', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error(
			`Authorization: Bearer test-api-key ${'x'.repeat(10000)}`,
		));
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(discoverProviderModels(provider));
		expect(error.message).toContain('[credential redacted]');
		expect(error.message.length).toBeLessThanOrEqual(2000);
		expect(error.message).not.toContain(provider.apiKey);
		expect(error.message).not.toContain('Bearer');
		expect(error.message).not.toContain('Authorization');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('replaces every API key occurrence in errors', async () => {
		const fetchMock = vi.fn().mockRejectedValue(
			new Error('test-api-key failed; test-api-key failed again'),
		);
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(discoverProviderModels(provider));
		expect(error.message).toBe('[redacted] failed; [redacted] failed again');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('sanitizes and bounds non-abort errors when the signal is aborted', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error(
			`Authorization: Bearer test-api-key ${'x'.repeat(10000)}`,
		));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		controller.abort();

		const error = await getError(discoverProviderModels(provider, controller.signal));
		expect(error.message).toContain('[credential redacted]');
		expect(error.message.length).toBeLessThanOrEqual(2000);
		expect(error.message).not.toContain(provider.apiKey);
		expect(error.message).not.toContain('Bearer');
		expect(error.message).not.toContain('Authorization');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('propagates abort errors unchanged without retrying', async () => {
		const abortError = new DOMException('Aborted', 'AbortError');
		const fetchMock = vi.fn().mockRejectedValue(abortError);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		controller.abort();

		await expect(
			discoverProviderModels(provider, controller.signal),
		).rejects.toBe(abortError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
