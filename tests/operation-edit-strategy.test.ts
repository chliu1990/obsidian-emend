import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/context';
import {
	criticMarkupEditStrategy,
	getEditStrategy,
} from '../src/edit-strategy';
import type { NoteWriter } from '../src/note-writer';
import {
	compileEditOperations,
	operationEditStrategy,
} from '../src/operation-edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { EditRequestCoordinator } from '../src/request-coordinator';
import {
	SelectionEditRequestCoordinator,
	type SelectionEditorAdapter,
} from '../src/selection-editor';
import { DEFAULT_SETTINGS } from '../src/settings';
import type {
	InstructionPromptParts,
	ProviderConfig,
	SelectionSnapshot,
} from '../src/types';

function prepare(original: string, operations: unknown) {
	return operationEditStrategy.prepareEdit(original, JSON.stringify(operations));
}

describe('operation EditStrategy protocol', () => {
	it('compiles an insertion before an unchanged anchor', () => {
		expect(prepare('Alpha beta', [
			{ type: 'insert', anchor: 'beta', position: 'before', text: 'new ' },
		])).toEqual({
			annotatedMarkdown: 'Alpha {++new ++}beta',
			changeCount: 1,
		});
	});

	it('compiles an insertion after an unchanged anchor', () => {
		expect(prepare('Alpha beta', [
			{ type: 'insert', anchor: 'Alpha', position: 'after', text: ' new' },
		])).toEqual({
			annotatedMarkdown: 'Alpha{++ new++} beta',
			changeCount: 1,
		});
	});

	it('compiles a removal', () => {
		expect(prepare('Alpha beta', [{ type: 'remove', target: 'beta' }])).toEqual({
			annotatedMarkdown: 'Alpha {--beta--}',
			changeCount: 1,
		});
	});

	it('compiles a replacement', () => {
		expect(prepare('Alpha beta', [
			{ type: 'replace', target: 'beta', replacement: 'gamma' },
		])).toEqual({
			annotatedMarkdown: 'Alpha {~~beta~>gamma~~}',
			changeCount: 1,
		});
	});

	it('compiles a comment after an unchanged target with zero text changes', () => {
		expect(prepare('Alpha beta', [
			{ type: 'comment', target: 'beta', comment: 'Review this.' },
		])).toEqual({
			annotatedMarkdown: 'Alpha beta{>>Review this.<<}',
			changeCount: 0,
		});
	});

	it('accepts an empty array as a no-op', () => {
		expect(prepare('Alpha beta', [])).toEqual({
			annotatedMarkdown: 'Alpha beta',
			changeCount: 0,
		});
	});

	it('supports exact unicode and multiline anchors', () => {
		const original = '前🙂\n第一行\n第二行\n後';
		expect(prepare(original, [
			{
				type: 'replace',
				target: '第一行\n第二行',
				replacement: '新しい🙂\n行',
			},
			{ type: 'insert', anchor: '後', position: 'before', text: '終\n' },
		])).toEqual({
			annotatedMarkdown: '前🙂\n{~~第一行\n第二行~>新しい🙂\n行~~}\n{++終\n++}後',
			changeCount: 2,
		});
	});

	it.each(['insert', 'remove', 'replace', 'comment'] as const)(
		'uses a one-based occurrence to disambiguate a repeated %s target',
		(type) => {
			const operation = type === 'insert'
				? { type, anchor: 'same', position: 'after', text: '!', occurrence: 2 }
				: type === 'remove'
					? { type, target: 'same', occurrence: 2 }
					: type === 'replace'
						? { type, target: 'same', replacement: 'new', occurrence: 2 }
						: { type, target: 'same', comment: 'note', occurrence: 2 };

			expect(prepare('same same same', [operation]).annotatedMarkdown).toBe(
				type === 'insert'
					? 'same same{++!++} same'
					: type === 'remove'
						? 'same {--same--} same'
						: type === 'replace'
							? 'same {~~same~>new~~} same'
							: 'same same{>>note<<} same',
			);
		},
	);

	it('applies disjoint operations from highest to lowest original offset', () => {
		expect(prepare('one two three four', [
			{ type: 'replace', target: 'two', replacement: '2' },
			{ type: 'remove', target: 'four' },
			{ type: 'insert', anchor: 'one', position: 'after', text: '!' },
			{ type: 'comment', target: 'three', comment: 'keep' },
		]).annotatedMarkdown).toBe(
			'one{++!++} {~~two~>2~~} three{>>keep<<} {--four--}',
		);
	});

	it('keeps multiple insertions at one original position in request order', () => {
		expect(prepare('anchor', [
			{ type: 'insert', anchor: 'anchor', position: 'after', text: 'first' },
			{ type: 'insert', anchor: 'anchor', position: 'after', text: 'second' },
			{ type: 'insert', anchor: 'anchor', position: 'after', text: 'third' },
		]).annotatedMarkdown).toBe(
			'anchor{++first++}{++second++}{++third++}',
		);
	});

	it('preserves pre-existing Track Changes markup through Stage 07 revalidation', () => {
		const original = '{++Existing++} alpha';
		expect(prepare(original, [
			{ type: 'replace', target: 'alpha', replacement: 'beta' },
		])).toEqual({
			annotatedMarkdown: '{++Existing++} {~~alpha~>beta~~}',
			changeCount: 1,
		});
	});

	it('lets Stage 07 reject compilation that would nest inside existing markup', () => {
		expect(() => prepare('{--alpha--}', [
			{ type: 'comment', target: 'alpha', comment: 'nested' },
		])).toThrow(/Nested CriticMarkup|preserve every original token|reject view/);
	});

	it.each([
		'',
		'not json',
		'```json\n[]\n```',
		'[]\nDone.',
		'{}',
		'null',
		'"remove alpha"',
	])('requires a bare JSON array: %s', (response) => {
		expect(() => compileEditOperations('Alpha', response)).toThrow();
	});

	it.each([
		[{ type: 'unknown', target: 'Alpha' }],
		[{ type: 'insert', anchor: 'Alpha', position: 'after', text: 'x', extra: true }],
		[{ type: 'remove', target: 'Alpha', replacement: '' }],
		[{ type: 'replace', target: 'Alpha', replacement: 'x', anchor: 'Alpha' }],
		[{ type: 'comment', target: 'Alpha', comment: 'x', position: 'after' }],
		[{ type: 'insert', anchor: 'Alpha', position: 'middle', text: 'x' }],
		[{ type: 'insert', anchor: 'Alpha', position: 'after' }],
		[{ type: 'remove' }],
		[{ type: 'replace', target: 'Alpha' }],
		[{ type: 'comment', target: 'Alpha' }],
		[null],
		[[[]]],
		['remove'],
	])('rejects a closed-union violation atomically: %s', (operations) => {
		expect(() => prepare('Alpha', operations)).toThrow();
	});

	it.each([
		{ type: 'insert', anchor: '', position: 'after', text: 'x' },
		{ type: 'remove', target: '' },
		{ type: 'replace', target: '', replacement: 'x' },
		{ type: 'comment', target: '', comment: 'x' },
		{ type: 'insert', anchor: 'Alpha', position: 'after', text: '' },
		{ type: 'replace', target: 'Alpha', replacement: '' },
		{ type: 'comment', target: 'Alpha', comment: '' },
	])('rejects empty required operation strings: %s', (operation) => {
		expect(() => prepare('Alpha', [operation])).toThrow();
	});

	it.each([0, -1, 1.5, 4, '1', null, true])(
		'rejects an invalid or out-of-range occurrence: %s',
		(occurrence) => {
			expect(() => prepare('same same same', [
				{ type: 'remove', target: 'same', occurrence },
			])).toThrow();
		},
	);

	it('rejects an ambiguous target when occurrence is absent', () => {
		expect(() => prepare('same same', [
			{ type: 'remove', target: 'same' },
		])).toThrow(/ambiguous/i);
	});

	it('rejects a target missing from the original snapshot', () => {
		expect(() => prepare('Alpha', [
			{ type: 'remove', target: 'Beta' },
		])).toThrow(/not found|match/i);
	});

	it.each([
		[
			[
				{ type: 'replace', target: 'Alpha beta', replacement: 'x' },
				{ type: 'remove', target: 'beta' },
			],
		],
		[
			[
				{ type: 'comment', target: 'Alpha', comment: 'one' },
				{ type: 'comment', target: 'Alpha', comment: 'two' },
			],
		],
		[
			[
				{ type: 'remove', target: 'Alpha beta' },
				{ type: 'replace', target: 'beta gamma', replacement: 'x' },
			],
		],
	])('rejects duplicate or overlapping target ranges: %s', (operations) => {
		expect(() => prepare('Alpha beta gamma', operations)).toThrow(/overlap/i);
	});

	it.each([
		[
			{ type: 'insert', anchor: 'Alpha', position: 'after', text: 'x' },
			{ type: 'remove', target: 'Alpha beta' },
		],
		[
			{ type: 'insert', anchor: 'beta', position: 'before', text: 'x' },
			{ type: 'replace', target: 'Alpha beta', replacement: 'x' },
		],
		[
			{ type: 'insert', anchor: 'Alpha', position: 'before', text: 'x' },
			{ type: 'comment', target: 'Alpha', comment: 'note' },
		],
		[
			{ type: 'insert', anchor: 'one', position: 'after', text: 'x' },
			{ type: 'remove', target: 'two' },
		],
		[
			{ type: 'insert', anchor: 'Alpha beta', position: 'after', text: 'x' },
			{ type: 'remove', target: 'Alpha' },
		],
	])('rejects an ambiguous insertion and changed target combination: %s', (insert, changed) => {
		const original = changed.target === 'two' ? 'onetwo' : 'Alpha beta';
		expect(() => prepare(original, [insert, changed])).toThrow(/insert|ambiguous|overlap/i);
	});

	it.each(['{++', '++}', '{--', '--}', '{~~', '~~}', '~>', '{>>', '<<}', '{==', '==}'])(
		'rejects CriticMarkup delimiter injection through operation text: %s',
		(delimiter) => {
			expect(() => prepare('Alpha', [
				{ type: 'insert', anchor: 'Alpha', position: 'after', text: delimiter },
			])).toThrow(/delimiter/i);
			expect(() => prepare(`Alpha ${delimiter} beta`, [
				{ type: 'remove', target: delimiter },
			])).toThrow(/delimiter/i);
		},
	);

	it('rejects the entire array when a later operation is invalid', () => {
		expect(() => prepare('Alpha beta', [
			{ type: 'replace', target: 'Alpha', replacement: 'Changed' },
			{ type: 'remove', target: 'missing' },
		])).toThrow();
	});
});

