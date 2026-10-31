import type { Mode } from './types';

export function canWriteToNote(mode: Mode): boolean {
	return mode === 'edit';
}
