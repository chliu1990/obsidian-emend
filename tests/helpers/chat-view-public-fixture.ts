import { Scope, TFile, WorkspaceLeaf } from 'obsidian';
import { vi, type Mock } from 'vitest';
import { AdditionalNotesStore } from '../../src/additional-notes-store';
import { deriveAutomaticTitle, type ChatSession } from '../../src/chat-sessions';
import { EmendChatView } from '../../src/chat-view';
import type { RequestContext } from '../../src/context';
import type {
	ConversationStore,
	LoadedChatConversation,
} from '../../src/conversation-store';
import EmendPlugin from '../../src/main';
import type { SelectableMode } from '../../src/mode';
import type { SelectionEditTarget } from '../../src/selection-editor';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { ChatMessage, EmendSettings } from '../../src/types';
import {
	FakeElement,
	findElements,
	flushAnimationFrame,
} from './fake-element';

export {
	FakeElement,
	findElements,
	findMessageNode,
	messageContentElements,
	textOf,
} from './fake-element';

export interface PublicChatViewFixtureOptions {
	activePath?: string | null;
	sourceText?: string;
	selectedText?: string;
	defaultMode?: SelectableMode;
}

export interface ConversationStoreDouble {
	loadConversation: Mock<ConversationStore['loadConversation']>;
	createSession: Mock<ConversationStore['createSession']>;
	appendReadyMessage: Mock<ConversationStore['appendReadyMessage']>;
	setActiveSession: Mock<ConversationStore['setActiveSession']>;
	renameSession: Mock<ConversationStore['renameSession']>;
	deleteSession: Mock<ConversationStore['deleteSession']>;
	reorderSessions: Mock<ConversationStore['reorderSessions']>;
}

export interface PublicChatViewFixture {
	readonly view: EmendChatView;
	readonly contentEl: FakeElement;
	readonly conversationStore: ConversationStoreDouble;
	readonly requestChatCompletion: Mock<EmendPlugin['requestChatCompletion']>;
	readonly requestSelectionEdit: Mock<EmendPlugin['requestSelectionEdit']>;
	readonly captureChatContext: Mock<() => RequestContext>;
	readonly captureSelectionEditTarget: Mock<() => SelectionEditTarget>;
	readonly settings: EmendSettings;
	readonly additionalNotesStore: AdditionalNotesStore;
	open(): Promise<void>;
	close(): Promise<void>;
	setActivePath(path: string | null): void;
	flushAnimationFrame(): void;
}

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

export function makeSession(id = 'session-1', messages: ChatMessage[] = []): ChatSession {
	return {
		id,
		title: 'New chat',
		titleSource: 'auto',
		createdAt: 1,
		updatedAt: 1,
		messages,
	};
}

export function loadedConversation(
	sessions: ChatSession[],
	activeSessionId: string | null = sessions[0]?.id ?? null,
	kind: LoadedChatConversation['kind'] = 'schema3',
): LoadedChatConversation {
	return {
		kind,
		conversation: { version: 3, lastActiveSessionId: activeSessionId, sessions },
	};
}

export function findChatInput(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'textarea'
			&& element.className.split(' ').includes('emend-chat-input'),
	)[0];
}

export function findMessagesScroller(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-messages'),
	)[0];
}

export function findSessionSelect(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'select'
			&& element.attributes['aria-label'] === 'Chat session',
	)[0];
}

export function findSessionButton(
	contentEl: FakeElement,
	label: 'New chat session' | 'Rename chat session' | 'Delete chat session',
): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'button'
			&& element.attributes['aria-label'] === label,
	)[0];
}

export function findSendButton(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'button'
			&& element.attributes['aria-label'] === 'Send',
	)[0];
}

export function findMessageElements(contentEl: FakeElement): FakeElement[] {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-message'),
	);
}

export function findReasoningElements(contentEl: FakeElement): FakeElement[] {
	return findElements(
		contentEl,
		(element) => element.className.split(' ')
			.some((name) => name === 'emend-chat-reasoning'
				|| name === 'emend-chat-reasoning-content'),
	);
}

const fixtures: PublicChatViewFixture[] = [];

