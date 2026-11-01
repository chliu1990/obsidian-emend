import type {
	ProviderHistoryMessage,
	ProviderHistoryOrigin,
	ProviderWireHistoryMessage,
} from './types';

export function formatProviderHistory(
	messages: ProviderHistoryMessage[],
): ProviderWireHistoryMessage[] {
	return messages.map((message) => ({
		role: message.role,
		content: `[Historical ${capitalize(message.mode)} message. ${message.mode === 'edit' ? 'Note writing was permitted for that earlier request only.' : 'That earlier request was read-only.'} Origin: ${formatOrigin(message.origin)}]\n${message.content}`,
	}));
}

function formatOrigin(origin: ProviderHistoryOrigin): string {
	switch (origin) {
		case 'user':
			return 'user message.';
		case 'model':
			return 'model response.';
		case 'local-edit-status':
			return 'local Emend Edit status, not a model response.';
	}
}

function capitalize(mode: string): string {
	return mode.charAt(0).toUpperCase() + mode.slice(1);
}
