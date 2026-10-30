import { MarkdownView, Plugin } from 'obsidian';
import { EMEND_CHAT_VIEW_TYPE, EmendChatView } from './chat-view';
import {
	captureRequestContext,
	type RequestContext,
} from './context';
import { loadAllInstructions } from './instructions-loader';
import { createVaultNoteWriter, type EditResult } from './note-writer';
import { requestAiResponse, type StreamResult } from './provider-stream';
import {
	EditRequestCoordinator,
	ReadOnlyRequestCoordinator,
	type EditSubmission,
	type ReadOnlySubmission,
} from './request-coordinator';
import {
	DEFAULT_SETTINGS,
	EmendSettingTab,
	normalizeSettings,
} from './settings';
import type { EmendSettings } from './types';

export default class EmendPlugin extends Plugin {
	settings!: EmendSettings;
	private lastMarkdownView: MarkdownView | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(
			EMEND_CHAT_VIEW_TYPE,
			(leaf) => new EmendChatView(leaf, this),
		);
		this.rememberActiveMarkdownView();
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.rememberActiveMarkdownView();
			}),
		);

		this.addRibbonIcon('messages-square', 'Open AI chat', () => {
			void this.activateChatView();
		});

		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- Required Stage 02 public identifier.
			id: 'emend:open-chat',
			name: 'Open AI chat',
			callback: () => {
				void this.activateChatView();
			},
		});

		this.addSettingTab(new EmendSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

	getActiveNoteLabel() {
		const markdownView = this.getTargetMarkdownView();
		return markdownView?.file?.path ?? 'No Markdown note is open';
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
		submission: ReadOnlySubmission,
	): Promise<StreamResult>;
	async requestChatCompletion(submission: EditSubmission): Promise<EditResult>;
	async requestChatCompletion(
		submission: ReadOnlySubmission | EditSubmission,
	): Promise<StreamResult | EditResult> {
		const dependencies = {
			provider: this.settings.providers[this.settings.activeProvider],
			loadInstructions: () => loadAllInstructions(this.app.vault),
			request: requestAiResponse,
		};
		if (submission.mode === 'edit') {
			const coordinator = new EditRequestCoordinator({
				...dependencies,
				writer: createVaultNoteWriter(
					this.app.vault,
					(file) => this.getTargetMarkdownView()?.file === file,
				),
			});
			return coordinator.submit(submission);
		}

		const coordinator = new ReadOnlyRequestCoordinator(dependencies);
		return coordinator.submit(submission);
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
