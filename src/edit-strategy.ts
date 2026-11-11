import { operationEditStrategy } from './operation-edit-strategy';
import type { EditOperation, InstructionPromptParts } from './types';

export interface EditSummaryItem {
	type: EditOperation['type'];
	start: number;
	end: number;
	insertionPoint?: number;
}

export interface EditPreparation {
	annotatedMarkdown: string;
	changeCount: number;
	summaryItems: readonly EditSummaryItem[];
	summary?: string;
}

export interface EditSourceContext {
	fullText: string;
	from: number;
	to: number;
}

export interface EditStrategy {
	id: 'operations';
	getFullNotePrompt(instructions?: InstructionPromptParts): string;
	getSelectionPrompt(instructions?: InstructionPromptParts): string;
	prepareEdit(original: string, response: string, sourceContext?: EditSourceContext): EditPreparation;
}

export function getEditStrategy(): EditStrategy {
	return operationEditStrategy;
}
