import { createHmac, randomBytes } from 'crypto';
import { request } from 'https';
import { Readable } from 'stream';
import { EMEND_BUILD_ID } from './build-info';

const goBases = new Set([
	'https://opencode.ai/zen/go/v1',
	'https://opencode.ai/inference/go/openai/v1',
]);
const sessionSalt = randomBytes(32);

export function isGoBase(base: string): boolean {
	return goBases.has(base.trim().replace(/\/$/, ''));
}

export function goSessionId(path: string, session: string): string {
	return createHmac('sha256', sessionSalt)
		.update(JSON.stringify([path, session]))
		.digest('hex');
}

// Node HTTPS does not follow redirects. Keep the allowlist at the credential boundary.
export async function postGoChat(base: string, session: string, key: string, body: string, signal: AbortSignal) {
	if (!goBases.has(base) || !/^[a-f0-9]{64}$/.test(session)) {
		throw new Error('Invalid OpenCode Go chat destination or session.');
	}
	signal.throwIfAborted();
	const response = await new Promise<import('http').IncomingMessage>((resolve, reject) => {
		const req = request(`${base}/chat/completions`, {
			method: 'POST',
			signal,
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				'User-Agent': `Emend/${EMEND_BUILD_ID}`,
				'x-opencode-session': session,
			},
		}, resolve);
		req.on('error', reject);
		req.end(body);
	});
	const status = response.statusCode ?? 0;
	return {
		status,
		ok: status >= 200 && status < 300,
		get body(): import('stream/web').ReadableStream<Uint8Array> {
			return Readable.toWeb(response);
		},
		async text() {
			const parts: Buffer[] = [];
			let remaining = 16 * 1024;
			try {
				for await (const chunk of response) {
					const bytes = Buffer.from(chunk as Uint8Array).subarray(0, remaining);
					parts.push(bytes);
					remaining -= bytes.length;
					if (!remaining) break;
				}
				return Buffer.concat(parts).toString('utf8');
			} finally {
				response.destroy();
			}
		},
	};
}
