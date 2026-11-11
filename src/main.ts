import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { captureAdditionalNotes } from './additional-notes-context';
import { AdditionalNotesStore } from './additional-notes-store';
import { EMEND_CHAT_VIEW_TYPE, EmendChatView } from './chat-view';
import {
	captureRequestContext,
	type RequestContext,
} from './context';
import { ConversationStore } from './conversation-store';
import { DeepSeekWebSearchCoordinator } from './deepseek-web';
import { getEditStrategy } from './edit-strategy';
import { loadAllInstructions } from './instructions-loader';
import { createVaultNoteWriter } from './note-writer';
import { requestAiResponse } from './provider-stream';
import {
	EditRequestCoordinator,
	ReadOnlyRequestCoordinator,
	type ChatStreamResult,
	type EditRequestResult,
	type EditSubmission,
	type ReadOnlySubmission,
} from './request-coordinator';
import {
	captureSelectionEditTarget,
	createSelectionEditorAdapter,
	SelectionEditRequestCoordinator,
	type SelectionEditCallbacks,
	type SelectionEditResult,
	type SelectionEditTarget,
} from './selection-editor';
import { SelectionModal } from './selection-modal';
import { ApiKeyStorage } from './secret-storage';
import {
	DEFAULT_SETTINGS,
	EmendSettingTab,
	normalizeSettings,
	sanitizeSettings,
} from './settings';
import type {
	EmendSettings,
	Mode,
	ProviderHistoryMessage,
	ProviderId,
	SelectionSnapshot,
} from './types';
import { supportsDeepSeekWeb } from './web-search';

type ReadOnlyMainSubmission = Omit<ReadOnlySubmission, 'additionalNotePaths'> & {
	additionalNotePaths?: readonly string[];
};

type EditMainSubmission = Omit<EditSubmission, 'additionalNotePaths'> & {
	additionalNotePaths?: readonly string[];
};

export default class EmendPlugin extends Plugin {
	settings!: EmendSettings;
	conversationStore!: ConversationStore;
	additionalNotesStore!: AdditionalNotesStore;
	private apiKeyStorage: ApiKeyStorage | undefined;
	private lastMarkdownView: MarkdownView | null = null;
	private pendingNotePaths: Set<string> | undefined;

