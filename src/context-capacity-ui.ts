import {
	accountRequestCharacters,
	estimateTokensForCharacters,
	INVALID_CONTEXT_CAPACITY_MESSAGE,
	resolveContextCapacity,
	type ContextCapacityState,
	type ContextRequestText,
	type RequestCharacterCategories,
} from './context-accounting';
import type { RequestContext } from './context';
import { getEditStrategy } from './edit-strategy';
import { getSystemPrompt } from './mode';
import { buildUserPrompt } from './request-coordinator';
import { buildSelectionUserPrompt } from './selection-editor';
import type {
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from './types';

export interface DraftCapacityEstimate {
	capacity: ContextCapacityState;
	categories: RequestCharacterCategories;
	overCapacity: boolean;
	blocked: boolean;
}

export const INVALID_CAPACITY_DISPLAY =
	'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.';
export const CAPACITY_EXCLUSION_NOTE =
	'Not included: instructions and skills, additional-note contents, and later Web or correction rounds. The exact submission check remains authoritative.';
export const CAPACITY_UNAVAILABLE = 'Draft estimate unavailable.';

export function buildDraftCapacityEstimate(input: {
	provider: ProviderConfig;
	request: ContextRequestText;
}): DraftCapacityEstimate {
	const capacity = resolveContextCapacity(input.provider);
	const categories = accountRequestCharacters(input.request);
	const overCapacity = capacity.kind === 'valid' &&
		categories.estimatedInputTokens >= capacity.effectiveInputTokens;
	return {
		capacity,
		categories,
		overCapacity,
		blocked: capacity.kind === 'invalid' || overCapacity,
	};
}

export function buildReadOnlyDraftEstimate(input: {
	provider: ProviderConfig;
	context: RequestContext;
	mode: Exclude<Mode, 'edit'>;
	prompt: string;
	history: ProviderHistoryMessage[];
	notePath?: string;
}): DraftCapacityEstimate {
	const context = withNotePath(input.context, input.notePath);
	return buildDraftCapacityEstimate({
		provider: input.provider,
		request: {
			systemPrompt: getSystemPrompt(input.mode, undefined),
			userPrompt: buildUserPrompt(context, input.prompt, []),
			history: input.history,
		},
	});
}

export function buildFullNoteDraftEstimate(input: {
	provider: ProviderConfig;
	context: RequestContext;
	prompt: string;
	history: ProviderHistoryMessage[];
	notePath?: string;
}): DraftCapacityEstimate {
	const context = withNotePath(input.context, input.notePath);
	return buildDraftCapacityEstimate({
		provider: input.provider,
		request: {
			systemPrompt: getEditStrategy().getFullNotePrompt(undefined),
			userPrompt: buildUserPrompt(
				context,
				input.prompt,
				[],
				context.sourceText,
			),
			history: input.history,
		},
	});
}

export function buildSelectionDraftEstimate(input: {
	provider: ProviderConfig;
	snapshot: SelectionSnapshot;
	prompt: string;
	maxContextCharacters: number;
	smartSelectionContext: boolean;
	notePath?: string;
	history: ProviderHistoryMessage[];
}): DraftCapacityEstimate {
	return buildDraftCapacityEstimate({
		provider: input.provider,
		request: {
			systemPrompt: getEditStrategy().getSelectionPrompt(undefined),
			userPrompt: buildSelectionUserPrompt({
				snapshot: input.snapshot,
				prompt: input.prompt,
				maxContextCharacters: input.maxContextCharacters,
				smartSelectionContext: input.smartSelectionContext,
				additionalNotes: [],
				notePath: input.notePath,
			}),
			history: input.history,
		},
	});
}

function withNotePath(
	context: RequestContext,
	notePath: string | undefined,
): RequestContext {
	return notePath === undefined ? context : { ...context, notePath };
}

export function formatDraftCapacitySummary(
	estimate: DraftCapacityEstimate | undefined,
): string {
	if (!estimate) {
		return CAPACITY_UNAVAILABLE;
	}
	const { capacity, categories } = estimate;
	if (capacity.kind === 'invalid') {
		return INVALID_CAPACITY_DISPLAY;
	}
	if (capacity.kind === 'unconfigured') {
		return `Estimated input: ${categories.estimatedInputTokens} tokens. Capacity checks are off.`;
	}
	const summary =
		`Estimated input: ${categories.estimatedInputTokens} tokens of ${capacity.effectiveInputTokens} effective capacity.`;
	return estimate.overCapacity
		? `${summary} This draft is over capacity.`
		: summary;
}

export function formatDraftCapacityBlockMessage(
	estimate: DraftCapacityEstimate | undefined,
): string | undefined {
	if (!estimate) {
		return undefined;
	}
	if (estimate.capacity.kind === 'invalid') {
		return INVALID_CONTEXT_CAPACITY_MESSAGE;
	}
	if (estimate.capacity.kind === 'valid' && estimate.overCapacity) {
		return `This draft is over capacity at about ${estimate.categories.estimatedInputTokens} input tokens of ${estimate.capacity.effectiveInputTokens} effective capacity. Reduce the draft, chat history, or the selected target.`;
	}
	return undefined;
}

export class ContextCapacityDisplay {
	private rootEl: HTMLElement | null;
	private detailsEl: HTMLDetailsElement | null = null;
	private detailsOpen = false;

	constructor(containerEl: HTMLElement) {
		this.rootEl = containerEl.createDiv({
			cls: 'emend-context-capacity is-unavailable',
			attr: {
				role: 'status',
				'aria-live': 'polite',
				'aria-label': 'Draft token estimate',
			},
		});
	}

	render(estimate: DraftCapacityEstimate | undefined): void {
		const rootEl = this.rootEl;
		if (!rootEl) {
			return;
		}
		this.detailsOpen = this.detailsEl?.open ?? this.detailsOpen;
		this.detailsEl = null;
		rootEl.className = `emend-context-capacity ${getStateClass(estimate)}`;
		rootEl.empty();
		rootEl.createDiv({
			cls: 'emend-context-capacity-summary',
			text: formatDraftCapacitySummary(estimate),
		});
		if (estimate) {
			this.renderDetails(rootEl, estimate);
		}
		rootEl.createDiv({
			cls: 'emend-context-capacity-exclusion',
			text: CAPACITY_EXCLUSION_NOTE,
		});
	}

	destroy(): void {
		this.rootEl?.remove();
		this.rootEl = null;
		this.detailsEl = null;
		this.detailsOpen = false;
	}

	private renderDetails(rootEl: HTMLElement, estimate: DraftCapacityEstimate) {
		const detailsEl = rootEl.createEl('details', {
			cls: 'emend-context-capacity-details',
		});
		detailsEl.open = this.detailsOpen;
		this.detailsEl = detailsEl;
		detailsEl.createEl('summary', { text: 'Estimate details' });
		const addDetail = (text: string) => {
			detailsEl.createDiv({ cls: 'emend-context-capacity-detail', text });
		};
		const { capacity, categories } = estimate;
		if (capacity.kind === 'valid') {
			addDetail(`Context window: ${capacity.contextWindowTokens} tokens`);
			addDetail(`Output reserve: ${capacity.outputReserveTokens} tokens`);
			addDetail(`Effective input capacity: ${capacity.effectiveInputTokens} tokens`);
		}
		addDetail(formatCategoryEstimates(categories));
		addDetail(`Total: ${categories.estimatedInputTokens} tokens`);
	}
}

function getStateClass(estimate: DraftCapacityEstimate | undefined): string {
	if (!estimate) {
		return 'is-unavailable';
	}
	if (estimate.capacity.kind === 'invalid') {
		return 'is-invalid';
	}
	if (estimate.overCapacity) {
		return 'is-over-capacity';
	}
	return estimate.capacity.kind === 'unconfigured'
		? 'is-unconfigured'
		: 'is-valid';
}

function formatCategoryEstimates(categories: RequestCharacterCategories): string {
	const parts = [
		`System: ${estimateTokensForCharacters(categories.system)} tokens`,
		`Draft: ${estimateTokensForCharacters(categories.user)}`,
		`History: ${estimateTokensForCharacters(categories.history)}`,
		`Tools: ${estimateTokensForCharacters(categories.tools)}`,
	];
	const continuation = estimateTokensForCharacters(categories.continuation);
	if (continuation > 0) {
		parts.push(`Continuation: ${continuation}`);
	}
	return parts.join(' · ');
}
