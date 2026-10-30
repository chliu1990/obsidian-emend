import { prepareCriticMarkupEdit } from './critic-markup';
import { getSelectionSystemPrompt, getSystemPrompt } from './mode';
import { operationEditStrategy } from './operation-edit-strategy';
import type {
	EditStrategyId,
	EmendSettings,
	InstructionPromptParts,
} from './types';

export interface EditPreparation {
	annotatedMarkdown: string;
	changeCount: number;
}

export interface EditStrategy {
	id: EditStrategyId;
	getFullNotePrompt(instructions?: InstructionPromptParts): string;
	getSelectionPrompt(instructions?: InstructionPromptParts): string;
	prepareEdit(original: string, response: string): EditPreparation;
}

export const criticMarkupEditStrategy: EditStrategy = {
	id: 'critic-markup',
	getFullNotePrompt: (instructions) => getSystemPrompt('edit', instructions),
	getSelectionPrompt: (instructions) => getSelectionSystemPrompt(instructions),
	prepareEdit: prepareCriticMarkupEdit,
};

export function getEditStrategy(
	settings: Pick<EmendSettings, 'editStrategy'>,
): EditStrategy {
	return settings.editStrategy === 'operations'
		? operationEditStrategy
		: criticMarkupEditStrategy;
}
