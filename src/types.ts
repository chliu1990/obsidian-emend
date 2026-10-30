import type { TFile } from 'obsidian';
import type { ProviderTokenUsage } from './provider-stream';

export type ProviderId = 'deepseek' | 'kimi' | 'custom';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export type Mode = 'ask' | 'edit' | 'discuss' | 'brainstorm';

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
	usage?: ProviderTokenUsage;
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

export interface ProviderConfig {
	name: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	reasoningEffort: ReasoningEffort;
}

export interface EmendSettings {
	activeProvider: ProviderId;
	providers: Record<ProviderId, ProviderConfig>;
	defaultMode: Mode;
	includeNotePathInContext: boolean;
	maxContextCharacters: number;
}
