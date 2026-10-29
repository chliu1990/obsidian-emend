import { prepareCriticMarkupEdit } from './critic-markup';
import { getSelectionSystemPrompt, getSystemPrompt } from './mode';
import type { InstructionPromptParts } from './types';

export interface EditPreparation {
	annotatedMarkdown: string;
	changeCount: number;
}

export interface EditStrategy {
	id: string;
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
