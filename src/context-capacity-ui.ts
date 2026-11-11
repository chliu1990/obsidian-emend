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

export const CAPACITY_EXCLUSION_NOTE =
	'Excluded from this estimate: instructions and skills, additional-note contents, the first Web round\'s system prompt and tool declarations, and later Web or correction rounds; the exact submission check remains authoritative.';
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
		return INVALID_CONTEXT_CAPACITY_MESSAGE;
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

export interface ContextCapacityBarSegment {
	key: 'system' | 'user' | 'history' | 'tools' | 'continuation' | 'free' | 'output';
	tokens: number;
	fraction: number;
}

export interface ContextCapacityBarModel {
	estimatedInputTokens: number;
	effectiveInputTokens?: number;
	remainingInputTokens?: number;
	remainingOutputTokens?: number;
	segments: ContextCapacityBarSegment[];
}

export function buildContextCapacityBarModel(
	estimate: DraftCapacityEstimate,
): ContextCapacityBarModel {
	const { capacity, categories } = estimate;
	const estimatedInputTokens = categories.estimatedInputTokens;
	if (capacity.kind !== 'valid') {
		return { estimatedInputTokens, segments: [] };
	}

	const windowTokens = capacity.contextWindowTokens;
	const reserveTokens = capacity.outputReserveTokens;
	const remainingInputTokens = Math.max(
		0,
		windowTokens - reserveTokens - estimatedInputTokens,
	);
	const remainingOutputTokens = Math.max(
		0,
		Math.min(reserveTokens, windowTokens - estimatedInputTokens),
	);
	const denominator = Math.max(windowTokens, estimatedInputTokens);
	const segments: ContextCapacityBarSegment[] = [
		{ key: 'system', tokens: estimateTokensForCharacters(categories.system), fraction: 0 },
		{ key: 'user', tokens: estimateTokensForCharacters(categories.user), fraction: 0 },
		{ key: 'history', tokens: estimateTokensForCharacters(categories.history), fraction: 0 },
		{ key: 'tools', tokens: estimateTokensForCharacters(categories.tools), fraction: 0 },
	];
	const continuationTokens = estimateTokensForCharacters(categories.continuation);
	if (continuationTokens > 0) {
		segments.push({ key: 'continuation', tokens: continuationTokens, fraction: 0 });
	}
	segments.push(
		{ key: 'free', tokens: remainingInputTokens, fraction: 0 },
		{ key: 'output', tokens: remainingOutputTokens, fraction: 0 },
	);
	for (const segment of segments) {
		segment.fraction = segment.tokens / denominator;
	}
	return {
		estimatedInputTokens,
		effectiveInputTokens: capacity.effectiveInputTokens,
		remainingInputTokens,
		remainingOutputTokens,
		segments,
	};
}

export class ContextCapacityDisplay {
	private rootEl: HTMLElement | null;
	private summaryEl: HTMLElement | null;
	private bodyEl: HTMLElement | null;
	private detailsEl: HTMLElement | null;
	private detailsVisible = false;
	private detailsPinned = false;
	private hasDetails = false;
	private readonly onOutsidePointerDown: (event: PointerEvent) => void;

