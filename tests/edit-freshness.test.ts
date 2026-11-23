import { describe, expect, it, vi, type Mock } from 'vitest';
import {
	assertEditFreshness,
	STALE_NOTE_ERROR,
	type EditFreshnessSource,
} from '../src/edit-freshness';

const CAPTURED = 'CAPTURED_PRIVATE_SOURCE';
const DISK_CHANGED = 'DISK_PRIVATE_DIVERGENCE';
const EDITOR_CHANGED = 'EDITOR_PRIVATE_DIVERGENCE';

function makeSource(overrides: Partial<EditFreshnessSource> = {}) {
	const readDiskText: Mock<() => Promise<string>> = vi.fn(async () => CAPTURED);
	const readEditorTexts: Mock<() => readonly string[] | undefined> = vi.fn(
		() => undefined,
	);
	const isTargetCurrent: Mock<() => boolean> = vi.fn(() => true);
	const source: EditFreshnessSource = {
		capturedText: CAPTURED,
		readDiskText,
		readEditorTexts,
		isTargetCurrent,
		...overrides,
	};
	return { source, readDiskText, readEditorTexts, isTargetCurrent };
}

async function expectStale(
	promise: Promise<void>,
	...sentinels: readonly string[]
): Promise<void> {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(Error);
	const message = (error as Error).message;
	expect(message).toBe(STALE_NOTE_ERROR);
	for (const sentinel of sentinels) {
		expect(message).not.toContain(sentinel);
	}
}