	async onload() {
		await this.loadSettings();
		this.conversationStore = new ConversationStore(
			this.app.vault.adapter,
			this.app.vault.configDir,
			(message) => new Notice(message),
		);
		this.additionalNotesStore = new AdditionalNotesStore();

		this.registerView(
			EMEND_CHAT_VIEW_TYPE,
			(leaf) => new EmendChatView(leaf, this),
		);
		this.rememberActiveMarkdownView();
		const refreshChatTargetNotes = () => {
			this.rememberActiveMarkdownView();
			for (const leaf of this.app.workspace.getLeavesOfType(
				EMEND_CHAT_VIEW_TYPE,
			)) {
				if (leaf.view instanceof EmendChatView) {
					void leaf.view.refreshTargetNote();
				}
			}
		};
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', refreshChatTargetNotes),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', refreshChatTargetNotes),
		);
		if (typeof this.app.vault.on === 'function') {
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (file instanceof TFile) {
						this.additionalNotesStore.rename(oldPath, file.path);
					}
				}),
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (file instanceof TFile) {
						this.additionalNotesStore.removeDeleted(file.path);
					}
				}),
			);
		}

		// eslint-disable-next-line obsidianmd/ui/sentence-case -- Required Stage 18 public label.
		this.addRibbonIcon('messages-square', 'Open Emend chat', () => {
			void this.activateChatView();
		});

		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- Required Stage 02 public identifier.
			id: 'emend:open-chat',
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case -- Required Stage 18 public label.
			name: 'Open Emend chat',
			callback: () => {
				void this.activateChatView();
			},
		});

		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- Required Stage 13 public identifier.
			id: 'emend:switch-to-ask-mode',
			name: 'Switch to ask mode',
			// eslint-disable-next-line obsidianmd/commands/no-default-hotkeys -- Required Stage 13 shortcut.
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'A' }],
			callback: () => {
				void this.activateChatMode('ask');
			},
		});

		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- Required Stage 13 public identifier.
			id: 'emend:switch-to-edit-mode',
			name: 'Switch to edit mode',
			// eslint-disable-next-line obsidianmd/commands/no-default-hotkeys -- Required Stage 13 shortcut.
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'E' }],
			callback: () => {
				void this.activateChatMode('edit');
			},
		});

		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- Required Stage 09 public identifier.
			id: 'emend:modify-selected-text',
			name: 'Modify selected text with AI',
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView) || !editor.getSelection()) {
					return false;
				}
				if (checking) {
					return true;
				}

				try {
					const { snapshot, editor } = captureSelectionEditTarget(
						view,
						(candidate) => this.getTargetMarkdownView() === candidate,
					);
					const modal = new SelectionModal(
						this.app,
						(prompt, signal, additionalNotePaths) => this.requestSelectionEdit(
							snapshot,
							prompt,
							signal,
							editor,
							additionalNotePaths,
						),
						this.additionalNotesStore,
						snapshot.file.path,
					);
					this.register(() => modal.close());
					modal.open();
				} catch (error) {
					new Notice(`Emend: ${getErrorMessage(error)}`);
				}
				return true;
			},
		});

		this.addSettingTab(new EmendSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
		const storage = this.getApiKeyStorage();
		let migrated = false;
		for (const providerId of ['deepseek', 'kimi', 'custom'] as const) {
			const provider = this.settings.providers[providerId];
			if (provider.apiKey) {
				const legacyApiKey = provider.apiKey.trim();
				if (legacyApiKey) {
					storage.setApiKey(providerId, legacyApiKey);
				}
				provider.apiKey = '';
				migrated = true;
			}
		}
		if (migrated) {
			await this.saveSettings();
		}
	}

	getApiKey(providerId: ProviderId) {
		return this.getApiKeyStorage().getApiKey(providerId);
	}

	async setApiKey(providerId: ProviderId, value: string) {
		this.getApiKeyStorage().setApiKey(providerId, value.trim());
		this.settings.providers[providerId].apiKey = '';
		this.settings.providers[providerId].discoveredModels = [];
		await this.saveSettings();
	}

	private getApiKeyStorage() {
		return (this.apiKeyStorage ??= new ApiKeyStorage(this.app.secretStorage));
	}

	async saveSettings() {
		await this.saveData(sanitizeSettings(this.settings));
		this.refreshChatModelLabels();
	}

	private refreshChatModelLabels() {
		for (const leaf of this.app.workspace.getLeavesOfType(
			EMEND_CHAT_VIEW_TYPE,
		)) {
			if (leaf.view instanceof EmendChatView) {
				leaf.view.refreshActiveModelLabel();
			}
		}
	}

	async activateChatView() {
		const existingLeaf = this.app.workspace.getLeavesOfType(
			EMEND_CHAT_VIEW_TYPE,
		)[0];
		const leaf =
			existingLeaf ??
			(await this.app.workspace.ensureSideLeaf(
				EMEND_CHAT_VIEW_TYPE,
				'right',
				{
					active: true,
					reveal: true,
				},
			));

		await leaf.setViewState({
			type: EMEND_CHAT_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	private async activateChatMode(mode: Mode) {
		await this.activateChatView();
		for (const leaf of this.app.workspace.getLeavesOfType(
			EMEND_CHAT_VIEW_TYPE,
		)) {
			if (leaf.view instanceof EmendChatView) {
				leaf.view.setMode(mode);
				return;
			}
		}
	}

	getActiveNoteLabel() {
		const markdownView = this.getTargetMarkdownView();
		return markdownView?.file?.path ?? 'No Markdown note is open';
	}

	getActiveNotePath() {
		return this.getTargetMarkdownView()?.file?.path ?? null;
	}

	captureSelectionEditTarget(): SelectionEditTarget {
		const markdownView = this.getTargetMarkdownView();
		if (!markdownView) {
			throw new Error('Open a Markdown note first.');
		}
		return captureSelectionEditTarget(
			markdownView,
			(candidate) => this.getTargetMarkdownView() === candidate,
		);
	}

	hasUsableSelection(): boolean {
		return Boolean(
			this.getTargetMarkdownView()?.editor.getSelection().trim(),
		);
	}

	captureChatContext(): RequestContext {
		const markdownView = this.getTargetMarkdownView();
		if (!markdownView) {
			throw new Error('Open a Markdown note first.');
		}

		return captureRequestContext(markdownView, {
			maxCharacters: Math.max(
				1000,
				this.settings.maxContextCharacters ||
					DEFAULT_SETTINGS.maxContextCharacters,
			),
			includeNotePath: this.settings.includeNotePathInContext,
		});
	}

	async requestChatCompletion(
		submission: ReadOnlyMainSubmission,
	): Promise<ChatStreamResult>;
	async requestChatCompletion(
		submission: EditMainSubmission,
	): Promise<EditRequestResult>;
	async requestChatCompletion(
		submission: ReadOnlyMainSubmission | EditMainSubmission,
	): Promise<ChatStreamResult | EditRequestResult> {
		if (!submission.prompt.trim()) {
			throw new Error('Enter a prompt first.');
		}
		const activeProvider = this.settings.activeProvider;
		const activeModel = this.settings.providers[activeProvider].model;
		const webSupported = supportsDeepSeekWeb(activeProvider, activeModel);
		if (submission.mode !== 'edit' && submission.webSearch && !webSupported) {
			throw new Error('Online search is only available for DeepSeek deepseek-flash and deepseek-v4-pro.');
		}

		return this.withNoteRequest(submission.context.file.path, async () => {
			const dependencies = {
				provider: {
					...this.settings.providers[activeProvider],
					apiKey: this.getApiKey(activeProvider),
				},
				loadAdditionalNotes: (
					paths: readonly string[],
					activeNotePath: string,
					signal: AbortSignal,
				) => this.loadAdditionalNotes(paths, activeNotePath, signal),
				loadInstructions: () => loadAllInstructions(this.app.vault),
				request: requestAiResponse,
			};
			if (submission.mode === 'edit') {
				const coordinator = new EditRequestCoordinator({
					...dependencies,
					editStrategy: getEditStrategy(),
					writer: createVaultNoteWriter(
						this.app.vault,
						(file) => this.getTargetMarkdownView()?.file === file,
					),
				});
				return coordinator.submit({
					...submission,
					additionalNotePaths: submission.additionalNotePaths ?? [],
				});
			}

			const webSearch = webSupported
				? new DeepSeekWebSearchCoordinator({
					provider: dependencies.provider,
					request: requestAiResponse,
				})
				: undefined;
			const coordinator = new ReadOnlyRequestCoordinator({
				...dependencies,
				...(webSearch ? { webSearch } : {}),
			});
			return coordinator.submit({
				...submission,
				additionalNotePaths: submission.additionalNotePaths ?? [],
			});
		});
	}

	async requestSelectionEdit(
		snapshot: SelectionSnapshot,
		prompt: string,
		signal: AbortSignal,
		editor: ReturnType<typeof createSelectionEditorAdapter>,
		additionalNotePaths: readonly string[] = [],
		history: ProviderHistoryMessage[] = [],
		callbacks?: SelectionEditCallbacks,
	): Promise<SelectionEditResult> {
		if (!prompt.trim()) {
			throw new Error('Enter a prompt first.');
		}

		return this.withNoteRequest(snapshot.file.path, async () => {
			const coordinator = new SelectionEditRequestCoordinator({
				provider: {
					...this.settings.providers[this.settings.activeProvider],
					apiKey: this.getApiKey(this.settings.activeProvider),
				},
				loadAdditionalNotes: (
					paths: readonly string[],
					activeNotePath: string,
					requestSignal: AbortSignal,
				) => this.loadAdditionalNotes(paths, activeNotePath, requestSignal),
				loadInstructions: () => loadAllInstructions(this.app.vault),
				request: requestAiResponse,
				editor,
				editStrategy: getEditStrategy(),
			});
			return coordinator.submit({
				snapshot,
				prompt,
				maxContextCharacters: Math.max(
					1000,
					this.settings.maxContextCharacters ||
						DEFAULT_SETTINGS.maxContextCharacters,
				),
				smartSelectionContext: this.settings.smartSelectionContext,
				additionalNotePaths,
				history,
				notePath: this.settings.includeNotePathInContext
					? `${this.app.vault.getName()}/${snapshot.file.path}`
					: undefined,
				signal,
				callbacks,
			});
		});
	}

	private loadAdditionalNotes(
		paths: readonly string[],
		activeNotePath: string,
		signal: AbortSignal,
	) {
		return captureAdditionalNotes(this.app.vault, {
			paths,
			activeNotePath,
			signal,
			includeNotePath: this.settings.includeNotePathInContext,
			maxCharacters: Math.max(
				1000,
				this.settings.maxContextCharacters ||
					DEFAULT_SETTINGS.maxContextCharacters,
			),
		});
	}

	private async withNoteRequest<T>(
		notePath: string,
		request: () => Promise<T>,
	): Promise<T> {
		const pendingNotePaths = (this.pendingNotePaths ??= new Set());
		if (pendingNotePaths.has(notePath)) {
			throw new Error('Wait for the current Emend request to finish.');
		}

		pendingNotePaths.add(notePath);
		try {
			return await request();
		} finally {
			pendingNotePaths.delete(notePath);
		}
	}

	private getActiveMarkdownView() {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	private getTargetMarkdownView() {
		const activeMarkdownView = this.getActiveMarkdownView();
		if (activeMarkdownView) {
			this.lastMarkdownView = activeMarkdownView;
			return activeMarkdownView;
		}

		if (this.lastMarkdownView && this.isViewStillOpen(this.lastMarkdownView)) {
			return this.lastMarkdownView;
		}

		let foundView: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!foundView && leaf.view instanceof MarkdownView) {
				foundView = leaf.view;
			}
		});

		this.lastMarkdownView = foundView;
		return foundView;
	}

	private rememberActiveMarkdownView() {
		const markdownView = this.getActiveMarkdownView();
		if (markdownView) {
			this.lastMarkdownView = markdownView;
		}
	}

	private isViewStillOpen(view: MarkdownView) {
		let isOpen = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view === view) {
				isOpen = true;
			}
		});

		return isOpen;
	}
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