	constructor(containerEl: HTMLElement) {
		const rootEl = containerEl.createDiv({
			cls: 'emend-context-capacity is-unavailable',
			attr: { tabindex: '0' },
		});
		this.rootEl = rootEl;
		this.summaryEl = rootEl.createDiv({
			cls: 'emend-context-capacity-summary',
			attr: {
				role: 'status',
				'aria-live': 'polite',
				'aria-label': 'Draft token estimate',
			},
		});
		this.bodyEl = rootEl.createDiv('emend-context-capacity-body');
		this.detailsEl = rootEl.createDiv({
			cls: 'emend-context-capacity-details',
			attr: { role: 'tooltip' },
		});
		this.detailsEl.hidden = true;

		rootEl.addEventListener('pointerenter', () => {
			if (this.hasDetails) {
				this.setDetailsVisible(true);
			}
		});
		rootEl.addEventListener('focusin', () => {
			if (this.hasDetails) {
				this.setDetailsVisible(true);
			}
		});
		rootEl.addEventListener('pointerleave', () => {
			if (!this.detailsPinned) {
				this.setDetailsVisible(false);
			}
		});
		rootEl.addEventListener('focusout', () => {
			if (!this.detailsPinned) {
				this.setDetailsVisible(false);
			}
		});
		rootEl.addEventListener('click', () => {
			if (!this.hasDetails) {
				return;
			}
			this.detailsPinned = !this.detailsPinned;
			this.setDetailsVisible(this.detailsPinned);
		});
		rootEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !this.detailsVisible) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.dismissDetails();
		});
		this.onOutsidePointerDown = (event) => {
			if (
				this.detailsVisible &&
				event.target &&
				!rootEl.contains(event.target as Node)
			) {
				this.dismissDetails();
			}
		};
		rootEl.ownerDocument.addEventListener('pointerdown', this.onOutsidePointerDown);
	}

	render(estimate: DraftCapacityEstimate | undefined): void {
		const rootEl = this.rootEl;
		const summaryEl = this.summaryEl;
		const bodyEl = this.bodyEl;
		const detailsEl = this.detailsEl;
		if (!rootEl || !summaryEl || !bodyEl || !detailsEl) {
			return;
		}
		rootEl.className = `emend-context-capacity ${getStateClass(estimate)}`;
		summaryEl.textContent = formatDraftCapacitySummary(estimate);
		bodyEl.empty();
		detailsEl.empty();
		this.hasDetails = estimate !== undefined;
		if (!estimate) {
			this.detailsPinned = false;
			this.setDetailsVisible(false);
			return;
		}

		if (estimate.capacity.kind === 'valid') {
			const model = buildContextCapacityBarModel(estimate);
			const meterEl = bodyEl.createDiv({
				cls: 'emend-context-capacity-bar',
				attr: {
					role: 'meter',
					'aria-label': 'Context capacity',
					'aria-valuemin': '0',
					'aria-valuemax': String(estimate.capacity.contextWindowTokens),
					'aria-valuenow': String(Math.min(
						model.estimatedInputTokens,
						estimate.capacity.contextWindowTokens,
					)),
					'aria-valuetext': formatDraftCapacitySummary(estimate),
				},
			});
			for (const segment of model.segments) {
				const segmentEl = meterEl.createDiv(
					`emend-context-capacity-segment is-${segment.key}`,
				);
				segmentEl.style.width = `${segment.fraction * 100}%`;
			}
		}
		this.renderDetails(detailsEl, estimate);
		this.setDetailsVisible(this.detailsVisible);
	}

	destroy(): void {
		if (this.rootEl) {
			this.rootEl.ownerDocument.removeEventListener(
				'pointerdown',
				this.onOutsidePointerDown,
			);
		}
		this.rootEl?.remove();
		this.rootEl = null;
		this.summaryEl = null;
		this.bodyEl = null;
		this.detailsEl = null;
		this.detailsVisible = false;
		this.detailsPinned = false;
		this.hasDetails = false;
	}

	private setDetailsVisible(visible: boolean): void {
		this.detailsVisible = visible && this.hasDetails;
		if (this.detailsEl) {
			this.detailsEl.hidden = !this.detailsVisible;
		}
	}

	private dismissDetails(): void {
		this.detailsPinned = false;
		this.setDetailsVisible(false);
	}

	private renderDetails(containerEl: HTMLElement, estimate: DraftCapacityEstimate) {
		const addDetail = (text: string) => {
			containerEl.createDiv({ cls: 'emend-context-capacity-detail', text });
		};
		const { capacity, categories } = estimate;
		addDetail(`Estimated input: ${categories.estimatedInputTokens} tokens`);
		if (capacity.kind === 'valid') {
			const model = buildContextCapacityBarModel(estimate);
			addDetail(`Remaining input: ${model.remainingInputTokens ?? 0} tokens`);
			addDetail(`Remaining output: ${model.remainingOutputTokens ?? 0} tokens`);
			addDetail(`Effective input capacity: ${capacity.effectiveInputTokens} tokens`);
			addDetail(`Context window: ${capacity.contextWindowTokens} tokens`);
			addDetail(`Output reserve: ${capacity.outputReserveTokens} tokens`);
		}
		addDetail(formatCategoryEstimates(categories));
		containerEl.createDiv({
			cls: 'emend-context-capacity-exclusion',
			text: `Remaining input is a lower-bound estimate. ${CAPACITY_EXCLUSION_NOTE}`,
		});
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
		`Draft: ${estimateTokensForCharacters(categories.user)} tokens`,
		`History: ${estimateTokensForCharacters(categories.history)} tokens`,
		`Tools: ${estimateTokensForCharacters(categories.tools)} tokens`,
	];
	const continuation = estimateTokensForCharacters(categories.continuation);
	if (continuation > 0) {
		parts.push(`Continuation: ${continuation} tokens`);
	}
	return parts.join(' · ');
}
