import type { TFile } from 'obsidian';
import type { TokenUsage } from './token-usage';

export type ProviderId = 'deepseek' | 'kimi' | 'custom';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export type Mode = 'ask' | 'edit' | 'discuss' | 'brainstorm';

export type EditOperation =
	| { type: 'insert'; anchor: string; position: 'before' | 'after'; text: string; occurrence?: number }
	| { type: 'remove'; target: string; occurrence?: number }
	| { type: 'replace'; target: string; replacement: string; occurrence?: number }
	| { type: 'comment'; target: string; comment: string; occurrence?: number };

export interface AiMessage {
	role: 'user' | 'assistant';
	content: string;
	mode: Mode;
}

export interface ProviderHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning: string;
	mode: Mode;
	sourcePath: string;
	status: 'ready' | 'loading' | 'error' | 'stopped';
	timestamp: number;
	usage?: TokenUsage;
}

export interface SelectionSnapshot {
	file: TFile;
	fullText: string;
	selectedText: string;
	from: number;
	to: number;
}

export interface InstructionPromptParts {
	agentText?: string;
	skillTexts: Map<string, string>;
}

export interface DiscoveredModel {
	id: string;
	displayName: string;
}

export interface ProviderConfig {
	name: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	reasoningEffort: ReasoningEffort;
	requestUsage: boolean;
}

export interface EmendSettings {
	activeProvider: ProviderId;
	providers: Record<ProviderId, ProviderConfig>;
	defaultMode: Mode;
	includeNotePathInContext: boolean;
	smartSelectionContext: boolean;
	maxContextCharacters: number;
}