describe('operation EditStrategy selection boundaries', () => {
	it('cannot address text outside the selection passed as the original snapshot', () => {
		expect(() => prepare('beta', [
			{ type: 'replace', target: 'Alpha', replacement: 'Changed' },
		])).toThrow(/not found|match/i);
	});
});

describe('edit strategy factory and prompts', () => {
	it('keeps CriticMarkup as the default and returns operations only by explicit selection', () => {
		expect(getEditStrategy(DEFAULT_SETTINGS)).toBe(criticMarkupEditStrategy);
		expect(getEditStrategy({ ...DEFAULT_SETTINGS, editStrategy: 'operations' })).toBe(
			operationEditStrategy,
		);
	});

	it.each(['full', 'selection'] as const)(
		'documents only the closed JSON command protocol in the %s prompt with skills before AGENTS',
		(kind) => {
			const instructions: InstructionPromptParts = {
				agentText: 'Agent instructions',
				skillTexts: new Map([['skills/review/SKILL.md', 'Review skill']]),
			};
			const prompt = kind === 'full'
				? operationEditStrategy.getFullNotePrompt(instructions)
				: operationEditStrategy.getSelectionPrompt(instructions);

			expect(prompt).toContain('bare JSON array');
			expect(prompt).toContain('"insert"');
			expect(prompt).toContain('"remove"');
			expect(prompt).toContain('"replace"');
			expect(prompt).toContain('"comment"');
			expect(prompt).toContain('occurrence');
			expect(prompt).toContain('Do not return');
			expect(prompt).not.toContain('COMPLETE note with every requested change marked using CriticMarkup');
			expect(prompt.indexOf('Review skill')).toBeLessThan(prompt.indexOf('Agent instructions'));
			if (kind === 'selection') {
				expect(prompt).toContain('selected portion');
				expect(prompt).toContain('inside the selection');
			}
		},
	);
});

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
	requestUsage: false,
};

