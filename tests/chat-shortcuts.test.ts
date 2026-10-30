import { describe, expect, it } from 'vitest';
import {
	getComposerShortcut,
	getModeShortcut,
	type ShortcutEvent,
} from '../src/chat-shortcuts';

function shortcutEvent(overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
	return {
		key: 'Enter',
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	};
}

describe('composer shortcuts', () => {
	it('sends on ordinary Enter', () => {
		expect(getComposerShortcut(shortcutEvent())).toBe('send');
	});

	it.each([{ metaKey: true }, { ctrlKey: true }])(
		'sends on Mod+Enter with $metaKey$ctrlKey',
		(modifier) => {
			expect(getComposerShortcut(shortcutEvent(modifier))).toBe('send');
		},
	);

	it('inserts a newline on Shift+Enter', () => {
		expect(getComposerShortcut(shortcutEvent({ shiftKey: true }))).toBe('newline');
	});

	it.each([
		{ isSending: true, isThreadLoading: false },
		{ isSending: false, isThreadLoading: true },
		{ isSending: true, isThreadLoading: true },
	])('does not send while composer controls are unavailable: %o', (state) => {
		expect(getComposerShortcut(shortcutEvent({ metaKey: true }), state)).toBeNull();
		expect(getComposerShortcut(shortcutEvent({ ctrlKey: true }), state)).toBeNull();
		expect(getComposerShortcut(shortcutEvent(), state)).toBeNull();
	});

	it.each([
		{ altKey: true },
		{ metaKey: true, ctrlKey: true },
		{ metaKey: true, shiftKey: true },
		{ ctrlKey: true, shiftKey: true },
	])('ignores conflicting Enter modifiers: %o', (modifiers) => {
		expect(getComposerShortcut(shortcutEvent(modifiers))).toBeNull();
	});

	it('ignores unrelated keys', () => {
		expect(getComposerShortcut(shortcutEvent({ key: 'a', metaKey: true }))).toBeNull();
	});
});

describe('mode shortcuts', () => {
	it.each([
		{ key: 'a', metaKey: true },
		{ key: 'A', ctrlKey: true },
	])('matches Mod+Shift+A with either platform modifier: %o', (modifiers) => {
		expect(getModeShortcut(shortcutEvent({ ...modifiers, shiftKey: true }))).toBe('ask');
	});

	it.each([
		{ key: 'e', metaKey: true },
		{ key: 'E', ctrlKey: true },
	])('matches Mod+Shift+E with either platform modifier: %o', (modifiers) => {
		expect(getModeShortcut(shortcutEvent({ ...modifiers, shiftKey: true }))).toBe('edit');
	});

	it.each([
		{ key: 'a', shiftKey: true },
		{ key: 'a', metaKey: true },
		{ key: 'a', metaKey: true, ctrlKey: true, shiftKey: true },
		{ key: 'a', metaKey: true, shiftKey: true, altKey: true },
		{ key: 'x', metaKey: true, shiftKey: true },
	])('ignores missing, conflicting, or unrelated mode modifiers: %o', (modifiers) => {
		expect(getModeShortcut(shortcutEvent(modifiers))).toBeNull();
	});
});