export function createPublicChatViewFixture(
	options: PublicChatViewFixtureOptions = {},
): PublicChatViewFixture {
	let activePath = options.activePath === undefined ? 'Note.md' : options.activePath;
	const sourceText = options.sourceText ?? 'Source text';
	const selectedText = options.selectedText ?? '';
	const selectedFrom = selectedText ? sourceText.indexOf(selectedText) : -1;
	const selectionFrom = selectedFrom >= 0 ? selectedFrom : 0;
	const selectionTo = selectedFrom >= 0 ? selectedFrom + selectedText.length : selectionFrom;
	const settings = structuredClone(DEFAULT_SETTINGS);
	if (options.defaultMode) {
		settings.defaultMode = options.defaultMode;
	}
	const additionalNotesStore = new AdditionalNotesStore();
	const contentEl = new FakeElement();
	const sessions = new Map<string, ChatSession>();
	const conversationStore: ConversationStoreDouble = {
		loadConversation: vi.fn<ConversationStore['loadConversation']>(
			async () => loadedConversation([]),
		),
		createSession: vi.fn<ConversationStore['createSession']>(
			async (_notePath, session) => {
				sessions.set(session.id, session);
				return session;
			},
		),
		appendReadyMessage: vi.fn<ConversationStore['appendReadyMessage']>(
			async (_notePath, sessionId, message, appendOptions) => {
				const session = sessions.get(sessionId) ?? makeSession(sessionId);
				const updated = {
					...session,
					title: message.role === 'assistant'
						&& session.titleSource === 'auto'
						&& appendOptions?.titlePrompt !== undefined
						? deriveAutomaticTitle(appendOptions.titlePrompt)
						: session.title,
					updatedAt: appendOptions?.now ?? session.updatedAt + 1,
					messages: [...session.messages, message],
				};
				sessions.set(sessionId, updated);
				return updated;
			},
		),
		setActiveSession: vi.fn<ConversationStore['setActiveSession']>(async () => undefined),
		renameSession: vi.fn<ConversationStore['renameSession']>(
			async (_notePath, sessionId, title, renameOptions) => {
				const session = sessions.get(sessionId) ?? makeSession(sessionId);
				const renamed = {
					...session,
					title,
					titleSource: 'manual' as const,
					updatedAt: renameOptions?.now ?? session.updatedAt + 1,
				};
				sessions.set(sessionId, renamed);
				return renamed;
			},
		),
		deleteSession: vi.fn<ConversationStore['deleteSession']>(
			async () => ({ activeSessionId: null }),
		),
		reorderSessions: vi.fn<ConversationStore['reorderSessions']>(async () => undefined),
	};
	const requestChatCompletion = vi.fn<EmendPlugin['requestChatCompletion']>();
	const requestSelectionEdit = vi.fn<EmendPlugin['requestSelectionEdit']>();
	const captureChatContext = vi.fn<() => RequestContext>(() => {
		const file = new TFile();
		file.path = activePath ?? 'Note.md';
		return {
			file,
			sourceText,
			selection: { from: selectionFrom, to: selectionTo },
			noteLabel: file.path,
			markdown: sourceText,
		};
	});
	const captureSelectionEditTarget = vi.fn<() => SelectionEditTarget>(() => {
		const file = new TFile();
		file.path = activePath ?? 'Note.md';
		return {
			snapshot: {
				file,
				fullText: sourceText,
				selectedText,
				from: selectionFrom,
				to: selectionTo,
			},
			editor: {
				readCurrentText: () => sourceText,
				isTargetCurrent: () => true,
				replaceRange: vi.fn(),
			},
		};
	});
	const workspaceEvents: Array<{
		name: string;
		callback: (...data: unknown[]) => unknown;
	}> = [];
	const app = {
		workspace: {
			on: vi.fn((name: string, callback: (...data: unknown[]) => unknown) => {
				const registration = { name, callback };
				workspaceEvents.push(registration);
				return registration;
			}),
		},
		vault: {
			getName: vi.fn(() => 'TestVault'),
			adapter: { read: vi.fn(async () => sourceText) },
		},
		scope: new Scope(),
	};
	const pluginDouble = {
		settings,
		additionalNotesStore,
		conversationStore,
		getApiKey: vi.fn(() => 'test-key'),
		getActiveNotePath: vi.fn(() => activePath),
		getActiveNoteLabel: vi.fn(() => activePath ?? 'No Markdown note is open'),
		hasUsableSelection: vi.fn(() => Boolean(selectedText.trim())),
		captureChatContext,
		captureChatSelectionContext: vi.fn(() => captureChatContext()),
		captureSelectionEditTarget,
		requestChatCompletion,
		requestSelectionEdit,
		saveSettings: vi.fn(async () => undefined),
	};
	const plugin = pluginDouble as unknown as EmendPlugin;
	const view = new EmendChatView(new WorkspaceLeaf(), plugin);
	Object.assign(view, { app, contentEl });
	const fixture: PublicChatViewFixture = {
		view,
		contentEl,
		conversationStore,
		requestChatCompletion,
		requestSelectionEdit,
		captureChatContext,
		captureSelectionEditTarget,
		settings,
		additionalNotesStore,
		open: async () => {
			await view.onOpen();
			if (
				pluginDouble.settings !== settings
				|| pluginDouble.additionalNotesStore !== additionalNotesStore
			) {
				throw new Error('The public fixture host references changed.');
			}
		},
		close: () => view.onClose(),
		setActivePath: (path) => {
			activePath = path;
		},
		flushAnimationFrame: () => flushAnimationFrame(contentEl),
	};
	fixtures.push(fixture);
	return fixture;
}

export async function closePublicChatViewFixtures(): Promise<void> {
	const created = fixtures.splice(0);
	for (const fixture of created) {
		await fixture.close();
	}
}
