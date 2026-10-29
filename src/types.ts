export type ProviderId = 'deepseek' | 'kimi' | 'custom';

export type ReasoningEffort = 'low' | 'medium' | 'high';

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
	defaultMode: 'ask' | 'edit' | 'discuss' | 'brainstorm';
	includeNotePathInContext: boolean;
	maxContextCharacters: number;
}
