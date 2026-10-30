import { operationEditStrategy } from './operation-edit-strategy';
import type { InstructionPromptParts } from './types';

export interface EditPreparation {
	annotatedMarkdown: string;
	changeCount: number;
}

export interface EditStrategy {
	id: 'operations';
	getFullNotePrompt(instructions?: InstructionPromptParts): string;
	getSelectionPrompt(instructions?: InstructionPromptParts): string;
	prepareEdit(original: string, response: string): EditPreparation;
}

export function getEditStrategy(): EditStrategy {
	return operationEditStrategy;
}
