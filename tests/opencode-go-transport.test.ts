import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { goSessionId, isGoBase, postGoChat } from '../src/opencode-go-transport';
import { requestAiResponse } from '../src/provider-stream';
import { DEFAULT_SETTINGS } from '../src/settings';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('https', () => ({ request: send }));
const base = 'https://opencode.ai/zen/go/v1';
const session = goSessionId('Example.md', 'first');
function setup(statusCode: number) {
	const upstream = Object.assign(new PassThrough(), { statusCode });
	send.mockImplementation((_url, _options, headers: (stream: typeof upstream) => void) =>
		Object.assign(new EventEmitter(), { end: () => headers(upstream) }));
	const controller = new AbortController();
	const onEvent = vi.fn();
	const key = crypto.randomUUID();
	const result = requestAiResponse({
		goSession: session, systemPrompt: '', userPrompt: 'Hello', history: [],
		provider: { ...DEFAULT_SETTINGS.providers.custom, apiKey: key, baseUrl: base, model: 'gemini-4-argon' },
	}, { onEvent }, controller.signal);
	return { upstream, controller, onEvent, result, key };
}

describe('OpenCode Go desktop Chat', () => {
	it('isolates conversations without disclosing their local identity', () => {
		expect(session).toMatch(/^[a-f0-9]{64}$/);
		expect(goSessionId('Example.md', 'first')).toBe(session);
		expect(goSessionId('Other.md', 'first')).not.toBe(session);
		expect(goSessionId('Example.md', 'second')).not.toBe(session);
	});

	it.each([`${base}?q=1`, `${base}#x`, base.replace('https:', 'http:'),
		base.replace('.ai', '.ai.example'), base.replace('.ai', '.ai:444'),
		base.replace('//', '//user@')])('refuses %s before sending credentials', async (url) => {
		expect(isGoBase(url)).toBe(false);
		await expect(postGoChat(url, session, '', '{}', new AbortController().signal)).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});

	it('emits partial text before DONE and closes the open stream', async () => {
		const { upstream, result, controller, onEvent } = setup(200);
		expect(send.mock.calls[0]?.[0]).toBe(`${base}/chat/completions`);
		expect(send.mock.calls[0]?.[1]).toMatchObject({
			signal: controller.signal,
			headers: { 'x-opencode-session': session, 'User-Agent': 'Emend/test-build' },
		});
		upstream.write('data: {"choices":[{"delta":');
		upstream.write('{"content":"hello"}}]}\n\n');
		await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: 'content', text: 'hello' }));
		upstream.write('data: [DONE]\n\n');
		await expect(result).resolves.toMatchObject({ content: 'hello' });
		expect(upstream.destroyed).toBe(true);
	});

	it('does not follow a redirect and redacts credentials in errors', async () => {
		const { upstream, result, key } = setup(307);
		Object.assign(upstream, { headers: { location: 'https://example.test' } });
		upstream.end(`Bearer ${key}`);
		const error: unknown = await result.catch((reason: unknown) => reason);
		expect(String(error)).toContain('307');
		expect(String(error)).not.toContain(key);
		expect(send).toHaveBeenCalledOnce();
	});
});
