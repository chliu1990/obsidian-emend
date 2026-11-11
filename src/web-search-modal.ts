import { App, Modal } from 'obsidian';
import type { ProviderToolCall } from './provider-stream';
import {
	parseWebToolCall,
	WEB_EXTRACTION_DISCLOSURE,
	type WebToolCall,
} from './web-search';

interface WebCallInput {
	call: WebToolCall;
	inputEl: HTMLInputElement;
	goalInputEl: HTMLInputElement;
}

export class WebSearchModal extends Modal {
	private inputs: WebCallInput[] = [];
	private errorEl: HTMLElement | null = null;
	private approved = false;
	private cancellationSettled = false;

	constructor(
		app: App,
		private readonly calls: readonly WebToolCall[],
		private readonly resolve: (calls: readonly WebToolCall[]) => void,
		private readonly reject: (reason?: unknown) => void,
		private readonly cancel: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle('Review web calls');
		this.contentEl.empty();
		this.contentEl.addClass('emend-web-review-modal');
		this.inputs = [];
		this.errorEl = null;
		this.contentEl.createDiv({
			cls: 'emend-web-review-disclosure',
			text: WEB_EXTRACTION_DISCLOSURE,
		});

		for (const [index, call] of this.calls.entries()) {
			const rowEl = this.contentEl.createDiv('emend-web-review-call');
			rowEl.createEl('label', {
				text: call.name === 'web_search'
					? `Search query ${index + 1}`
					: `Fetch URL ${index + 1}`,
			});
			const inputEl = rowEl.createEl('input', {
				cls: 'emend-web-review-input',
				attr: {
					type: 'text',
					'data-call-id': call.id,
					'data-field': 'target',
				},
			});
			inputEl.value = call.name === 'web_search' ? call.query : call.url;
			rowEl.createEl('label', { text: `Extraction goal ${index + 1}` });
			const goalInputEl = rowEl.createEl('input', {
				cls: 'emend-web-review-input',
				attr: {
					type: 'text',
					'data-call-id': call.id,
					'data-field': 'extractionGoal',
				},
			});
			goalInputEl.value = call.extractionGoal;
			this.inputs.push({ call, inputEl, goalInputEl });
		}

		const actionsEl = this.contentEl.createDiv('emend-web-review-actions');
		const cancelButton = actionsEl.createEl('button', {
			cls: 'emend-chat-secondary-button',
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancelButton.addEventListener('click', () => this.close());
		const runButton = actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: 'Run web calls',
			attr: { type: 'button' },
		});
		runButton.addEventListener('click', () => this.approve());
	}

	onClose() {
		this.inputs = [];
		this.errorEl = null;
		this.contentEl.empty();
		if (this.approved || this.cancellationSettled) {
			return;
		}
		this.cancellationSettled = true;
		this.cancel();
		this.reject(new DOMException('Web call review was cancelled.', 'AbortError'));
	}

	private approve() {
		let reviewed: WebToolCall[];
		try {
			reviewed = this.inputs.map(({ call, inputEl, goalInputEl }) => parseWebToolCall(
				toProviderToolCall(call, inputEl.value, goalInputEl.value),
			));
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
			return;
		}

		this.approved = true;
		this.resolve(reviewed);
		this.close();
	}

	private showError(message: string) {
		if (this.errorEl) {
			this.errorEl.textContent = message;
			return;
		}
		this.errorEl = this.contentEl.createDiv({
			cls: 'emend-web-review-error',
			text: message,
		});
	}
}

function toProviderToolCall(call: WebToolCall, value: string, extractionGoal: string): ProviderToolCall {
	return {
		id: call.id,
		name: call.name,
		arguments: JSON.stringify(call.name === 'web_search'
			? { query: value, extractionGoal }
			: { url: value, extractionGoal }),
	};
}
