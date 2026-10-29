import { MarkdownView, Plugin } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { EMEND_CHAT_VIEW_TYPE, EmendChatView } from './chat-view';
import {
	captureRequestContext,
	type RequestContext,
} from './context';
import {
	applyHunkToMarkdown,
	applyHunksToMarkdown,
	clearDocumentDiffPreviewEffect,
	createDocumentDiffPreviewExtension,
	DocumentDiffHunk,
	DocumentDiffPreview,
	getRemainingHunksAfterAccept,
	getRemainingHunksAfterReject,
	setDocumentDiffPreviewEffect,
} from './document-diff-preview';
import { loadAllInstructions } from './instructions-loader';
import { requestAiResponse } from './provider-stream';
import {
	ReadOnlyRequestCoordinator,
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

		this.registerEditorExtension(
			createDocumentDiffPreviewExtension({
				acceptPreview: (preview, view) =>
					this.acceptDocumentDiffPreview(preview, view),
				rejectPreview: (preview, view) =>
					this.rejectDocumentDiffPreview(preview, view),
				acceptHunk: (preview, hunk, view) =>
					this.acceptDocumentDiffHunk(preview, hunk, view),
				rejectHunk: (preview, hunk, view) =>
					this.rejectDocumentDiffHunk(preview, hunk, view),
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

	async requestChatCompletion(submission: ReadOnlySubmission) {
		const coordinator = new ReadOnlyRequestCoordinator({
			provider: this.settings.providers[this.settings.activeProvider],
			loadInstructions: () => loadAllInstructions(this.app.vault),
			request: requestAiResponse,
		});
		return coordinator.submit(submission);
	}

	private acceptDocumentDiffPreview(
		preview: DocumentDiffPreview,
		view: EditorView,
	) {
		const updatedMarkdown = applyHunksToMarkdown(
			view.state.doc.toString(),
			preview.changes,
		);

		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: updatedMarkdown,
			},
			effects: clearDocumentDiffPreviewEffect.of(preview.id),
			scrollIntoView: true,
		});
	}

	private rejectDocumentDiffPreview(
		preview: DocumentDiffPreview,
		view: EditorView,
	) {
		view.dispatch({
			effects: clearDocumentDiffPreviewEffect.of(preview.id),
		});
	}

	private acceptDocumentDiffHunk(
		preview: DocumentDiffPreview,
		hunk: DocumentDiffHunk,
		view: EditorView,
	) {
		const updatedMarkdown = applyHunkToMarkdown(
			view.state.doc.toString(),
			hunk,
		);
		const remainingHunks = getRemainingHunksAfterAccept(
			preview.changes,
			hunk,
		);

		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: updatedMarkdown,
			},
			effects:
				remainingHunks.length > 0
					? setDocumentDiffPreviewEffect.of({
							...preview,
							originalMarkdown: updatedMarkdown,
							changes: remainingHunks,
						})
					: clearDocumentDiffPreviewEffect.of(preview.id),
			scrollIntoView: true,
		});
	}

	private rejectDocumentDiffHunk(
		preview: DocumentDiffPreview,
		hunk: DocumentDiffHunk,
		view: EditorView,
	) {
		const remainingHunks = getRemainingHunksAfterReject(
			preview.changes,
			hunk,
		);

		view.dispatch({
			effects:
				remainingHunks.length > 0
					? setDocumentDiffPreviewEffect.of({
							...preview,
							originalMarkdown: view.state.doc.toString(),
							changes: remainingHunks,
						})
					: clearDocumentDiffPreviewEffect.of(preview.id),
		});
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