describe('assertEditFreshness', () => {
	it('accepts matching disk text with no open editor list', async () => {
		const { source, readDiskText, readEditorTexts, isTargetCurrent } =
			makeSource();

		await expect(assertEditFreshness(source)).resolves.toBeUndefined();

		expect(readDiskText).toHaveBeenCalledTimes(1);
		expect(readEditorTexts).toHaveBeenCalledTimes(1);
		expect(isTargetCurrent).toHaveBeenCalledTimes(1);
	});

	it('accepts matching disk text with an empty editor list', async () => {
		const { source } = makeSource({ readEditorTexts: () => [] });

		await expect(assertEditFreshness(source)).resolves.toBeUndefined();
	});

	it('accepts matching disk and all editor texts', async () => {
		const { source } = makeSource({
			readEditorTexts: () => [CAPTURED, CAPTURED, CAPTURED],
		});

		await expect(assertEditFreshness(source)).resolves.toBeUndefined();
	});

	it('rejects disk divergence without exposing source text', async () => {
		const { source } = makeSource({
			readDiskText: async () => DISK_CHANGED,
			readEditorTexts: () => [CAPTURED],
		});

		await expectStale(
			assertEditFreshness(source),
			CAPTURED,
			DISK_CHANGED,
		);
	});

	it('rejects divergence in the first editor', async () => {
		const { source } = makeSource({
			readEditorTexts: () => [EDITOR_CHANGED, CAPTURED],
		});

		await expectStale(
			assertEditFreshness(source),
			CAPTURED,
			EDITOR_CHANGED,
		);
	});

	it('rejects divergence in a later editor', async () => {
		const { source } = makeSource({
			readEditorTexts: () => [CAPTURED, CAPTURED, EDITOR_CHANGED],
		});

		await expectStale(
			assertEditFreshness(source),
			CAPTURED,
			EDITOR_CHANGED,
		);
	});

	it('does not let a clean sibling mask a dirty target editor', async () => {
		const { source } = makeSource({
			readEditorTexts: () => [EDITOR_CHANGED, CAPTURED],
		});

		await expectStale(
			assertEditFreshness(source),
			CAPTURED,
			EDITOR_CHANGED,
		);
	});

	it('rejects a false current target without exposing source text', async () => {
		const { source } = makeSource({ isTargetCurrent: () => false });

		await expectStale(assertEditFreshness(source), CAPTURED);
	});

	it('aborts before reading when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const { source, readDiskText, readEditorTexts, isTargetCurrent } =
			makeSource();

		await expect(assertEditFreshness(source, controller.signal)).rejects.toBe(
			controller.signal.reason,
		);
		expect(readDiskText).not.toHaveBeenCalled();
		expect(readEditorTexts).not.toHaveBeenCalled();
		expect(isTargetCurrent).not.toHaveBeenCalled();
	});

	it('aborts after a pending disk read settles', async () => {
		const controller = new AbortController();
		let resolveDisk: ((text: string) => void) | undefined;
		const diskRead = new Promise<string>((resolve) => {
			resolveDisk = resolve;
		});
		const readDiskText = vi.fn(() => diskRead);
		const { source, readEditorTexts, isTargetCurrent } = makeSource({
			readDiskText,
		});

		const freshness = assertEditFreshness(source, controller.signal);
		controller.abort();
		resolveDisk?.(CAPTURED);

		await expect(freshness).rejects.toBe(controller.signal.reason);
		expect(readDiskText).toHaveBeenCalledTimes(1);
		expect(readEditorTexts).toHaveBeenCalledTimes(1);
		expect(isTargetCurrent).not.toHaveBeenCalled();
	});

	it('accepts exact matching CRLF text without normalization', async () => {
		const crlf = 'PRIVATE_CRLF\r\nSecond line\r\n';
		const { source } = makeSource({
			capturedText: crlf,
			readDiskText: async () => crlf,
			readEditorTexts: () => [crlf, crlf],
		});

		await expect(assertEditFreshness(source)).resolves.toBeUndefined();
	});

	it('rejects CRLF and LF differences', async () => {
		const captured = 'PRIVATE_LINE_ENDINGS\nSecond line\n';
		const disk = 'PRIVATE_LINE_ENDINGS\r\nSecond line\r\n';
		const { source } = makeSource({
			capturedText: captured,
			readDiskText: async () => disk,
			readEditorTexts: () => [captured],
		});

		await expectStale(assertEditFreshness(source), captured, disk);
	});

	it('rejects NFC and NFD differences', async () => {
		const captured = 'PRIVATE_NFC_\u00e9';
		const disk = 'PRIVATE_NFD_e\u0301';
		const { source } = makeSource({
			capturedText: captured,
			readDiskText: async () => disk,
			readEditorTexts: () => [captured],
		});

		await expectStale(assertEditFreshness(source), captured, disk);
	});

	it('propagates the disk reader error by identity', async () => {
		const readerError = new Error('Disk reader failed privately.');
		const { source, readEditorTexts, isTargetCurrent } = makeSource({
			readDiskText: async () => {
				throw readerError;
			},
		});

		await expect(assertEditFreshness(source)).rejects.toBe(readerError);
		expect(readEditorTexts).not.toHaveBeenCalled();
		expect(isTargetCurrent).not.toHaveBeenCalled();
	});

	it('propagates the editor reader error by identity', async () => {
		const readerError = new Error('Editor reader failed privately.');
		const { source, isTargetCurrent } = makeSource({
			readEditorTexts: () => {
				throw readerError;
			},
		});

		await expect(assertEditFreshness(source)).rejects.toBe(readerError);
		expect(isTargetCurrent).not.toHaveBeenCalled();
	});

	it('orders abort checks, one disk read, one editor snapshot, and target evaluation', async () => {
		const events: string[] = [];
		const controller = new AbortController();
		vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
			events.push('abort check');
		});
		const readDiskText = vi.fn(async () => {
			events.push('disk read');
			return CAPTURED;
		});
		const readEditorTexts = vi.fn(() => {
			events.push('editor snapshot');
			return [CAPTURED];
		});
		const source: EditFreshnessSource = {
			get capturedText() {
				events.push('captured text');
				return CAPTURED;
			},
			readDiskText,
			readEditorTexts,
			isTargetCurrent: () => {
				events.push('target check');
				return true;
			},
		};

		await assertEditFreshness(source, controller.signal);

		expect(events).toEqual([
			'abort check',
			'disk read',
			'editor snapshot',
			'abort check',
			'captured text',
			'target check',
		]);
		expect(readDiskText).toHaveBeenCalledTimes(1);
		expect(readEditorTexts).toHaveBeenCalledTimes(1);
	});
});
