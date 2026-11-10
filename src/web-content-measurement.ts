export function measureWebContent(value: string): {
	value: number;
	unit: 'characters';
} {
	return { value: value.length, unit: 'characters' };
}