function operationRequest(response: string) {
	return vi.fn(async (
		_request: AiProviderRequest,
		callbacks: { onEvent(event: StreamEvent): void },
	): Promise<StreamResult> => {
		callbacks.onEvent({ type: 'content', text: response });
		return { content: response, reasoning: '' };
	});
}

describe('operation strategy coordinator integration', () => {
	it.each(['toString', 'constructor', '__proto__'])(
		'rejects inherited operation type %s with controlled validation and no write',
		async (type) => {
			const file = new TFile();
			file.path = 'note.md';
			const sourceText = 'Alpha beta';
			const context: RequestContext = {
				file,
				sourceText,
				markdown: sourceText,
				selection: { from: 0, to: 0 },
				noteLabel: 'note.md',
			};
			const writer: NoteWriter = {
				readCurrentText: vi.fn(async () => sourceText),
				write: vi.fn(async () => undefined),
				isTargetCurrent: vi.fn(() => true),
			};
			const coordinator = new EditRequestCoordinator({
				provider,
				loadInstructions: async () => ({ skillTexts: new Map() }),
				request: operationRequest(JSON.stringify([{ type, target: 'beta' }])),
				writer,
				editStrategy: operationEditStrategy,
			});

			await expect(coordinator.submit({
				context,
				mode: 'edit',
				prompt: 'Attempt an inherited operation type.',
				history: [],
				callbacks: { onReasoning: vi.fn() },
				signal: new AbortController().signal,
			})).rejects.toThrow('Operation 1 has an unknown type or malformed value.');
			expect(writer.readCurrentText).not.toHaveBeenCalled();
			expect(writer.write).not.toHaveBeenCalled();
		},
	);

	it('uses the selected strategy prompt and guarded full-note writer', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const sourceText = 'Alpha beta';
		const context: RequestContext = {
			file,
			sourceText,
			markdown: sourceText,
			selection: { from: 0, to: 0 },
			noteLabel: 'note.md',
		};
		const writer: NoteWriter = {
			readCurrentText: vi.fn(async () => sourceText),
			write: vi.fn(async () => undefined),
			isTargetCurrent: vi.fn(() => true),
		};
		const response = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'gamma' },
		]);
		const request = operationRequest(response);
		const coordinator = new EditRequestCoordinator({
			provider,
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request,
			writer,
			editStrategy: operationEditStrategy,
		});

		await expect(coordinator.submit({
			context,
			mode: 'edit',
			prompt: 'Replace beta.',
			history: [],
			callbacks: { onReasoning: vi.fn() },
			signal: new AbortController().signal,
		})).resolves.toMatchObject({ applied: true, changeCount: 1 });
		expect(request.mock.calls[0]?.[0].systemPrompt).toContain('bare JSON array');
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(file, 'Alpha {~~beta~>gamma~~}');
	});

	it('uses the selected strategy for selections and rejects out-of-selection targets without a read or write', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const fullText = 'Alpha beta gamma';
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const editor: SelectionEditorAdapter = {
			readCurrentText: vi.fn(() => fullText),
			isTargetCurrent: vi.fn(() => true),
			replaceRange: vi.fn(),
		};
		const coordinator = new SelectionEditRequestCoordinator({
			provider,
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request: operationRequest(JSON.stringify([
				{ type: 'replace', target: 'Alpha', replacement: 'Changed' },
			])),
			editor,
			editStrategy: operationEditStrategy,
		});

		await expect(coordinator.submit({
			snapshot,
			prompt: 'Change Alpha.',
			maxContextCharacters: 1000,
			smartSelectionContext: true,
			signal: new AbortController().signal,
		})).rejects.toThrow(/not found|match/i);
		expect(editor.readCurrentText).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a valid operation selection through the guarded native editor adapter', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const fullText = 'Alpha beta gamma';
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const editor: SelectionEditorAdapter = {
			readCurrentText: vi.fn(() => fullText),
			isTargetCurrent: vi.fn(() => true),
			replaceRange: vi.fn(),
		};
		const request = operationRequest(JSON.stringify([
			{ type: 'comment', target: 'beta', comment: 'Review' },
		]));
		const coordinator = new SelectionEditRequestCoordinator({
			provider,
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request,
			editor,
			editStrategy: operationEditStrategy,
		});

		await expect(coordinator.submit({
			snapshot,
			prompt: 'Comment on beta.',
			maxContextCharacters: 1000,
			smartSelectionContext: true,
			signal: new AbortController().signal,
		})).resolves.toEqual({ applied: true, changeCount: 0 });
		expect(request.mock.calls[0]?.[0].systemPrompt).toContain('inside the selection');
		expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith('beta{>>Review<<}', 6, 10);
	});
});
